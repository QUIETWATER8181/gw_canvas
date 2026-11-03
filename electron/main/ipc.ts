import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, basename, dirname, isAbsolute, resolve } from 'node:path'
import type { ConfigStore } from './store'
import type { SceneStore } from './scene-store'
import type { DraftStore } from './draft-store'
import type { AgentBridge } from './agent/bridge'
import type { AppState, ExportRequest, ExportSettings, PromptContext } from '@shared/ipc'
import type { Scene } from '@shared/scene'
import { friendlyHttpError, modelsUrl } from './agent/http-errors'
import { listVoices, synthesize } from './tts'
import { describeImage } from './vision'

/** fetch 抛出的底层错误（DNS / 证书 / 超时 / 连接被拒）也要说人话 */
function explainFetchError(error: unknown, baseUrl: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? ''
  if (message.includes('timeout') || message.includes('aborted')) return `连接超时（25 秒）：${baseUrl} 没有响应，检查地址或网络/代理。`
  if (code === 'ENOTFOUND' || message.includes('getaddrinfo')) return `域名解析失败：${baseUrl} 的主机名找不到，检查地址是否拼错。`
  if (code === 'ECONNREFUSED') return `连接被拒绝：${baseUrl} 上没有服务在监听。`
  if (code === 'CERT_HAS_EXPIRED' || message.includes('certificate')) return `TLS 证书有问题：${baseUrl}。若是自建/内网网关，确认证书有效。`
  if (code === 'EPROTO' || message.includes('wrong version number')) return `这个地址不是 HTTPS 接口（或端口不对）：${baseUrl}。`
  return `${message}${cause?.message ? `（${cause.message}）` : ''}`
}

export interface IpcDeps {
  store: ConfigStore
  drafts: DraftStore
  /** 当前草稿的 SceneStore（切草稿时会被替换，所以每次都取新的） */
  getSceneStore(): SceneStore
  bridge: AgentBridge
  getWindow(): BrowserWindow | null
  /** 切草稿：换 sceneStore、重启 agent、广播 */
  switchDraft(id: string): Promise<void>
  /** 打开/聚焦草稿库窗口 */
  openDraftWindow(): void
  /** 向所有窗口广播 */
  broadcast(channel: string, payload: unknown): void
}

/** 自动化测试用：--export-path=<file> 固定落盘位置，跳过系统对话框 */
function forcedExportPath(): string | null {
  const arg = process.argv.find(a => a.startsWith('--export-path='))
  return arg ? resolve(arg.slice('--export-path='.length)) : null
}

function systemVideoDir(): string {
  try {
    const dir = app.getPath('videos')
    if (dir) return dir
  } catch { /* 某些环境没有 videos 目录 */ }
  return join(app.getPath('userData'), 'exports')
}

/**
 * 导出位置的三层优先级：
 *   1. 设置里固定指定的目录（用户明确选了「就放这儿」）
 *   2. 最近一次用过的目录（记得上次放哪，符合剪映/PR 的习惯）
 *   3. 系统「视频」文件夹（人找得到的地方，不是 AppData 深处）
 */
function exportSettingsOf(deps: IpcDeps): ExportSettings {
  const s = deps.store.getExportSettings()
  const forced = forcedExportPath()
  const fallback = join(deps.getSceneStore().workspace, 'exports')
  const systemDir = systemVideoDir()
  const resolvedDir = forced
    ? dirname(forced)
    : s.dir ?? s.recentDirs[0] ?? (existsSync(systemDir) ? systemDir : fallback)
  return {
    dir: s.dir,
    askEveryTime: s.askEveryTime,
    revealAfterExport: s.revealAfterExport,
    recentDirs: s.recentDirs,
    resolvedDir,
    systemDir,
    forcedPath: forced
  }
}

async function stateOf(deps: IpcDeps): Promise<AppState> {
  const sceneStore = deps.getSceneStore()
  const id = deps.drafts.activeId
  const summary = id ? await deps.drafts.summaryOf(id) : null
  return {
    workspace: sceneStore.workspace,
    scenePath: sceneStore.scenePath,
    connections: deps.store.list(),
    activeConnectionId: deps.store.getActiveId(),
    visionConnectionId: deps.store.getVisionId(),
    agent: deps.bridge.getStatus(),
    draft: id ? { id, name: summary?.name ?? '未命名草稿', dir: deps.drafts.activeDir() } : null,
    exportSettings: exportSettingsOf(deps)
  }
}

/** 同名文件不覆盖：xxx.mp4 → xxx-1.mp4 */
async function uniquePath(full: string): Promise<string> {
  if (!existsSync(full)) return full
  const ext = extname(full)
  const stem = full.slice(0, full.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!existsSync(candidate)) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'physics-video'
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('gewu:get-state', () => stateOf(deps))

  ipcMain.handle('gewu:save-connection', async (_e, input) => {
    deps.store.upsert(input)
    void deps.bridge.newSession().catch(() => undefined)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:delete-connection', async (_e, id: string) => {
    deps.store.remove(id)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:set-active-connection', async (_e, id: string) => {
    deps.store.setActive(id)
    void deps.bridge.newSession().catch(() => undefined)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:test-connection', async (_e, input: { baseUrl: string; model: string; apiKey?: string; id?: string }) => {
    const key = input.apiKey?.trim() || (input.id ? deps.store.getSecret(input.id) : null)
    if (!key) return { ok: false, detail: '缺少 API Key' }
    try {
      const url = modelsUrl(input.baseUrl)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(25_000) })
      if (!res.ok) return { ok: false, detail: friendlyHttpError(res.status, await res.text()) }
      const json = await res.json() as { data?: { id?: string }[] }
      const models = (json.data ?? []).map(m => m.id).filter((x): x is string => Boolean(x))
      const hit = models.includes(input.model)
      return {
        ok: true,
        detail: hit
          ? `连接成功，模型 ${input.model} 可用（共 ${models.length} 个模型）`
          : `连接成功（列表里没看到 ${input.model}，可能仍可用；共 ${models.length} 个模型）`,
        models
      }
    } catch (error) {
      return { ok: false, detail: explainFetchError(error, input.baseUrl) }
    }
  })

  ipcMain.handle('gewu:list-models', async (_e, input: { baseUrl: string; apiKey?: string; id?: string }) => {
    const key = input.apiKey?.trim() || (input.id ? deps.store.getSecret(input.id) : null)
    if (!key) throw new Error('缺少 API Key')
    const res = await fetch(modelsUrl(input.baseUrl), {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(25_000)
    })
    if (!res.ok) throw new Error(friendlyHttpError(res.status, await res.text()))
    const json = await res.json() as { data?: { id?: string }[] }
    return (json.data ?? []).map(m => m.id).filter(Boolean)
  })

  ipcMain.handle('gewu:read-scene', () => deps.getSceneStore().read())

  ipcMain.handle('gewu:write-scene', async (_e, payload: { scene: Scene; source: string }) => {
    try {
      await deps.getSceneStore().write(payload.scene)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:pick-image', async () => {
    const win = deps.getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择参考图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const buf = await readFile(path)
    const ext = extname(path).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    return { name: basename(path), path, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
  })

  ipcMain.handle('gewu:import-asset', async (_e, sourcePath: string) => {
    const assetsDir = join(deps.getSceneStore().workspace, 'assets')
    await mkdir(assetsDir, { recursive: true })
    const name = basename(sourcePath).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    await copyFile(sourcePath, join(assetsDir, name))
    const st = await stat(join(assetsDir, name))
    return { name, path: `assets/${name}`, kind: extname(name).slice(1), size: st.size }
  })

  ipcMain.handle('gewu:reveal', (_e, path: string) => { shell.showItemInFolder(path) })
  ipcMain.handle('gewu:open-folder', async (_e, path: string) => {
    try {
      await mkdir(path, { recursive: true })
      const error = await shell.openPath(path)
      return error ? { ok: false, error } : { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle('gewu:list-assets', () => deps.getSceneStore().listAssets())

  // ---- 配音（离线 SAPI，不需要 Key） ----
  ipcMain.handle('gewu:tts-voices', async () => {
    try {
      return { ok: true, voices: await listVoices() }
    } catch (error) {
      return { ok: false, voices: [], error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:tts', async (_e, input: { text: string; name?: string; voice?: string; rate?: number; volume?: number }) => {
    try {
      const { wav, durationSec } = await synthesize(input.text, {
        voice: input.voice, rate: input.rate, volume: input.volume
      })
      const assetsDir = join(deps.getSceneStore().workspace, 'assets')
      await mkdir(assetsDir, { recursive: true })
      // 文件名固定（调用方传 tts-<字幕id>），重新生成时直接覆盖，不会越攒越多
      const base = (input.name ?? `tts-${Date.now()}`).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      const fileName = base.endsWith('.wav') ? base : `${base}.wav`
      await writeFile(join(assetsDir, fileName), wav)
      return { ok: true, path: `assets/${fileName}`, durationSec, bytes: wav.length }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ---- 视觉模型 ----
  ipcMain.handle('gewu:set-vision-connection', async (_e, id: string | null) => {
    deps.store.setVisionId(id)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:vision-describe', async (_e, input: { path?: string; dataUrl?: string; question?: string }) => {
    const conn = deps.store.getVisionConnectionSecret()
    if (!conn) {
      return {
        ok: false,
        error: '还没有配置能看图的模型。到「模型设置 → 视觉模型」里选一个多模态接口（比如 gpt-4o、qwen-vl-max）。'
      }
    }
    try {
      const abs = input.path ? join(deps.getSceneStore().workspace, input.path) : undefined
      const { text, model, ms } = await describeImage(conn, { path: abs, dataUrl: input.dataUrl }, input.question)
      return { ok: true, text, model, ms }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:send-prompt', async (_e, text: string, context?: PromptContext) => {
    await deps.bridge.prompt(text, context)
  })
  ipcMain.handle('gewu:cancel-prompt', () => { deps.bridge.cancel() })

  ipcMain.handle('gewu:new-session', async () => {
    await deps.bridge.newSession()
    await deps.drafts.clearChat()
  })

  // ---- 草稿 ----
  const draftResult = async (extra?: { draftId?: string }) => {
    const drafts = await deps.drafts.list()
    const draft = extra?.draftId ? drafts.find(d => d.id === extra.draftId) : undefined
    deps.broadcast('gewu:drafts-changed', drafts)
    return { ok: true, draft, drafts }
  }

  ipcMain.handle('gewu:list-drafts', () => deps.drafts.list())

  ipcMain.handle('gewu:create-draft', async (_e, input?: { name?: string; template?: 'blank' | 'demo'; fromId?: string }) => {
    try {
      const created = input?.fromId
        ? await deps.drafts.duplicate(input.fromId)
        : await deps.drafts.create(input?.name, input?.template ?? 'demo')
      return await draftResult({ draftId: created.id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:open-draft', async (_e, id: string) => {
    try {
      await deps.switchDraft(id)
      return await draftResult({ draftId: id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:rename-draft', async (_e, id: string, name: string) => {
    try {
      await deps.drafts.rename(id, name)
      if (id === deps.drafts.activeId) {
        const summary = await deps.drafts.summaryOf(id)
        deps.broadcast('gewu:draft-opened', { id, name: summary?.name ?? name, dir: deps.drafts.activeDir() })
      }
      return await draftResult({ draftId: id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:duplicate-draft', async (_e, id: string) => {
    try {
      const copy = await deps.drafts.duplicate(id)
      return await draftResult({ draftId: copy.id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:delete-draft', async (_e, id: string) => {
    try {
      await deps.drafts.remove(id)
      return await draftResult()
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:set-draft-pinned', async (_e, id: string, pinned: boolean) => {
    try {
      await deps.drafts.pin(id, pinned)
      return await draftResult({ draftId: id })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:reveal-draft', (_e, id: string) => {
    const dir = deps.drafts.dirOf(id)
    if (dir && existsSync(dir)) shell.showItemInFolder(dir)
  })

  ipcMain.handle('gewu:open-draft-library', () => { deps.openDraftWindow() })

  ipcMain.handle('gewu:read-chat', () => deps.drafts.readChat())

  ipcMain.handle('gewu:write-cover', async (_e, bytes: Uint8Array) => {
    try {
      const dir = join(deps.getSceneStore().workspace, 'previews')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'cover.png'), Buffer.from(bytes))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  // ---- 导出位置 ----
  ipcMain.handle('gewu:get-export-settings', () => exportSettingsOf(deps))

  ipcMain.handle('gewu:set-export-settings', (_e, patch: Partial<Pick<ExportSettings, 'dir' | 'askEveryTime' | 'revealAfterExport'>>) => {
    deps.store.setExportSettings(patch)
    return exportSettingsOf(deps)
  })

  ipcMain.handle('gewu:choose-export-folder', async (_e, input?: { defaultPath?: string }) => {
    const win = deps.getWindow()
    const current = exportSettingsOf(deps)
    const result = await dialog.showOpenDialog(win!, {
      title: '选择导出位置',
      defaultPath: input?.defaultPath || current.resolvedDir,
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: '已取消' }
    const dir = result.filePaths[0]
    deps.store.rememberExportDir(dir)
    return { ok: true, dir }
  })

  ipcMain.handle('gewu:choose-export-path', async (_e, req: ExportRequest) => {
    // 调试/自动化：--export-path=<file> 时跳过系统保存框，直接返回该路径
    const forced = forcedExportPath()
    if (forced) return { ok: true, outPath: forced }
    const win = deps.getWindow()
    const settings = exportSettingsOf(deps)
    const result = await dialog.showSaveDialog(win!, {
      title: '导出视频',
      defaultPath: join(settings.resolvedDir, req.name || 'physics-video.mp4'),
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
    deps.store.rememberExportDir(dirname(result.filePath))
    return { ok: true, outPath: result.filePath }
  })

  /** 用户选的目录 + 文件名 → 真写盘。会记住目录、按设置决定是否打开文件夹 */
  ipcMain.handle('gewu:save-export-to', async (
    _e,
    input: { dir: string; name: string },
    bytes: Uint8Array,
    opts?: { reveal?: boolean; overwrite?: boolean }
  ) => {
    try {
      if (!input?.dir || !isAbsolute(input.dir)) throw new Error('导出位置必须是绝对路径')
      await mkdir(input.dir, { recursive: true })
      const base = safeFileName(input.name || 'physics-video')
      const fileName = /\.mp4$/i.test(base) ? base : `${base}.mp4`
      let full = join(input.dir, fileName)
      if (!opts?.overwrite) full = await uniquePath(full)
      await writeFile(full, Buffer.from(bytes))
      deps.store.rememberExportDir(input.dir)
      if (opts?.reveal ?? deps.store.getExportSettings().revealAfterExport) shell.showItemInFolder(full)
      return { ok: true, path: full }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /** 底层裸写（自检脚本用）：不记目录、不弹资源管理器 */
  ipcMain.handle('gewu:save-export', async (_e, outPath: string, bytes: Uint8Array) => {
    try {
      await writeFile(outPath, Buffer.from(bytes))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * agent 触发的导出：不弹框、不打断用户。
   * 用户设过导出目录就写那儿，否则落当前草稿的 exports/。
   */
  ipcMain.handle('gewu:save-workspace-export', async (_e, name: string, bytes: Uint8Array) => {
    try {
      const configured = deps.store.getExportSettings().dir
      const dir = configured || join(deps.getSceneStore().workspace, 'exports')
      await mkdir(dir, { recursive: true })
      const safe = safeFileName(name).replace(/\.mp4$/i, '') + '.mp4'
      const full = await uniquePath(join(dir, safe))
      await writeFile(full, Buffer.from(bytes))
      if (configured) deps.store.rememberExportDir(configured)
      return { ok: true, path: full }
    } catch (error) {
      return { ok: false, path: '', error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:write-asset', async (_e, name: string, bytes: Uint8Array) => {
    try {
      const dir = join(deps.getSceneStore().workspace, 'previews')
      await mkdir(dir, { recursive: true })
      const safe = name.replace(/[^\w.\-]/g, '_')
      const full = join(dir, safe)
      await writeFile(full, Buffer.from(bytes))
      return { ok: true, path: `previews/${safe}` }
    } catch (error) {
      return { ok: false, path: '', error: error instanceof Error ? error.message : String(error) }
    }
  })
}

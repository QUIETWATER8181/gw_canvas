import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import type { ConfigStore } from './store'
import type { SceneStore } from './scene-store'
import type { AgentBridge } from './agent/bridge'
import type { AppState, ExportRequest, PromptContext } from '@shared/ipc'
import type { Scene } from '@shared/scene'
import { friendlyHttpError, modelsUrl } from './agent/http-errors'

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
  sceneStore: SceneStore
  bridge: AgentBridge
  getWindow(): BrowserWindow | null
}

function stateOf(deps: IpcDeps): AppState {
  return {
    workspace: deps.sceneStore.workspace,
    scenePath: deps.sceneStore.scenePath,
    connections: deps.store.list(),
    activeConnectionId: deps.store.getActiveId(),
    agent: deps.bridge.getStatus()
  }
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('gewu:get-state', () => stateOf(deps))

  ipcMain.handle('gewu:save-connection', (_e, input) => {
    deps.store.upsert(input)
    void deps.bridge.newSession().catch(() => undefined)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:delete-connection', (_e, id: string) => {
    deps.store.remove(id)
    return stateOf(deps)
  })

  ipcMain.handle('gewu:set-active-connection', (_e, id: string) => {
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

  ipcMain.handle('gewu:read-scene', () => deps.sceneStore.read())

  ipcMain.handle('gewu:write-scene', async (_e, payload: { scene: Scene; source: string }) => {
    try {
      await deps.sceneStore.write(payload.scene)
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
    const assetsDir = join(deps.sceneStore.workspace, 'assets')
    await mkdir(assetsDir, { recursive: true })
    const name = basename(sourcePath).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    await copyFile(sourcePath, join(assetsDir, name))
    const st = await stat(join(assetsDir, name))
    return { name, path: `assets/${name}`, kind: extname(name).slice(1), size: st.size }
  })

  ipcMain.handle('gewu:reveal', (_e, path: string) => { shell.showItemInFolder(path) })
  ipcMain.handle('gewu:list-assets', () => deps.sceneStore.listAssets())

  ipcMain.handle('gewu:send-prompt', async (_e, text: string, context?: PromptContext) => {
    await deps.bridge.prompt(text, context)
  })

  ipcMain.handle('gewu:cancel-prompt', () => { deps.bridge.cancel() })

  ipcMain.handle('gewu:new-session', async () => { await deps.bridge.newSession() })

  ipcMain.handle('gewu:choose-export-path', async (_e, req: ExportRequest) => {
    const win = deps.getWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: '导出视频',
      defaultPath: join(deps.sceneStore.workspace, req.name || 'physics-video.mp4'),
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false, error: '已取消' }
    return { ok: true, outPath: result.filePath }
  })

  ipcMain.handle('gewu:save-export', async (_e, outPath: string, bytes: Uint8Array) => {
    try {
      await writeFile(outPath, Buffer.from(bytes))
      shell.showItemInFolder(outPath)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:save-workspace-export', async (_e, name: string, bytes: Uint8Array) => {
    try {
      const dir = join(deps.sceneStore.workspace, 'exports')
      await mkdir(dir, { recursive: true })
      const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').replace(/\.mp4$/i, '') + '.mp4'
      const full = join(dir, safe)
      await writeFile(full, Buffer.from(bytes))
      return { ok: true, path: full }
    } catch (error) {
      return { ok: false, path: '', error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('gewu:write-asset', async (_e, name: string, bytes: Uint8Array) => {
    try {
      const dir = join(deps.sceneStore.workspace, 'previews')
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

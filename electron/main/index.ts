import { app, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { ConfigStore } from './store'
import { SceneStore } from './scene-store'
import { DraftStore } from './draft-store'
import { cleanupTempFiles } from './atomic'
import { AgentBridge } from './agent/bridge'
import { registerIpc } from './ipc'
import { AssetSearch } from './web-search'
import { KnowledgeBase } from './knowledge'
import type { Scene } from '@shared/scene'

let mainWindow: BrowserWindow | null = null
let draftWindow: BrowserWindow | null = null
let store: ConfigStore
let sceneStore: SceneStore
let draftStore: DraftStore
let bridge: AgentBridge
let assetSearch: AssetSearch
let knowledge: KnowledgeBase

// --log=<file>：把主进程的 console 落到文件。
// Windows 上 Electron 是 GUI 子系统程序，PowerShell 的 > / *> 重定向收不到它的 stdout，
// 联调时只能靠这个。
const logArgv = process.argv.find(a => a.startsWith('--log='))
if (logArgv) {
  const logFile = logArgv.slice('--log='.length)
  const { appendFileSync } = require('node:fs') as typeof import('node:fs')
  const fmt = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v instanceof Error) return v.stack ?? v.message
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  const patch = (level: string, orig: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      try { appendFileSync(logFile, `[${level}] ${args.map(fmt).join(' ')}\n`) } catch { /* ignore */ }
      orig(...args)
    }
  console.log = patch('log', console.log.bind(console))
  console.error = patch('err', console.error.bind(console))
  console.warn = patch('warn', console.warn.bind(console))
}

const isDev = !app.isPackaged
const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

// 开发/测试用：--user-data=<dir> 把整个应用数据目录换掉。
// 自动化测试不该碰作者真实的草稿、配置和导出记录。
const userDataArg = process.argv.find(a => a.startsWith('--user-data='))
if (userDataArg) {
  const dir = resolve(userDataArg.slice('--user-data='.length))
  mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
}

// 只允许一个实例：两个实例同时写同一份 scene.json / config.json 会互相覆盖
// （实测把 config.json 写成了半截 JSON，下次启动直接「配置丢了」）。
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gewu',
    // corsEnabled + ACAO 响应头：否则 <img> 会把 canvas 标脏，toDataURL/getImageData 直接抛错，
    // 带图片的场景就没法渲染预览、也没法导出
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false }
  }
])

function runtimeRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'dsh-runtime')
  return join(app.getAppPath(), 'vendor', 'dsh-runtime')
}

function agentsDoc(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'AGENTS.md')
  return join(app.getAppPath(), 'resources', 'AGENTS.md')
}

/** resources/ 下的随包文件 */
function resourceFile(name: string): string {
  if (app.isPackaged) return join(process.resourcesPath, name)
  return join(app.getAppPath(), 'resources', name)
}

/** 知识库目录（物理 / 数学 / 分镜 md） */
function knowledgeDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'knowledge')
  return join(app.getAppPath(), 'resources', 'knowledge')
}

/** 把相对路径拼进基准目录；越界（../ 或绝对路径）返回 null */
function safeJoin(base: string, rel: string): string | null {
  const abs = resolve(base, rel)
  if (abs !== resolve(base) && !abs.startsWith(resolve(base) + sep)) return null
  return abs
}

/** 读本地文件并带上 CORS 头（否则 canvas 会被判跨域污染，toDataURL 直接抛） */
async function serveFile(abs: string): Promise<Response> {
  const upstream = await net.fetch(pathToFileURL(abs).toString())
  const headers = new Headers(upstream.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', 'no-cache')
  return new Response(upstream.body, { status: upstream.status, headers })
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#0a0e13',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0e13', symbolColor: '#93a4b1', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  if (isDev) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`)
    })
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer gone]', JSON.stringify(details))
    })
  }

  const search = process.argv.includes('--selftest')
    ? `selftest=1${process.argv.includes('--full') ? '&full=1' : ''}`
    : ''
  if (RENDERER_DEV_URL) {
    await mainWindow.loadURL(RENDERER_DEV_URL + (search ? `?${search}` : ''))
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'), search ? { search } : undefined)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    // 编辑器关了就把草稿库也关掉，不留一个孤零零的窗口占着进程
    if (draftWindow) draftWindow.close()
  })
}

/**
 * 草稿库窗口（照达芬奇「项目管理器」/ 剪映「草稿箱」的做法：独立窗口）。
 * 单例：再点一次只是把已有窗口提到前面。
 */
function createDraftWindow(): void {
  if (draftWindow && !draftWindow.isDestroyed()) {
    if (draftWindow.isMinimized()) draftWindow.restore()
    draftWindow.show()
    draftWindow.focus()
    return
  }
  draftWindow = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 840,
    minHeight: 560,
    show: false,
    title: '格物 · 草稿库',
    backgroundColor: '#0a0e13',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0e13', symbolColor: '#93a4b1', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  draftWindow.once('ready-to-show', () => draftWindow?.show())
  draftWindow.on('closed', () => { draftWindow = null })

  const devBase = RENDERER_DEV_URL
    ? new URL('drafts.html', RENDERER_DEV_URL.endsWith('/') ? RENDERER_DEV_URL : `${RENDERER_DEV_URL}/`).toString()
    : ''
  if (devBase) {
    void draftWindow.loadURL(devBase)
  } else {
    void draftWindow.loadFile(join(__dirname, '../renderer/drafts.html'))
  }
}

/** 向所有窗口广播（草稿增删改两个窗口都要知道） */
function broadcast(channel: string, payload: unknown): void {
  for (const win of [mainWindow, draftWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/**
 * 切换草稿：换工作区、重启 agent（agent 的 cwd 就是草稿目录）、广播给两个窗口。
 * 顺序很重要：先把旧草稿的对话落盘，再换 activeId，否则最后几条消息会写到新草稿里。
 */
async function activateDraft(id: string): Promise<void> {
  if (id === draftStore.activeId) return
  if (bridge?.isBusy()) {
    throw new Error('agent 正在处理上一条消息。等它做完，或先点「停止」，再切草稿。')
  }
  draftStore.flushAll()
  const summary = await draftStore.open(id)
  const previous = sceneStore
  const next = new SceneStore(draftStore.activeDir(), agentsDoc())
  await next.init()
  sceneStore = next
  previous?.dispose()
  await bridge.newSession().catch(error => {
    console.error('切换草稿后重启 agent 失败', error)
  })
  broadcast('gewu:draft-opened', { id: summary.id, name: summary.name, dir: draftStore.activeDir() })
}

function wireBridge() {
  bridge = new AgentBridge({
    runtimeRoot: runtimeRoot(),
    pluginSource: resourceFile('gewu-tools.mjs'),
    dataRoot: join(app.getPath('userData'), 'agent'),
    getConnection: () => store.getActiveConnectionSecret(),
    getVisionConnection: () => store.getVisionConnectionSecret(),
    getWorkspace: () => sceneStore.workspace,
    getScenePath: () => sceneStore.scenePath,
    getDraftName: () => draftStore.activeName,
    search: assetSearch,
    knowledge,
    onChat: msg => {
      // 每个草稿各自留一份对话，切回去还能接着聊
      draftStore.recordChat(msg)
      mainWindow?.webContents.send('gewu:chat', msg)
      if (isDev) console.log(`[chat:${msg.role}] ${msg.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    },
    onStatus: status => mainWindow?.webContents.send('gewu:agent-status', status),
    onSceneChanged: patch => {
      mainWindow?.webContents.send('gewu:scene-changed', patch)
      sceneStore.invalidate()
    },
    invokeRendererTool: (inv, timeoutMs) => invokeRendererTool(inv, timeoutMs),
    log: (level, text) => {
      if (isDev) console.log(`[agent:${level}]`, text)
    }
  })
}

/** 主进程 → 渲染进程的工具调用（渲染/导出在渲染进程里做） */
const pendingTools = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>()
let toolSeq = 0

function invokeRendererTool(inv: { name: string; args: unknown }, timeoutMs = 180_000): Promise<unknown> {
  if (!mainWindow) return Promise.reject(new Error('窗口未就绪'))
  const id = `tool-${++toolSeq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingTools.delete(id)
      reject(new Error(`工具 ${inv.name} 渲染超时`))
    }, timeoutMs)
    pendingTools.set(id, { resolve, reject, timer })
    mainWindow!.webContents.send('gewu:tool-invoke', { id, name: inv.name, args: inv.args })
  })
}

ipcMain.on('gewu:tool-result', (_e, payload: { id: string; ok: boolean; result?: unknown; error?: string }) => {
  const p = pendingTools.get(payload.id)
  if (!p) return
  pendingTools.delete(payload.id)
  clearTimeout(p.timer)
  if (payload.ok) p.resolve(payload.result)
  else p.reject(new Error(payload.error ?? '工具执行失败'))
})

app.whenReady().then(async () => {
  if (!singleInstance) return
  const userData = app.getPath('userData')
  await mkdir(userData, { recursive: true })
  // 清掉上次被强杀留下的 *.tmp-*（writeFile 与 rename 之间退出会留下半截文件）
  await cleanupTempFiles(userData)
  store = new ConfigStore(join(userData, 'config.json'))
  await store.load()

  // 草稿库：老版本的单工作区会被整体迁移成第一个草稿
  draftStore = new DraftStore(userData)
  await draftStore.init()
  sceneStore = new SceneStore(draftStore.activeDir(), agentsDoc())

  // 自定义协议：
  //   gewu://workspace/<相对路径>  当前草稿的素材
  //   gewu://draft/<id>/<相对路径> 草稿库里任意草稿（封面缩略图）
  //   gewu://app/<相对路径>        渲染进程资源
  protocol.handle('gewu', async request => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.hostname === 'workspace') {
      const base = sceneStore.workspace
      const abs = safeJoin(base, rel)
      if (!abs) return new Response('forbidden', { status: 403 })
      return serveFile(abs)
    }
    if (url.hostname === 'draft') {
      const [id, ...rest] = rel.split('/')
      const dir = draftStore.dirOf(id)
      if (!dir) return new Response('forbidden', { status: 403 })
      const abs = safeJoin(dir, rest.join('/'))
      if (!abs) return new Response('forbidden', { status: 403 })
      return serveFile(abs)
    }
    if (url.hostname === 'app') {
      return net.fetch(pathToFileURL(join(__dirname, '../renderer', rel)).toString())
    }
    if (url.hostname === 'cache') {
      // 素材检索的缩略图缓存（只读，不允许 ../ 越界）
      const base = join(userData, 'cache', 'search')
      const abs = safeJoin(base, rel)
      if (!abs) return new Response('forbidden', { status: 403 })
      return serveFile(abs)
    }
    return new Response('not found', { status: 404 })
  })

  await sceneStore.init()
  assetSearch = new AssetSearch(join(userData, 'cache', 'search'))
  knowledge = new KnowledgeBase()
  await knowledge.load(knowledgeDir())
  wireBridge()
  registerIpc({
    store,
    drafts: draftStore,
    getSceneStore: () => sceneStore,
    bridge,
    search: assetSearch,
    knowledge,
    getWindow: () => mainWindow,
    switchDraft: activateDraft,
    openDraftWindow: createDraftWindow,
    broadcast
  })

  await createWindow()
  void bridge.start().catch(err => {
    console.error('agent start failed', err)
  })

  // 开发调试：--draft-window / --probe-window=drafts / --shot-window=drafts
  // 都会在启动时把草稿库窗口打开（探针和截图默认只作用于主窗口）
  const probeWindowArg = process.argv.find(a => a.startsWith('--probe-window='))
  const shotWindowArg = process.argv.find(a => a.startsWith('--shot-window='))
  const wantDraftWindow =
    process.argv.includes('--draft-window') ||
    probeWindowArg === '--probe-window=drafts' ||
    shotWindowArg === '--shot-window=drafts'
  if (wantDraftWindow) createDraftWindow()

  const windowFor = (which: string | undefined): BrowserWindow | null =>
    which === 'drafts' ? draftWindow : mainWindow

  // 开发调试：--prompt=... 直接发一条消息给 agent，--exit-after 结束后退出
  // 加 --prompt-ui 会附带一份合成的编辑器上下文（时间/选中图层/选区），用于验证上下文注入
  const promptArg = process.argv.find(a => a.startsWith('--prompt='))
  if (promptArg) {
    const text = promptArg.slice('--prompt='.length)
    setTimeout(() => {
      void (async () => {
        try {
          const ui = process.argv.includes('--prompt-ui')
            ? {
                time: 5.4,
                selectedLayerId: (await sceneStore.read()).layers[1]?.id,
                region: { x: 640, y: 320, w: 480, h: 260 }
              }
            : undefined
          await bridge.prompt(text, ui)
        } catch (error) {
          console.error('[cli] prompt failed', error)
        }
        if (process.argv.includes('--exit-after')) setTimeout(() => app.quit(), 800)
      })()
    }, 1200)
  }

  // 开发调试：--shot=<png路径> 截图窗口后退出
  //   --shot-click=<css选择器>  截图前先点一下（用来切 tab）
  //   --shot-wait=<ms>          等多久再截，默认 1200
  const shotArg = process.argv.find(a => a.startsWith('--shot='))
  if (shotArg) {
    const out = shotArg.slice('--shot='.length)
    const clickArg = process.argv.find(a => a.startsWith('--shot-click='))
    const waitArg = process.argv.find(a => a.startsWith('--shot-wait='))
    const wait = waitArg ? Number(waitArg.slice('--shot-wait='.length)) : 1200
    setTimeout(() => {
      void (async () => {
        try {
          const wc = windowFor(shotWindowArg?.slice('--shot-window='.length))?.webContents
          if (!wc) throw new Error('no window')
          if (clickArg) {
            const sel = clickArg.slice('--shot-click='.length)
            await wc.executeJavaScript(
              `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return !!el })()`
            )
            await new Promise(r => setTimeout(r, 500))
          }
          const img = await wc.capturePage()
          await writeFile(out, img.toPNG())
          console.log('[shot] saved', out, img.getSize())
        } catch (error) {
          console.error('[shot] failed', error)
        }
        app.exit(0)
      })()
    }, wait)
  }

  // 开发调试：--probe=<js表达式> 在渲染进程里求值并打印结果，用于验证界面结构
  //   --probe-click=<css选择器>  求值前先点一下
  const probeFileArg = process.argv.find(a => a.startsWith('--probe-file='))
  const probeArg = process.argv.find(a => a.startsWith('--probe='))
  if (probeArg || probeFileArg) {
    // 探针文件读不到时要立刻报错退出，否则就是「窗口开着、什么都不发生」，
    // 自动化脚本会一直等下去（曾经白等 4 分钟）。
    let js: string
    try {
      js = probeFileArg
        ? await readFile(probeFileArg.slice('--probe-file='.length), 'utf8')
        : probeArg!.slice('--probe='.length)
    } catch (error) {
      console.error('[probe] 读不到探针文件：' + (error instanceof Error ? error.message : String(error)))
      app.exit(2)
      return
    }
    const clickArg = process.argv.find(a => a.startsWith('--probe-click='))
    const waitArg = process.argv.find(a => a.startsWith('--probe-wait='))
    const wait = waitArg ? Number(waitArg.slice('--probe-wait='.length)) : 1500
    setTimeout(() => {
      void (async () => {
        try {
          const wc = windowFor(probeWindowArg?.slice('--probe-window='.length))?.webContents
          if (!wc) throw new Error('no window')
          if (clickArg) {
            const sel = clickArg.slice('--probe-click='.length)
            await wc.executeJavaScript(
              `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return !!el })()`
            )
            await new Promise(r => setTimeout(r, 500))
          }
          const value = await wc.executeJavaScript(js)
          console.log('[probe] ' + (typeof value === 'string' ? value : JSON.stringify(value)))
        } catch (error) {
          console.error('[probe] failed', error)
        }
        app.exit(0)
      })()
    }, wait)
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

app.on('window-all-closed', () => {
  void bridge?.stop()
  draftStore?.flushAll()
  store?.flushSync()
  if (process.platform !== 'darwin') {
    app.quit()
    // 子进程（DSH 运行时）有时不肯立刻退出，quit 会一直挂着。
    // 给 3 秒体面时间，然后硬退。
    setTimeout(() => app.exit(0), 3000)
  }
})

app.on('before-quit', () => {
  void bridge?.stop()
  draftStore?.flushAll()
  store?.flushSync()
})

import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } from 'electron'
import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { ConfigStore } from './store'
import { SceneStore } from './scene-store'
import { AgentBridge } from './agent/bridge'
import { registerIpc } from './ipc'
import type { Scene } from '@shared/scene'

let mainWindow: BrowserWindow | null = null
let store: ConfigStore
let sceneStore: SceneStore
let bridge: AgentBridge

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

  mainWindow.on('closed', () => { mainWindow = null })
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
    onChat: msg => {
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
  const userData = app.getPath('userData')
  await mkdir(userData, { recursive: true })
  store = new ConfigStore(join(userData, 'config.json'))
  await store.load()

  const workspace = join(userData, 'workspace')
  await mkdir(workspace, { recursive: true })
  sceneStore = new SceneStore(workspace, agentsDoc())

  // 自定义协议：gewu://workspace/<相对路径> 读取工作区资源
  protocol.handle('gewu', async request => {
    const url = new URL(request.url)
    if (url.hostname === 'workspace') {
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const abs = join(workspace, rel)
      if (!abs.startsWith(workspace)) return new Response('forbidden', { status: 403 })
      const upstream = await net.fetch(pathToFileURL(abs).toString())
      // 必须带 CORS 头，否则画布会被判为跨域污染
      const headers = new Headers(upstream.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cache-Control', 'no-cache')
      return new Response(upstream.body, { status: upstream.status, headers })
    }
    if (url.hostname === 'app') {
      const rel = decodeURIComponent(url.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(join(__dirname, '../renderer', rel)).toString())
    }
    return new Response('not found', { status: 404 })
  })

  await sceneStore.init()
  wireBridge()
  registerIpc({ store, sceneStore, bridge, getWindow: () => mainWindow })

  await createWindow()
  void bridge.start().catch(err => {
    console.error('agent start failed', err)
  })

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
          const wc = mainWindow?.webContents
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
          const wc = mainWindow?.webContents
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
  if (process.platform !== 'darwin') {
    app.quit()
    // 子进程（DSH 运行时）有时不肯立刻退出，quit 会一直挂着。
    // 给 3 秒体面时间，然后硬退。
    setTimeout(() => app.exit(0), 3000)
  }
})

app.on('before-quit', () => { void bridge?.stop() })

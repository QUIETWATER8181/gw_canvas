import { useEffect, useRef, useState } from 'react'
import type { AppState, ChatMessage, DraftSummary } from './shared/ipc'
import type { Scene } from './shared/scene'
import { emptyScene } from './shared/scene'
import { EditorContext, useEditorState } from './state/editor'
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { Stage } from './components/Stage'
import { Timeline } from './components/Timeline'
import { RightPanel } from './components/RightPanel'
import { ToolHost } from './components/ToolHost'
import { SettingsModal } from './components/SettingsModal'
import { ExportToast } from './components/ExportToast'
import { ExportDialog, type ExportStartInput } from './components/ExportDialog'
import { HelpDialog } from './components/HelpDialog'
import './styles/app.css'

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [scene, setScene] = useState<Scene>(emptyScene())
  const [ready, setReady] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' | 'info' } | null>(null)
  const [exportJob, setExportJob] = useState<{ running: boolean; frame: number; total: number; phase: string } | null>(null)
  const agentSourceRef = useRef(false)
  /** 左右栏宽度：可拖拽，记在本机；默认给内容留足空间 */
  const [leftW, setLeftW] = useState(() => {
    const saved = Number(localStorage.getItem('gewu.leftW'))
    return Number.isFinite(saved) && saved >= 240 ? saved : 340
  })
  const [rightW, setRightW] = useState(() => {
    const saved = Number(localStorage.getItem('gewu.rightW'))
    return Number.isFinite(saved) && saved >= 280 ? saved : 400
  })

  const editor = useEditorState(scene)

  // 自动化探针用的只读调试入口（桌面端，不对外暴露 DOM；探针脚本靠它验证时长/动画）
  useEffect(() => {
    ;(window as unknown as { __gewuDebug?: unknown }).__gewuDebug = {
      editor,
      getScene: () => editor.state.scene,
      getTime: () => editor.state.time
    }
  }, [editor])

  // 初始化
  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, sc, list, history] = await Promise.all([
        window.gewu.getState(),
        window.gewu.readScene(),
        window.gewu.listDrafts(),
        window.gewu.readChat()
      ])
      if (!alive) return
      setAppState(s)
      setScene(sc)
      setDrafts(list)
      setChat(history)
      setReady(true)
      editor.replaceScene(sc, { persist: false, label: '载入', resetHistory: true })
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅主进程事件
  useEffect(() => {
    const offChat = window.gewu.onChat(msg => {
      setChat(prev => {
        const i = prev.findIndex(m => m.id === msg.id)
        if (i >= 0) {
          const next = [...prev]
          next[i] = msg
          return next
        }
        return [...prev, msg]
      })
    })
    const offStatus = window.gewu.onAgentStatus(status => {
      setAppState(prev => (prev ? { ...prev, agent: status } : prev))
    })
    const offScene = window.gewu.onSceneChanged(patch => {
      agentSourceRef.current = true
      setScene(patch.scene)
      editor.replaceScene(patch.scene, { persist: false, label: 'AI 修改' })
      setTimeout(() => { agentSourceRef.current = false }, 0)
    })
    const offExport = window.gewu.onExportProgress(p => {
      setExportJob({ running: p.phase !== 'done' && p.phase !== 'error', frame: p.frame, total: p.total, phase: p.phase })
    })
    const offDrafts = window.gewu.onDraftsChanged(list => setDrafts(list))
    // 草稿库窗口点了「打开」：换场景、换对话、清掉撤销栈
    const offOpened = window.gewu.onDraftOpened(async draft => {
      try {
        const [sc, history] = await Promise.all([window.gewu.readScene(), window.gewu.readChat()])
        setScene(sc)
        setChat(history)
        editor.replaceScene(sc, { persist: false, label: '切换草稿', resetHistory: true })
        setAppState(prev => (prev ? { ...prev, draft } : prev))
        setToast({ text: `已切换到草稿「${draft.name}」`, kind: 'ok' })
      } finally {
        setSwitching(false)
      }
    })
    return () => { offChat(); offStatus(); offScene(); offExport(); offDrafts(); offOpened() }
  }, [editor])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  // 开发自检：?selftest 时渲染若干帧并导出一段 mp4，用于验证引擎与编码链路
  useEffect(() => {
    if (!ready || !location.search.includes('selftest')) return
    void (async () => {
      try {
        const { SceneRenderer } = await import('./engine/preview')
        const r = new SceneRenderer(scene.canvas.width, scene.canvas.height)
        const stamps = [2, 5, 10]
        for (const t of stamps) {
          const cap = r.capture(scene, t)
          if (r.lastErrors.length) console.log('SELFTEST frame error @' + t + ' ' + JSON.stringify(r.lastErrors))
          const plain = cap.preview.replace(/\x1b\[[0-9;]*m/g, '')
          await window.gewu.saveExport('_preview-' + t + '.txt', new TextEncoder().encode(plain))
          const b64 = cap.dataUrl.split(',')[1] ?? ''
          await window.gewu.saveExport('_frame-' + t + '.png', Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
          if (t === 10) {
            for (const only of ['graph', 'bg', 'formula']) {
              r.render(scene, t, { onlyLayerId: only })
              const d = r.element.toDataURL('image/png').split(',')[1] ?? ''
              await window.gewu.saveExport('_only-' + only + '.png', Uint8Array.from(atob(d), c => c.charCodeAt(0)))
            }
          }
        }
        console.log('SELFTEST frames ok, layers=' + scene.layers.length)

        // 图片管线自检：assets/kf_a.png 存在时，验证 g.image 能真的画出像素
        try {
          const probe = scene.layers.find(l => l.draw?.includes('kf_a.png'))
          const { preloadScene } = await import('./engine/assets')
          const probeScene = {
            ...scene,
            canvas: { ...scene.canvas, duration: 2 },
            layers: probe ? [probe] : [{
              id: 'probe', name: '图片自检', start: 0, end: 2,
              draw: "g.image('assets/kf_a.png', cx, cy, 640, 360)"
            }]
          }
          await preloadScene(probeScene)
          r.render(probeScene as typeof scene, 1)
          const W = r.element.width
          const H = r.element.height
          const box = r.element.getContext('2d')!.getImageData(0, 0, W, H).data
          // 纯色背景方差≈0；真画出图来方差会明显大于 0
          let sum = 0
          let sum2 = 0
          let lit = 0
          const n = box.length / 4
          for (let i = 0; i < box.length; i += 4) {
            const v = (box[i] + box[i + 1] + box[i + 2]) / 3
            sum += v
            sum2 += v * v
            if (v > 120) lit++
          }
          const mean = sum / n
          const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
          console.log('SELFTEST image mean=' + mean.toFixed(1) + ' sd=' + sd.toFixed(1) +
            ' bright=' + lit + ' errors=' + JSON.stringify(r.lastErrors))
        } catch (e) {
          console.log('SELFTEST image failed: ' + (e instanceof Error ? e.message : String(e)))
        }

        // 3D 图层自检：three.* 必须真的把像素合成到 2D 画布上
        try {
          const threeScene = {
            ...scene,
            canvas: { ...scene.canvas, duration: 2 },
            layers: [{
              id: 'probe3d', name: '3D 自检', start: 0, end: 2,
              draw: [
                "const s = three.scene({ pos: [4.2, 3.2, 5.6], look: [0,0,0] })",
                "three.axes(s, { size: 1.6 })",
                "three.arrow(s, [0,0,0], [1.6, 1.2, 0], { color: '#4fc3d9' })",
                "three.sphere(s, [0, 0, 0], 0.45, { color: '#f2b544' })",
                "three.label(s, [0, 1.4, 0], 'E', { color: '#ffffff', size: 0.34 })",
                "three.render(s)"
              ].join('\n')
            }]
          }
          r.render(threeScene as typeof scene, 0.6)
          const W3 = r.element.width
          const H3 = r.element.height
          const d3 = r.element.getContext('2d')!.getImageData(0, 0, W3, H3).data
          let lit3 = 0
          let colored = 0
          for (let i = 0; i < d3.length; i += 4) {
            const v = (d3[i] + d3[i + 1] + d3[i + 2]) / 3
            if (v > 40) lit3++
            const mx = Math.max(d3[i], d3[i + 1], d3[i + 2])
            const mn = Math.min(d3[i], d3[i + 1], d3[i + 2])
            if (v > 40 && mx - mn > 40) colored++
          }
          console.log('SELFTEST three lit=' + lit3 + ' colored=' + colored + ' errors=' + JSON.stringify(r.lastErrors))
        } catch (e) {
          console.log('SELFTEST three failed: ' + (e instanceof Error ? e.message : String(e)))
        }

        // 参考图 prompt：必须带路径、导入步骤、配色重建、拆图层
        {
          const { referencePrompt } = await import('./content/prompts')
          const text = referencePrompt('参考.png', 'C:\\a\\ref.png')
          const need = ['参考.png', 'C:\\a\\ref.png', 'asset_import', 'image_inspect', 'theme', '图层']
          const missing = need.filter(k => !text.includes(k))
          console.log('SELFTEST reference ' + (missing.length ? 'MISSING ' + JSON.stringify(missing) : 'ok, ' + text.length + ' chars'))
        }

        // prompt 拼装自检：首尾帧流程必须把两个路径、时长、必要步骤都带上
        {
          const { keyframePrompt } = await import('./content/prompts')
          const text = keyframePrompt({
            firstPath: 'C:\\a\\first.png',
            lastPath: 'C:\\a\\last.png',
            duration: 8,
            note: '镜头缓慢推近',
            width: 1920,
            height: 1080
          })
          const need = ['C:\\a\\first.png', 'C:\\a\\last.png', '8 秒', '镜头缓慢推近',
            'image_inspect', 'image_compare', 'asset_import', 'times: [0, 4.0, 8]', '1920×1080']
          const missing = need.filter(k => !text.includes(k))
          console.log('SELFTEST prompt ' + (missing.length ? 'MISSING ' + JSON.stringify(missing) : 'ok, ' + text.length + ' chars'))
        }

        const { exportScene } = await import('./engine/export')
        const full = location.search.includes('full')
        const out = full
          ? await exportScene({ scene, fps: scene.canvas.fps })
          : await exportScene({ scene, to: 4, fps: 24 })
        // 注意：--full 也写到 _selftest-full.mp4，绝不覆盖 demo.mp4（那是要交付的样片）
        const res = await window.gewu.saveExport(full ? '_selftest-full.mp4' : '_selftest.mp4', out.bytes)
        console.log('SELFTEST export ' + JSON.stringify({ ok: res.ok, frames: out.frames, bytes: out.bytes.length, container: out.container }))
      } catch (e) {
        console.log('SELFTEST failed: ' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setTimeout(() => window.close(), 400)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    localStorage.setItem('gewu.leftW', String(leftW))
  }, [leftW])

  useEffect(() => {
    localStorage.setItem('gewu.rightW', String(rightW))
  }, [rightW])

  /** 拖左右栏边界：夹住舞台最小 360px，双击复位 */
  function startPanelResize(side: 'left' | 'right', e: React.PointerEvent) {
    e.preventDefault()
    const startX = e.clientX
    const startLeft = leftW
    const startRight = rightW
    const minCenter = 360
    const move = (ev: PointerEvent) => {
      if (side === 'left') {
        const max = Math.max(240, window.innerWidth - startRight - minCenter - 12)
        setLeftW(Math.round(Math.min(max, Math.max(240, startLeft + ev.clientX - startX))))
      } else {
        const max = Math.max(280, window.innerWidth - startLeft - minCenter - 12)
        setRightW(Math.round(Math.min(max, Math.max(280, startRight - (ev.clientX - startX)))))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!ready || !appState) {
    return (
      <div className="boot">
        <div className="boot-mark">
          <span className="boot-ring" />
          <span className="boot-dot" />
        </div>
        <div className="boot-text">格物 · 正在载入</div>
      </div>
    )
  }

  return (
    <EditorContext.Provider value={editor}>
      <div className="app">
        <TitleBar
          state={appState}
          drafts={drafts}
          switching={switching}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenExport={() => setExportOpen(true)}
          onOpenLibrary={() => void window.gewu.openDraftLibrary()}
          onOpenDraft={id => void switchDraft(id)}
          onNewDraft={() => void newDraft()}
          onNewSession={() => { setChat([]); void window.gewu.newSession() }}
          onOpenHelp={() => setHelpOpen(true)}
        />
        <div className="workbench">
          <div
            className="wb-top"
            style={{ gridTemplateColumns: `${leftW}px 6px minmax(0, 1fr) 6px ${rightW}px` }}
          >
            <LeftPanel onToast={setToast} />
            <div
              className="panel-resizer"
              title="拖动调整左栏宽度 · 双击复位"
              onPointerDown={e => startPanelResize('left', e)}
              onDoubleClick={() => setLeftW(340)}
            />
            <Stage onToast={setToast} exportJob={exportJob} />
            <div
              className="panel-resizer"
              title="拖动调整右栏宽度 · 双击复位"
              onPointerDown={e => startPanelResize('right', e)}
              onDoubleClick={() => setRightW(400)}
            />
            <RightPanel chat={chat} agent={appState.agent} onOpenSettings={() => setSettingsOpen(true)} onOpenHelp={() => setHelpOpen(true)} onToast={setToast} />
          </div>
          <Timeline />
        </div>
        <ToolHost
          onExport={async args => {
            // agent 触发的导出：不弹框，落到「设置里的导出目录」，没设置就当前草稿的 exports/
            const name = String(args.name ?? `${editor.state.scene.meta.title || 'physics-video'}.mp4`)
            try {
              setExportJob({ running: true, frame: 0, total: 0, phase: 'prepare' })
              const result = await runExport(args.from as number | undefined, args.to as number | undefined, {
                fps: args.fps as number | undefined,
                width: args.width as number | undefined,
                height: args.height as number | undefined,
                bitrate: args.bitrate as number | undefined,
                quality: args.quality as 'high' | 'balanced' | 'small' | undefined
              })
              const saved = await window.gewu.saveWorkspaceExport(name, result.bytes)
              if (!saved.ok) throw new Error(saved.error ?? '写入失败')
              setToast({ text: `已导出 ${result.frames} 帧 · ${result.seconds.toFixed(1)}s → ${saved.path}`, kind: 'ok' })
              return { path: saved.path, frames: result.frames, seconds: result.seconds }
            } catch (error) {
              setExportJob(null)
              throw error
            }
          }}
          onToast={setToast}
        />
        <SettingsModal
          open={settingsOpen}
          state={appState}
          onClose={() => setSettingsOpen(false)}
          onChanged={next => setAppState(next)}
          onToast={setToast}
        />
        <ExportDialog
          open={exportOpen}
          scene={editor.state.scene}
          draftName={appState.draft?.name ?? '未命名草稿'}
          onClose={() => setExportOpen(false)}
          onStart={input => void startExport(input)}
        />
        <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
        {exportJob?.running && <ExportToast job={exportJob} />}
      </div>
    </EditorContext.Provider>
  )

  async function runExport(from?: number, to?: number, format?: { width?: number; height?: number; fps?: number; bitrate?: number; quality?: 'high' | 'balanced' | 'small' }) {
    const { exportScene } = await import('./engine/export')
    const result = await exportScene({
      scene: editor.state.scene,
      from,
      to,
      width: format?.width,
      height: format?.height,
      fps: format?.fps,
      bitrate: format?.bitrate,
      quality: format?.quality,
      onProgress: (frame, total, phase) => setExportJob({ running: true, frame, total, phase })
    })
    setExportJob({ running: false, frame: 0, total: 0, phase: 'done' })
    return { bytes: result.bytes, frames: result.frames, seconds: result.seconds, width: result.width, height: result.height, fps: result.fps }
  }

  /** 用户在导出对话框里定好位置后走这里 */
  async function startExport(input: ExportStartInput) {
    setExportOpen(false)
    try {
      setExportJob({ running: true, frame: 0, total: 0, phase: 'prepare' })
      const result = await runExport(input.from, input.to, input)
      const saved = await window.gewu.saveExportTo(
        { dir: input.dir, name: input.name },
        result.bytes,
        { reveal: input.reveal, overwrite: input.overwrite }
      )
      if (!saved.ok || !saved.path) throw new Error(saved.error ?? '写入失败')
      setToast({ text: `已导出 ${result.frames} 帧 · ${result.width}×${result.height}@${result.fps} · ${result.seconds.toFixed(1)}s → ${saved.path}`, kind: 'ok' })
    } catch (error) {
      setExportJob(null)
      setToast({ text: `导出失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' })
    }
  }

  async function switchDraft(id: string) {
    if (!appState || id === appState.draft?.id) return
    setSwitching(true)
    try {
      const r = await window.gewu.openDraft(id)
      if (!r.ok) throw new Error(r.error ?? '切换失败')
      if (r.drafts) setDrafts(r.drafts)
    } catch (error) {
      setSwitching(false)
      setToast({ text: error instanceof Error ? error.message : String(error), kind: 'err' })
    }
  }

  async function newDraft() {
    try {
      const r = await window.gewu.createDraft({})
      if (!r.ok || !r.draft) throw new Error(r.error ?? '新建失败')
      if (r.drafts) setDrafts(r.drafts)
      await switchDraft(r.draft.id)
      setToast({ text: `已新建草稿「${r.draft.name}」，到草稿库可以改名`, kind: 'ok' })
    } catch (error) {
      setToast({ text: error instanceof Error ? error.message : String(error), kind: 'err' })
    }
  }
}

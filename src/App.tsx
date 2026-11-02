import { useEffect, useRef, useState } from 'react'
import type { AppState, ChatMessage } from './shared/ipc'
import type { Scene } from './shared/scene'
import { emptyScene } from './shared/scene'
import { EditorContext, useEditorState } from './state/editor'
import { TitleBar } from './components/TitleBar'
import { LeftPanel } from './components/LeftPanel'
import { Stage } from './components/Stage'
import { RightPanel } from './components/RightPanel'
import { ToolHost } from './components/ToolHost'
import { SettingsModal } from './components/SettingsModal'
import { ExportToast } from './components/ExportToast'
import './styles/app.css'

export default function App() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [scene, setScene] = useState<Scene>(emptyScene())
  const [ready, setReady] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' | 'info' } | null>(null)
  const [exportJob, setExportJob] = useState<{ running: boolean; frame: number; total: number; phase: string } | null>(null)
  const agentSourceRef = useRef(false)

  const editor = useEditorState(scene)

  // 初始化
  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, sc] = await Promise.all([window.gewu.getState(), window.gewu.readScene()])
      if (!alive) return
      setAppState(s)
      setScene(sc)
      setReady(true)
      editor.replaceScene(sc, { persist: false, label: '载入' })
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
    return () => { offChat(); offStatus(); offScene(); offExport() }
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
        const res = await window.gewu.saveExport(full ? 'demo.mp4' : '_selftest.mp4', out.bytes)
        console.log('SELFTEST export ' + JSON.stringify({ ok: res.ok, frames: out.frames, bytes: out.bytes.length, container: out.container }))
      } catch (e) {
        console.log('SELFTEST failed: ' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setTimeout(() => window.close(), 400)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

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
          onOpenSettings={() => setSettingsOpen(true)}
          onExport={() => void doExport()}
          onNewSession={() => { setChat([]); void window.gewu.newSession() }}
        />
        <div className="workspace">
          <LeftPanel onToast={setToast} />
          <Stage onToast={setToast} exportJob={exportJob} />
          <RightPanel chat={chat} agent={appState.agent} onOpenSettings={() => setSettingsOpen(true)} onToast={setToast} />
        </div>
        <ToolHost
          onExport={async args => {
            // agent 触发的导出直接落到工作区 exports/，不打断用户
            const name = String(args.name ?? `${editor.state.scene.meta.title || 'physics-video'}.mp4`)
            try {
              setExportJob({ running: true, frame: 0, total: 0, phase: 'prepare' })
              const result = await runExport(null, args.from as number | undefined, args.to as number | undefined)
              const saved = await window.gewu.saveWorkspaceExport(name, result.bytes)
              if (!saved.ok) throw new Error(saved.error ?? '写入失败')
              setToast({ text: `已导出 ${result.frames} 帧 · ${result.seconds.toFixed(1)}s → exports/`, kind: 'ok' })
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
        />
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
        {exportJob?.running && <ExportToast job={exportJob} />}
      </div>
    </EditorContext.Provider>
  )

  async function runExport(outPath: string | null, from?: number, to?: number) {
    const { exportScene } = await import('./engine/export')
    const result = await exportScene({
      scene: editor.state.scene,
      from,
      to,
      onProgress: (frame, total, phase) => setExportJob({ running: true, frame, total, phase })
    })
    setExportJob({ running: false, frame: 0, total: 0, phase: 'done' })
    if (outPath) {
      const saved = await window.gewu.saveExport(outPath, result.bytes)
      if (!saved.ok) throw new Error(saved.error ?? '写入失败')
      setToast({ text: `已导出 ${result.frames} 帧 · ${result.seconds.toFixed(1)}s`, kind: 'ok' })
    }
    return { bytes: result.bytes, frames: result.frames, seconds: result.seconds }
  }

  async function doExport() {
    const out = await window.gewu.chooseExportPath({ name: `${editor.state.scene.meta.title || 'physics-video'}.mp4` })
    if (!out.ok || !out.outPath) return
    try {
      setExportJob({ running: true, frame: 0, total: 0, phase: 'prepare' })
      await runExport(out.outPath)
    } catch (error) {
      setExportJob(null)
      setToast({ text: `导出失败：${error instanceof Error ? error.message : String(error)}`, kind: 'err' })
    }
  }
}

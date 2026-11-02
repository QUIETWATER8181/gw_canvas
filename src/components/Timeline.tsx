import { useMemo, useRef, useState } from 'react'
import { useEditor } from '../state/editor'

export function Timeline() {
  const editor = useEditor()
  const { scene, time, playing, selectedLayerId } = editor.state
  const [zoom, setZoom] = useState(1)
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragBar, setDragBar] = useState<{ id: string; mode: 'move' | 'l' | 'r'; startX: number; origStart: number; origEnd: number } | null>(null)

  const duration = scene.canvas.duration
  const ticks = useMemo(() => {
    const step = duration <= 6 ? 0.5 : duration <= 15 ? 1 : duration <= 40 ? 2 : 5
    const out: number[] = []
    for (let t = 0; t <= duration + 1e-6; t += step) out.push(Number(t.toFixed(2)))
    return out
  }, [duration])

  const pct = (t: number) => `${(t / duration) * 100}%`

  function timeAt(clientX: number): number {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width
    return Math.max(0, Math.min(duration, x * duration))
  }

  function onTrackDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.tl-bar')) return
    editor.setTime(timeAt(e.clientX))
    const move = (ev: MouseEvent) => editor.setTime(timeAt(ev.clientX))
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function onBarDown(e: React.MouseEvent, layerId: string, mode: 'move' | 'l' | 'r') {
    e.stopPropagation()
    editor.select(layerId)
    const layer = scene.layers.find(l => l.id === layerId)
    if (!layer) return
    // 这里必须用 mousedown 时算好的局部常量。
    // 之前读的是 dragBar 状态，但此刻 setDragBar 还没提交，闭包里拿到的永远是 null，
    // 于是退化成 origStart=0 / origEnd=duration —— 拖右手柄会把 end 直接吸到片尾。
    const origStart = layer.start ?? 0
    const origEnd = layer.end ?? duration
    setDragBar({ id: layerId, mode, startX: e.clientX, origStart, origEnd })
    const el = trackRef.current!
    const rect = el.getBoundingClientRect()
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    const move = (ev: MouseEvent) => {
      const dt = ((ev.clientX - e.clientX) / rect.width) * duration
      let s = origStart
      let en = origEnd
      if (mode === 'move') {
        const len = origEnd - origStart
        s = clamp(origStart + dt, 0, Math.max(0, duration - len))
        en = s + len
      } else if (mode === 'l') {
        s = clamp(origStart + dt, 0, origEnd - 0.2)
      } else {
        en = clamp(origEnd + dt, origStart + 0.2, duration)
      }
      editor.updateLayer(layerId, { start: round(s), end: round(en) }, { label: '调整图层时间' })
    }
    const up = () => { setDragBar(null); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const step = 1 / scene.canvas.fps

  return (
    <div className="timeline">
      <div className="tl-transport">
        <button className="icon-btn" title="回到开头" onClick={() => editor.setTime(0)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h2v16H6zM20 4v16L9 12z" /></svg>
        </button>
        <button className="icon-btn" title="上一帧" onClick={() => editor.setTime(time - step)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 4v16L4 12z" /></svg>
        </button>
        <button className={`play-btn ${playing ? 'on' : ''}`} title={playing ? '暂停（空格）' : '播放（空格）'} onClick={() => editor.setPlaying(!playing)}>
          {playing ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
          )}
        </button>
        <button className="icon-btn" title="下一帧" onClick={() => editor.setTime(time + step)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4v16l11-8z" /></svg>
        </button>
        <div className="tl-time mono">
          <span className="tl-time-cur">{time.toFixed(2)}</span>
          <span className="tl-time-sep">/</span>
          <span className="tl-time-total">{duration.toFixed(2)}s</span>
        </div>
        <div className="tl-meta">
          <span className="badge">{scene.canvas.fps}fps</span>
          <span className="badge">{scene.canvas.width}×{scene.canvas.height}</span>
        </div>
        <div className="spacer" />
        <label className="tl-dur">
          时长
          <input
            className="input tl-dur-input"
            type="number"
            min={1}
            max={1800}
            step={0.5}
            value={duration}
            onChange={e => {
              const v = Math.max(1, Number(e.target.value) || 1)
              editor.updateScene(s => ({ ...s, canvas: { ...s.canvas, duration: v } }), { label: '改时长' })
            }}
          />
          s
        </label>
        <div className="tl-zoom">
          <button className="icon-btn" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>−</button>
          <span className="tiny mono">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>＋</button>
        </div>
      </div>

      <div className="tl-scroll">
        <div className="tl-inner" style={{ width: `${zoom * 100}%` }}>
          <div className="tl-ruler" onClick={onTrackDown}>
            {ticks.map(t => (
              <div key={t} className="tl-tick" style={{ left: pct(t) }}>
                <span>{t}s</span>
              </div>
            ))}
          </div>
          <div className="tl-tracks" ref={trackRef} onMouseDown={onTrackDown}>
            {scene.layers.length === 0 && <div className="tl-empty">还没有图层</div>}
            {scene.layers.map(layer => {
              const s = layer.start ?? 0
              const e = layer.end ?? duration
              const sel = layer.id === selectedLayerId
              return (
                <div key={layer.id} className={`tl-track ${sel ? 'sel' : ''}`}>
                  <div className="tl-track-name" onClick={() => editor.select(layer.id)}>
                    <span className={`tl-vis ${layer.visible === false ? 'off' : ''}`} />
                    {layer.name}
                  </div>
                  <div className="tl-lane">
                    <div
                      className={`tl-bar ${sel ? 'sel' : ''} ${dragBar?.id === layer.id ? 'dragging' : ''}`}
                      style={{ left: pct(s), width: pct(e - s) }}
                      onMouseDown={ev => onBarDown(ev, layer.id, 'move')}
                      title={`${s.toFixed(2)}–${e.toFixed(2)}s`}
                    >
                      <i className="tl-handle l" onMouseDown={ev => onBarDown(ev, layer.id, 'l')} />
                      <span className="tl-bar-label">{layer.name}</span>
                      <i className="tl-handle r" onMouseDown={ev => onBarDown(ev, layer.id, 'r')} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="tl-playhead" style={{ left: pct(time) }}>
              <span className="tl-playhead-cap" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

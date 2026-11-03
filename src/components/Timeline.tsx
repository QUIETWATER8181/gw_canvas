import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../state/editor'

/**
 * 时间轴对齐原则：刻度尺(ruler)、轨道区(lane)、播放头(playhead) 共用一个坐标系。
 * 唯一事实：pps = 每秒像素数。任何位置 = 该点时间 × pps。
 * 轨道区原点对准刻度尺 0s 刻度：两者都从 128px 图层名栏的右缘起算。
 * （NAME_W 必须与 app.css 中 .tl-corner/.tl-track-name 的宽度保持一致）
 */
const NAME_W = 128
const END_PAD = 28 // 尾部留白：最后一个刻度的 label 不被裁切
const MIN_LANE = 320 // 轨道区最小宽度，保证缩到最小时仍可操作
const TICK_GAP = 64 // 两个刻度 label 之间的最小像素距离
const SNAP_PX = 6 // 磁吸阈值（像素）
const ZOOM_MIN = 0.5
const ZOOM_MAX = 8
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const pad2 = (n: number) => ('0' + n).slice(-2)

/** 刻度文字：短片段用 x s，长片段用 m:ss */
function fmtLabel(t: number, duration: number): string {
  if (duration >= 120) return `${Math.floor(t / 60)}:${pad2(Math.floor(t % 60))}`
  return `${Math.round(t * 100) / 100}s`
}

/** 时间码：分:秒:帧，如 00:12:07 */
function fmtTimecode(t: number, fps: number): string {
  return `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}:${pad2(Math.floor((t * fps) % fps))}`
}

interface DragInfo {
  id: string
  mode: 'move' | 'l' | 'r'
  startX: number
  origStart: number
  origEnd: number
}

export function Timeline() {
  const editor = useEditor()
  const { scene, time, playing, selectedLayerId } = editor.state
  const duration = Math.max(0.01, scene.canvas.duration)
  const fps = scene.canvas.fps || 30
  const frameStep = 1 / fps

  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [scrubbing, setScrubbing] = useState(false)
  const [drag, setDrag] = useState<DragInfo | null>(null)

  const timeRef = useRef(time)
  timeRef.current = time
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const ppsRef = useRef(1)
  const durationRef = useRef(duration)

  // 量取滚动容器可视宽度（窗口尺寸变化时跟随）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewW(el.clientWidth)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  /**
   * 唯一事实：pps（每秒像素数）。
   * 刻度尺、轨道区、播放头三者都用它换算，因此天然对齐。
   */
  const laneW = Math.max(MIN_LANE, Math.round((viewW > 0 ? viewW - NAME_W : 832) * zoom))
  const pps = laneW / duration
  ppsRef.current = pps
  durationRef.current = duration
  const xOf = (t: number) => t * pps // 该点时间 → 轨道区内的位置
  const tAtX = (px: number) => clamp(px / pps, 0, duration) // 轨道区内的位置 → 该点时间

  /** 动态刻度：label 之间至少相距 TICK_GAP 像素；次刻度为大刻度 1/5，太密则不画 */
  const { majors, minors } = useMemo(() => {
    let tickStep = STEPS.find(s => s * pps >= TICK_GAP) ?? STEPS[STEPS.length - 1]
    tickStep = Number(tickStep.toFixed(3))
    const majorList: number[] = []
    for (let i = 0; i * tickStep <= duration + tickStep * 1e-3; i++) {
      majorList.push(Number((i * tickStep).toFixed(3)))
    }
    const minorStep = tickStep / 5
    const minorList: number[] = []
    if (minorStep * pps >= 9) {
      for (let i = 0; i * minorStep <= duration + minorStep * 1e-3; i++) {
        const t = Number((i * minorStep).toFixed(3))
        const q = t / tickStep
        if (Math.abs(q - Math.round(q)) > 1e-4) minorList.push(t)
      }
    }
    return { majors: majorList, minors: minorList }
  }, [duration, pps])

  /** 刻度尺上的位置 → 该点时间 → 设置播放头 */
  function seekFromMouse(clientX: number) {
    const el = rulerRef.current
    if (!el) return
    // 刻度尺左缘即轨道区原点（已扣除图层名栏），无需再修正
    const rect = el.getBoundingClientRect()
    editor.setTime(tAtX(clientX - rect.left))
  }

  /** 点刻度尺 / 点轨道区空白 / 拖播放头旋钮 → 擦洗 scrub */
  function onScrubMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.tl-bar')) return
    e.preventDefault() // 阻止拖动时选中文字
    setScrubbing(true)
    seekFromMouse(e.clientX)
  }

  useEffect(() => {
    if (!scrubbing) return
    const move = (e: MouseEvent) => seekFromMouse(e.clientX)
    const up = () => setScrubbing(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [scrubbing])

  /** 点选 + 起拖剪辑块 */
  function onBarMouseDown(e: React.MouseEvent, layerId: string, mode: DragInfo['mode']) {
    e.stopPropagation()
    if (e.button !== 0) return
    editor.select(layerId)
    const layer = sceneRef.current.layers.find(l => l.id === layerId)
    if (!layer) return
    setDrag({
      id: layerId,
      mode,
      startX: e.clientX,
      origStart: layer.start ?? 0,
      origEnd: layer.end ?? duration
    })
  }

  useEffect(() => {
    if (!drag) return
    const { id, mode, startX, origStart, origEnd } = drag
    const dur = durationRef.current

    /** 磁吸：靠近 0、时长末、播放头、其它剪辑块边缘 → 吸过去；落到百分秒 */
    const snap = (raw: number): number => {
      const targets = [0, dur, timeRef.current]
      for (const l of sceneRef.current.layers) {
        if (l.id === id) continue
        targets.push(l.start ?? 0, l.end ?? dur)
      }
      const px = ppsRef.current
      let best = raw
      let bestD = SNAP_PX
      for (const t of targets) {
        const d = Math.abs(t - raw) * px
        if (d < bestD) {
          bestD = d
          best = t
        }
      }
      return Number(clamp(best, 0, dur).toFixed(2))
    }

    const move = (e: MouseEvent) => {
      // 位移 → 该点时间差：除以 pps，而不是滚动容器宽度
      const dt = (e.clientX - startX) / ppsRef.current
      let s = origStart
      let en = origEnd
      if (mode === 'move') {
        const len = origEnd - origStart
        s = snap(clamp(origStart + dt, 0, Math.max(0, dur - len)))
        en = Number((s + len).toFixed(2))
      } else if (mode === 'l') {
        s = snap(clamp(origStart + dt, 0, origEnd - 0.2))
      } else {
        en = snap(clamp(origEnd + dt, origStart + 0.2, dur))
      }
      editor.updateLayer(id, { start: s, end: en }, { label: '调整图层时间', mergeMs: 600 })
    }
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag])

  function setZoomWith(value: number) {
    setZoom(clamp(value, ZOOM_MIN, ZOOM_MAX))
  }

  return (
    <div className="timeline">
      <div className="tl-transport">
        <button className="icon-btn" title="回到开头" onClick={() => editor.setTime(0)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h2v16H6zM20 4v16L9 12z" /></svg>
        </button>
        <button className="icon-btn" title="上一帧 ←" onClick={() => editor.setTime(clamp(time - frameStep, 0, duration))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 4v16L4 12z" /></svg>
        </button>
        <button className={`play-btn ${playing ? 'on' : ''}`} title={playing ? '暂停（空格）' : '播放（空格）'} onClick={() => editor.setPlaying(!playing)}>
          {playing ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
          )}
        </button>
        <button className="icon-btn" title="下一帧 →" onClick={() => editor.setTime(clamp(time + frameStep, 0, duration))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4v16l11-8z" /></svg>
        </button>
        <div className="tl-time mono">
          <span className="tl-time-cur">{fmtTimecode(time, fps)}</span>
          <span className="tl-time-sep">/</span>
          <span className="tl-time-total">{fmtTimecode(duration, fps)}</span>
        </div>
        <div className="tl-meta">
          <span className="badge">{fps}fps</span>
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
              const v = clamp(Number(e.target.value) || 1, 1, 1800)
              editor.updateScene(s => ({ ...s, canvas: { ...s.canvas, duration: v } }), { label: '改时长' })
            }}
          />
          s
        </label>
        <div className="tl-zoom">
          <button className="icon-btn" title="缩小" onClick={() => setZoomWith(zoom / 1.5)}>−</button>
          <span className="tiny mono">{Math.round(zoom * 100)}%</span>
          <button className="icon-btn" title="放大" onClick={() => setZoomWith(zoom * 1.5)}>＋</button>
        </div>
      </div>

      <div className="tl-scroll" ref={scrollRef}>
        <div className="tl-tracks" style={{ width: `${NAME_W + laneW + END_PAD}px` }}>
          {/* 表头行：角 + 刻度尺，纵向滚动时吸顶 */}
          <div className="tl-head">
            <div className="tl-corner" />
            <div className="tl-ruler" ref={rulerRef} style={{ width: `${laneW + END_PAD}px` }} onMouseDown={onScrubMouseDown}>
              {majors.map(t => (
                <div key={`m${t}`} className="tl-tick" style={{ left: `${xOf(t)}px` }}>
                  <span>{fmtLabel(t, duration)}</span>
                </div>
              ))}
              {minors.map(t => (
                <div key={`s${t}`} className="tl-tick minor" style={{ left: `${xOf(t)}px` }} />
              ))}
              {/* 播放头旋钮：横向擦洗的把手 */}
              <div className="tl-playhead-ruler" style={{ left: `${xOf(time)}px` }} onMouseDown={onScrubMouseDown} />
            </div>
          </div>

          {scene.layers.length === 0 && <div className="tl-empty">还没有图层</div>}
          {scene.layers.map(layer => {
            const s = layer.start ?? 0
            const e2 = layer.end ?? duration
            const sel = layer.id === selectedLayerId
            return (
              <div key={layer.id} className={`tl-track ${sel ? 'sel' : ''}`}>
                <div className="tl-track-name" onClick={() => editor.select(layer.id)} title={layer.name}>
                  <span className={`tl-vis ${layer.visible === false ? 'off' : ''}`} />
                  {layer.name}
                </div>
                <div className="tl-lane" style={{ width: `${laneW + END_PAD}px` }} onMouseDown={onScrubMouseDown}>
                  <div
                    className={`tl-bar ${sel ? 'sel' : ''} ${drag?.id === layer.id ? 'dragging' : ''}`}
                    style={{ left: `${xOf(s)}px`, width: `${Math.max(8, (e2 - s) * pps)}px` }}
                    onMouseDown={e3 => onBarMouseDown(e3, layer.id, 'move')}
                    title={`${s.toFixed(2)}–${e2.toFixed(2)}s`}
                  >
                    <i className="tl-handle l" onMouseDown={e3 => onBarMouseDown(e3, layer.id, 'l')} />
                    <span className="tl-bar-label">{layer.name}</span>
                    <i className="tl-handle r" onMouseDown={e3 => onBarMouseDown(e3, layer.id, 'r')} />
                  </div>
                </div>
              </div>
            )
          })}

          {/* 播放头竖线：绝对定位在 tracks 上，横跨表头与全部轨道行 */}
          <div className="tl-playhead-line" style={{ left: `${NAME_W + xOf(time)}px` }}>
            {scrubbing && <span className="tl-scrubbie">{fmtTimecode(time, fps)}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

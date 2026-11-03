import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Scene, SceneAudio, SceneLayer, SceneSubtitle } from '../shared/scene'
import { layerKind } from '../shared/scene'
import { ancestorsOf, findLayer, flatten, pathKey } from '../shared/layers'
import { useEditor } from '../state/editor'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { measureImage } from '../engine/assets'

/**
 * 时间轴对齐原则：刻度尺(ruler)、轨道区(lane)、播放头(playhead) 共用一个坐标系。
 * 唯一事实：pps = 每秒像素数。任何位置 = 该点时间 × pps。
 * 轨道区原点对准刻度尺 0s 刻度：两者都从 128px 图层名栏的右缘起算。
 * （NAME_W 必须与 app.css 中 .tl-corner/.tl-track-name 的宽度保持一致）
 */
const NAME_W = 168
const END_PAD = 28
const MIN_LANE = 320
const TICK_GAP = 64
const SNAP_PX = 6
const ZOOM_MIN = 0.5
const ZOOM_MAX = 8
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const pad2 = (n: number) => ('0' + n).slice(-2)

function fmtLabel(t: number, duration: number): string {
  if (duration >= 120) return `${Math.floor(t / 60)}:${pad2(Math.floor(t % 60))}`
  return `${Math.round(t * 100) / 100}s`
}

function fmtTimecode(t: number, fps: number): string {
  return `${pad2(Math.floor(t / 60))}:${pad2(Math.floor(t % 60))}:${pad2(Math.floor((t * fps) % fps))}`
}

export const DRAG_MIME = 'text/gewu-asset'

export interface DragAsset {
  name: string
  kind: 'image' | 'audio' | 'video' | 'other'
}

export function readDragAsset(e: React.DragEvent): DragAsset | null {
  const raw = e.dataTransfer.getData(DRAG_MIME)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as DragAsset
    return v && typeof v.name === 'string' ? v : null
  } catch {
    return null
  }
}

type RowKind = 'layer' | 'audio' | 'subtitle'

interface Row {
  key: string
  kind: RowKind
  id: string
  name: string
  depth: number
  hasChildren: boolean
  collapsed: boolean
  layer?: SceneLayer
  audio?: SceneAudio
  sub?: SceneSubtitle
  /** 起始/结束时间 */
  start: number
  end: number
  /** 所在组合的时间范围（子元素用；组合会裁剪它） */
  parentRange?: { start: number; end: number }
  /** 子元素的时间超出组合范围 = 被裁剪 */
  clipped?: boolean
}

type DragInfo =
  | { mode: 'move' | 'l' | 'r'; row: Row; startX: number; origStart: number; origEnd: number; curStart: number; curEnd: number; groupChildren?: { id: string; start: number; end: number }[] }
  | null

interface LaneSel {
  /** 起点（client 坐标） */
  ox: number
  oy: number
  cx: number
  cy: number
  /** .tl-tracks 的原点（client 坐标），用来换算成容器内坐标 */
  left: number
  top: number
  active: boolean
}

export function Timeline() {
  const editor = useEditor()
  const { scene, time, playing, selection } = editor.state
  const duration = Math.max(0.01, scene.canvas.duration)
  const fps = scene.canvas.fps || 30
  const frameStep = 1 / fps

  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const [viewW, setViewW] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [scrubbing, setScrubbing] = useState(false)
  const [drag, setDrag] = useState<DragInfo>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [laneSel, setLaneSel] = useState<LaneSel | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(null)
  const [dropAt, setDropAt] = useState<{ key: string; time: number } | null>(null)

  const timeRef = useRef(time)
  timeRef.current = time
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const ppsRef = useRef(1)
  const durationRef = useRef(duration)
  const selectionRef = useRef(selection)
  selectionRef.current = selection

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

  const laneW = Math.max(MIN_LANE, Math.round((viewW > 0 ? viewW - NAME_W : 832) * zoom))
  const pps = laneW / duration
  ppsRef.current = pps
  durationRef.current = duration
  const xOf = (t: number) => t * pps
  const tAtX = (px: number) => clamp(px / pps, 0, duration)

  const { majors, minors } = useMemo(() => {
    let tickStep = STEPS.find(s => s * pps >= TICK_GAP) ?? STEPS[STEPS.length - 1]
    tickStep = Number(tickStep.toFixed(3))
    const majorList: number[] = []
    for (let i = 0; i * tickStep <= duration + tickStep * 1e-3; i++) majorList.push(Number((i * tickStep).toFixed(3)))
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

  /** 统一的行模型：图层（含嵌套）→ 音频 → 字幕 */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const walk = (layers: SceneLayer[], depth: number, range?: { start: number; end: number }) => {
      for (const layer of layers) {
        const isCollapsed = collapsed.has(layer.id)
        const kids = layer.children ?? []
        const start = layer.start ?? range?.start ?? 0
        const end = layer.end ?? range?.end ?? duration
        // 子元素自己写了超出组合的起止 → 会被组合裁剪，界面上要提示
        const clipped = Boolean(range) && (
          (layer.start !== undefined && layer.start < (range as { start: number }).start) ||
          (layer.end !== undefined && layer.end > (range as { end: number }).end)
        )
        out.push({
          key: `layer:${layer.id}`,
          kind: 'layer',
          id: layer.id,
          name: layer.name,
          depth,
          hasChildren: kids.length > 0,
          collapsed: isCollapsed,
          layer,
          start,
          end,
          parentRange: range,
          clipped
        })
        if (kids.length && !isCollapsed) walk(kids, depth + 1, { start, end })
      }
    }
    walk(scene.layers, 0)
    for (const a of scene.audio ?? []) {
      const len = a.dur ?? Math.max(0.5, duration - (a.start ?? 0))
      out.push({
        key: `audio:${a.id}`,
        kind: 'audio',
        id: a.id,
        name: a.name || '音频',
        depth: 0,
        hasChildren: false,
        collapsed: false,
        audio: a,
        start: a.start ?? 0,
        end: (a.start ?? 0) + len
      })
    }
    for (const s of scene.subtitles ?? []) {
      out.push({
        key: `sub:${s.id}`,
        kind: 'subtitle',
        id: s.id,
        name: s.text.slice(0, 24) || '字幕',
        depth: 0,
        hasChildren: false,
        collapsed: false,
        sub: s,
        start: s.start,
        end: s.end
      })
    }
    return out
  }, [scene, collapsed, duration])

  function seekFromMouse(clientX: number) {
    const el = rulerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    editor.setTime(tAtX(clientX - rect.left))
  }

  function onScrubMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.tl-bar')) return
    e.preventDefault()
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

  function selectRow(row: Row, additive: boolean) {
    if (row.kind !== 'layer') return
    if (additive) editor.toggleSelect(row.id)
    else editor.select(row.id)
  }

  function onBarMouseDown(e: React.MouseEvent, row: Row, mode: 'move' | 'l' | 'r') {
    e.stopPropagation()
    if (e.button !== 0) return
    if (row.layer?.locked) return
    const additive = e.ctrlKey || e.metaKey
    if (row.kind === 'layer') {
      if (additive) editor.toggleSelect(row.id)
      else if (!selection.includes(row.id)) editor.select(row.id)
    } else {
      editor.select(null)
    }
    // 组合：拖动整条时同步移动所有子元素的起止时间
    let groupChildren: { id: string; start: number; end: number }[] | undefined
    if (row.layer?.children?.length) {
      const list: { id: string; start: number; end: number }[] = []
      const collect = (l: SceneLayer) => {
        for (const k of l.children ?? []) {
          if (k.children?.length) collect(k)
          else list.push({ id: k.id, start: k.start ?? 0, end: k.end ?? duration })
        }
      }
      collect(row.layer)
      groupChildren = list
    }
    let target = row
    // Alt+拖 = 先复制一条再拖复制体（原剪辑块留在原地）
    if (e.altKey && mode === 'move' && row.kind === 'layer') {
      const { created, map } = editor.duplicate([row.id])
      if (created.length) {
        target = { ...row, id: created[0], key: `layer:${created[0]}`, name: `${row.name} 副本`, layer: { ...(row.layer as SceneLayer), id: created[0] } }
        if (groupChildren) groupChildren = groupChildren.map(k => ({ ...k, id: map[k.id] ?? k.id }))
      }
    }
    setDrag({
      mode,
      row: target,
      startX: e.clientX,
      origStart: target.start,
      origEnd: target.end,
      curStart: target.start,
      curEnd: target.end,
      groupChildren
    })
  }

  useEffect(() => {
    if (!drag) return
    const { mode, row, startX, origStart, origEnd, groupChildren } = drag
    const dur = durationRef.current
    const snap = (raw: number): number => {
      const targets = [0, dur, timeRef.current]
      for (const r of rows) {
        if (r.key === row.key) continue
        targets.push(r.start, r.end)
      }
      const px = ppsRef.current
      let best = raw
      let bestD = SNAP_PX
      for (const t of targets) {
        const d = Math.abs(t - raw) * px
        if (d < bestD) { bestD = d; best = t }
      }
      return Number(clamp(best, 0, dur).toFixed(2))
    }

    const move = (e: MouseEvent) => {
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
      if (row.kind === 'layer') {
        editor.updateLayer(row.id, { start: s, end: en }, { label: '调整图层时间', mergeMs: 600 })
        if (groupChildren) {
          const ds = s - origStart
          for (const k of groupChildren) {
            editor.updateLayer(k.id, { start: Number((k.start + ds).toFixed(2)), end: Number((k.end + ds).toFixed(2)) }, { label: '调整图层时间', mergeMs: 600 })
          }
        }
      } else if (row.kind === 'audio') {
        editor.updateScene(sc => ({
          ...sc,
          audio: (sc.audio ?? []).map(a => (a.id === row.id ? { ...a, start: s } : a))
        }), { label: '移动音频', mergeMs: 600 })
      } else {
        editor.updateScene(sc => ({
          ...sc,
          subtitles: (sc.subtitles ?? []).map(x => (x.id === row.id ? { ...x, start: s, end: en } : x))
        }), { label: '调整字幕时间', mergeMs: 600 })
      }
      // 拖动时间气泡：显示当前起止
      setDrag(prev => (prev && (prev.curStart !== s || prev.curEnd !== en) ? { ...prev, curStart: s, curEnd: en } : prev))
    }
    const up = () => setDrag(null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [drag, editor, rows])

  /** 空白轨道区：拖 = 框选剪辑块，单击 = 移动播放头 */
  function onLaneMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.tl-bar')) return
    e.preventDefault()
    const tracks = (e.currentTarget as HTMLElement).closest('.tl-tracks') as HTMLElement | null
    const rect = tracks?.getBoundingClientRect()
    setLaneSel({
      ox: e.clientX,
      oy: e.clientY,
      cx: e.clientX,
      cy: e.clientY,
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
      active: false
    })
  }

  useEffect(() => {
    if (!laneSel) return
    const move = (e: MouseEvent) => {
      setLaneSel(prev => {
        if (!prev) return prev
        const active = prev.active || Math.abs(e.clientX - prev.ox) > 4 || Math.abs(e.clientY - prev.oy) > 4
        return { ...prev, cx: e.clientX, cy: e.clientY, active }
      })
    }
    const up = (e: MouseEvent) => {
      const sel = laneSel
      setLaneSel(null)
      if (!sel.active) {
        seekFromMouse(e.clientX)
        return
      }
      const box = {
        x1: Math.min(sel.ox, e.clientX),
        x2: Math.max(sel.ox, e.clientX),
        y1: Math.min(sel.oy, e.clientY),
        y2: Math.max(sel.oy, e.clientY)
      }
      const ids: string[] = []
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('.tl-track'))) {
        const id = el.dataset.id
        if (!id || el.dataset.kind !== 'layer') continue
        const r = el.getBoundingClientRect()
        if (r.left < box.x2 && r.right > box.x1 && r.top < box.y2 && r.bottom > box.y1) ids.push(id)
      }
      if (!ids.length) {
        if (!e.ctrlKey && !e.metaKey) editor.select(null)
        return
      }
      const merged = e.ctrlKey || e.metaKey ? [...new Set([...selectionRef.current, ...ids])] : ids
      editor.selectMany(merged)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [laneSel, editor])

  /** 素材拖到轨道上 → 在该时间点创建元素 */
  const onDrop = useCallback(async (e: React.DragEvent, row: Row | null) => {
    const asset = readDragAsset(e)
    if (!asset) return
    e.preventDefault()
    e.stopPropagation()
    setDropAt(null)
    const el = e.currentTarget as HTMLElement
    const laneEl = el.closest('.tl-lane') as HTMLElement | null
    const rect = (laneEl ?? el).getBoundingClientRect()
    const t = Math.max(0, Math.min(duration, (e.clientX - rect.left) / ppsRef.current))
    await dropAssetAt(editor, asset, t, row)
  }, [duration, editor])

  const menuItems: MenuItem[] = useMemo(() => {
    if (!menu) return []
    const row = menu.row
    const ids = row.kind === 'layer' ? (selection.includes(row.id) ? selection : [row.id]) : []
    return [
      ...(row.kind === 'layer' ? [
        { id: 'dup', label: '创建副本', hint: 'Ctrl+D', onClick: () => editor.duplicate(ids) },
        { id: 'del', label: '删除', danger: true, onClick: () => editor.removeLayers(ids) },
        { id: 'sep1', label: '', separator: true },
        { id: 'lock', label: row.layer?.locked ? '解锁' : '锁定', onClick: () => editor.updateLayer(row.id, { locked: !row.layer?.locked }, { label: '锁定图层' }) },
        { id: 'hide', label: row.layer?.visible === false ? '显示' : '隐藏', onClick: () => editor.updateLayer(row.id, { visible: row.layer?.visible === false }, { label: '显示/隐藏图层' }) },
        { id: 'sep2', label: '', separator: true },
        { id: 'front', label: '上移一层', onClick: () => editor.reorder(row.id, 1) },
        { id: 'back', label: '下移一层', onClick: () => editor.reorder(row.id, -1) },
        ...(row.hasChildren ? [{ id: 'ungroup', label: '解组', onClick: () => editor.ungroup(row.id) }] : []),
        { id: 'sep3', label: '', separator: true },
        {
          id: 'fit', label: '按画面时长对齐', onClick: () => {
            editor.updateLayer(row.id, { start: 0, end: duration }, { label: '对齐时长' })
          }
        }
      ] : []),
      ...(row.kind === 'audio' ? [
        {
          id: 'del', label: '删除音频', danger: true, onClick: () => {
            editor.updateScene(sc => ({ ...sc, audio: (sc.audio ?? []).filter(a => a.id !== row.id) }), { label: '删除音频' })
          }
        }
      ] : []),
      ...(row.kind === 'subtitle' ? [
        {
          id: 'del', label: '删除字幕', danger: true, onClick: () => {
            editor.updateScene(sc => ({ ...sc, subtitles: (sc.subtitles ?? []).filter(x => x.id !== row.id) }), { label: '删除字幕' })
          }
        }
      ] : [])
    ] as MenuItem[]
  }, [menu, selection, editor, duration])

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
          <span className="badge">{rows.length} 轨</span>
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
              <div className="tl-playhead-ruler" style={{ left: `${xOf(time)}px` }} onMouseDown={onScrubMouseDown} />
            </div>
          </div>

          {rows.length === 0 && <div className="tl-empty">还没有图层。把左侧素材拖到这条轨道上，或用 AI 生成画面。</div>}

          {rows.map(row => {
            const sel = row.kind === 'layer' && selection.includes(row.id)
            const kind = row.layer ? layerKind(row.layer) : row.kind === 'audio' ? 'audio' : 'subtitle'
            const len = Math.max(0.08, row.end - row.start)
            return (
              <div
                key={row.key}
                className={`tl-track ${sel ? 'sel' : ''} ${row.kind !== 'layer' ? 'other' : ''} ${row.layer?.visible === false ? 'off' : ''}`}
                data-id={row.kind === 'layer' ? row.id : undefined}
                data-kind={row.kind}
                style={{ ['--depth' as string]: row.depth }}
              >
                <div
                  className="tl-track-name"
                  onClick={e => selectRow(row, e.ctrlKey || e.metaKey)}
                  title={`${row.name} · ${row.start.toFixed(2)}–${row.end.toFixed(2)}s`}
                  style={{ paddingLeft: `${8 + row.depth * 14}px` }}
                >
                  {row.hasChildren ? (
                    <button
                      className={`tl-chev ${row.collapsed ? 'closed' : ''}`}
                      onClick={e => {
                        e.stopPropagation()
                        setCollapsed(prev => {
                          const next = new Set(prev)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }}
                      title={row.collapsed ? '展开组合' : '收起组合'}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l8 7-8 7z" /></svg>
                    </button>
                  ) : <span className="tl-chev-space" />}
                  <KindIcon kind={kind} />
                  <span className="tl-name-text">{row.name}</span>
                  {row.clipped && (
                    <span className="tl-clip" title={`被组合 ${row.parentRange?.start.toFixed(2)}–${row.parentRange?.end.toFixed(2)}s 裁剪`}>✂</span>
                  )}
                  {row.kind === 'layer' && (
                    <span className="tl-row-tools">
                      <button
                        className={`tl-mini ${row.layer?.visible === false ? 'off' : ''}`}
                        title={row.layer?.visible === false ? '显示' : '隐藏'}
                        onClick={e => { e.stopPropagation(); editor.updateLayer(row.id, { visible: row.layer?.visible === false }, { label: '显示/隐藏图层' }) }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg>
                      </button>
                      <button
                        className={`tl-mini ${row.layer?.locked ? 'on' : ''}`}
                        title={row.layer?.locked ? '解锁' : '锁定'}
                        onClick={e => { e.stopPropagation(); editor.updateLayer(row.id, { locked: !row.layer?.locked }, { label: '锁定图层' }) }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
                      </button>
                    </span>
                  )}
                </div>
                <div
                  className={`tl-lane ${dropAt?.key === row.key ? 'drop-target' : ''}`}
                  style={{ width: `${laneW + END_PAD}px` }}
                  onMouseDown={onLaneMouseDown}
                  onDragOver={e => {
                    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setDropAt({ key: row.key, time: clamp((e.clientX - rect.left) / ppsRef.current, 0, duration) })
                  }}
                  onDragLeave={() => setDropAt(null)}
                  onDrop={e => { void onDrop(e, row) }}
                >
                  <div
                    className={`tl-bar kind-${kind} ${sel ? 'sel' : ''} ${row.clipped ? 'clipped' : ''} ${drag?.row.key === row.key ? 'dragging' : ''}`}
                    style={{ left: `${xOf(row.start)}px`, width: `${Math.max(8, len * pps)}px` }}
                    onMouseDown={e => onBarMouseDown(e, row, 'move')}
                    onDoubleClick={e => {
                      // 双击剪辑块 = 选中这个元素并把播放头挪到它开头
                      e.stopPropagation()
                      if (row.kind === 'layer') {
                        editor.select(row.id)
                        editor.setTime(row.start)
                      }
                    }}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, row }) }}
                    title={`${row.name} · ${row.start.toFixed(2)}–${row.end.toFixed(2)}s`}
                  >
                    <i className="tl-handle l" onMouseDown={e => onBarMouseDown(e, row, 'l')} />
                    <span className="tl-bar-label">
                      {kind === 'text' ? 'T' : ''}{row.name}
                    </span>
                    <i className="tl-handle r" onMouseDown={e => onBarMouseDown(e, row, 'r')} />
                  </div>
                </div>
              </div>
            )
          })}

          {laneSel?.active && (
            <div
              className="tl-marquee"
              style={{
                left: `${Math.min(laneSel.ox, laneSel.cx) - laneSel.left}px`,
                top: `${Math.min(laneSel.oy, laneSel.cy) - laneSel.top}px`,
                width: `${Math.abs(laneSel.cx - laneSel.ox)}px`,
                height: `${Math.abs(laneSel.cy - laneSel.oy)}px`
              }}
            />
          )}

          {drag && (
            <div className="tl-bubble" style={{ left: `${NAME_W + xOf(Math.min(drag.curStart, drag.curEnd))}px` }}>
              {drag.curStart.toFixed(2)} – {drag.curEnd.toFixed(2)}s
            </div>
          )}

          <div className="tl-playhead-line" style={{ left: `${NAME_W + xOf(time)}px` }}>
            {scrubbing && <span className="tl-scrubbie">{fmtTimecode(time, fps)}</span>}
          </div>
          {dropAt && (
            <div className="tl-drop-line" style={{ left: `${NAME_W + xOf(dropAt.time)}px` }} />
          )}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}

function KindIcon({ kind }: { kind: string }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }
  if (kind === 'group') return <svg {...common}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
  if (kind === 'text') return <svg {...common}><path d="M5 6h14M12 6v13M9 19h6" /></svg>
  if (kind === 'image') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M21 16l-5-5-6 6" /></svg>
  if (kind === 'shape') return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
  if (kind === 'audio') return <svg {...common}><path d="M4 12h2l2-5 3 12 3-9 2 4h4" /></svg>
  if (kind === 'subtitle') return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 13h4M13 13h4" /></svg>
  return <svg {...common}><path d="M8 6l-4 6 4 6M16 6l4 6-4 6" /></svg>
}

/** 把拖进来的素材变成场景内容（时间轴/画布共用） */
export async function dropAssetAt(
  editor: ReturnType<typeof useEditor>,
  asset: DragAsset,
  t: number,
  row?: Row | null,
  design?: { x: number; y: number }
): Promise<{ ok: boolean; message: string }> {
  const scene = editor.state.scene
  if (asset.kind === 'audio') {
    const id = `aud_${Math.random().toString(36).slice(2, 8)}`
    editor.updateScene(s => ({
      ...s,
      audio: [...(s.audio ?? []), { id, name: asset.name, src: asset.name, start: Number(t.toFixed(2)), volume: 1 }]
    }), { label: '添加音频' })
    return { ok: true, message: `已把音频 ${asset.name} 放到 ${t.toFixed(1)}s` }
  }
  if (asset.kind === 'image') {
    const size = await measureImage(asset.name)
    const W = scene.canvas.width
    const H = scene.canvas.height
    let w = size?.width ?? 640
    let h = size?.height ?? 360
    const maxW = W * 0.6
    const maxH = H * 0.6
    const k = Math.min(1, maxW / w, maxH / h)
    w = Math.round(w * k)
    h = Math.round(h * k)
    const id = `img_${Math.random().toString(36).slice(2, 8)}`
    const x = design ? Math.round(design.x - w / 2) : Math.round((W - w) / 2)
    const y = design ? Math.round(design.y - h / 2) : Math.round((H - h) / 2)
    const layer: SceneLayer = {
      id,
      name: asset.name.replace(/\.[^.]+$/, ''),
      kind: 'image',
      x, y, w, h,
      image: { src: asset.name, fit: 'stretch' },
      start: 0,
      end: scene.canvas.duration
    }
    editor.addLayer(layer)
    void row
    return { ok: true, message: `已添加图片 ${asset.name}` }
  }
  return { ok: false, message: '这种素材暂不支持拖到轨道' }
}

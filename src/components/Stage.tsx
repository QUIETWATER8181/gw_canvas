import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import type { Rect, Scene, SceneGuides, SceneLayer } from '../shared/scene'
import { hasOwnBox, layerKind } from '../shared/scene'
import { ancestorsOf, findLayer, flatten, pathKey, updateAt } from '../shared/layers'
import { SceneRenderer, blitTo } from '../engine/preview'
import { renderScene } from '../engine/render'
import { assetImage } from '../engine/assets'
import { Timeline, DRAG_MIME, dropAssetAt, readDragAsset } from './Timeline'
import { StageToolbar } from './StageToolbar'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ALIGN_LABEL, computeAlign, type AlignMode } from './layer-ops'
import {
  FIT_VIEW, designToScreen, normalizeRect, pointInTyped, rectsIntersect, screenToDesign,
  viewMath, worldBox, type ViewState
} from './stage-geometry'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
  exportJob: { running: boolean; frame: number; total: number; phase: string } | null
}

const SNAP_PX = 6
const MIN_SIZE = 8
/** 标尺厚度（CSS px） */
const RULER = 16
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = typeof HANDLES[number]

/** 多选时悬浮对齐条里的顺序（短标签，够宽就都放得下） */
const ALIGN_BAR: { mode: AlignMode; text: string }[] = [
  { mode: 'left', text: '左对齐' },
  { mode: 'hcenter', text: '水平居中' },
  { mode: 'right', text: '右对齐' },
  { mode: 'top', text: '顶对齐' },
  { mode: 'vcenter', text: '垂直居中' },
  { mode: 'bottom', text: '底对齐' },
  { mode: 'hdist', text: '水平等距' },
  { mode: 'vdist', text: '垂直等距' }
]

/** 参考线/标尺用：把「设计坐标的步长」取成 1/2/5×10^n */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(Math.max(1e-6, raw)))
  const base = Math.pow(10, exp)
  const n = raw / base
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return mult * base
}

type Gesture =
  | { kind: 'move'; start: { x: number; y: number }; origin: { id: string; x: number; y: number }[]; box: Rect }
  | { kind: 'resize'; handle: Handle; id: string; start: { x: number; y: number }; origin: { x: number; y: number; w: number; h: number; rotation: number; scale: number }; box: Rect }
  | { kind: 'rotate'; id: string; center: { x: number; y: number }; startAngle: number; origin: number }
  | { kind: 'marquee'; start: { x: number; y: number }; cur: { x: number; y: number }; add: boolean }
  | { kind: 'region'; start: { x: number; y: number }; cur: { x: number; y: number } }
  | { kind: 'pan'; startClient: { x: number; y: number }; origin: { panX: number; panY: number } }

interface BoxInfo { id: string; path: string[]; box: Rect; rotation: number; canRotate: boolean }

export function Stage({ onToast, exportJob }: Props) {
  const editor = useEditor()
  const { scene, time, playing, selection } = editor.state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const lastTs = useRef<number>(0)
  const timeRef = useRef(time)
  timeRef.current = time
  const [showBounds, setShowBounds] = useState(true)
  const [showRulers, setShowRulers] = useState(false)
  const [view, setView] = useState<ViewState>(FIT_VIEW)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [snapGuides, setSnapGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  /** 正在拖的参考线；index=-1 表示从标尺新建 */
  const [guideDraft, setGuideDraft] = useState<{ axis: 'v' | 'h'; index: number; value: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null; at?: { x: number; y: number } } | null>(null)
  const [textEdit, setTextEdit] = useState<{ id: string; path: string[] } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)

  if (!rendererRef.current) rendererRef.current = new SceneRenderer(scene.canvas.width, scene.canvas.height)

  const viewRef = useRef(view)
  viewRef.current = view

  /** 用户自己拉的参考线（存在 scene.guides 里，跟着草稿保存/撤销） */
  const userGuides = scene.guides ?? { v: [], h: [] }

  const renderNow = useCallback(() => {
    const r = rendererRef.current
    const c = canvasRef.current
    if (!r || !c) return
    r.render(scene, timeRef.current)
    blitTo(c, r.element, '#0a0e13', viewRef.current)
  }, [scene])

  const renderNowRef = useRef(renderNow)
  renderNowRef.current = renderNow
  const editorRef = useRef(editor)
  editorRef.current = editor
  const durationRef = useRef(scene.canvas.duration)
  durationRef.current = scene.canvas.duration

  // 播放循环
  useEffect(() => {
    if (!playing) {
      renderNowRef.current()
      return
    }
    let cur = timeRef.current
    let lastSet = cur
    let raf = 0
    lastTs.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.25, Math.max(0, (now - lastTs.current) / 1000))
      lastTs.current = now
      if (Math.abs(timeRef.current - lastSet) > 0.001) cur = timeRef.current
      cur += dt
      if (cur >= durationRef.current) cur = 0
      lastSet = cur
      editorRef.current.setTime(cur)
      renderNowRef.current()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  useEffect(() => {
    if (!playing) renderNow()
  }, [time, scene, playing, renderNow, view])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    let alive = true
    void r.prepare(scene).then(() => { if (alive) renderNow() })
    return () => { alive = false }
  }, [scene, renderNow])

  // 草稿封面
  const coverAt = useRef(0)
  useEffect(() => {
    const r = rendererRef.current
    if (!r || playing) return
    const now = Date.now()
    if (now - coverAt.current < 5000) return
    coverAt.current = now
    const timer = setTimeout(() => {
      try {
        const src = r.element
        const w = 480
        const h = Math.max(1, Math.round((w * src.height) / src.width))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return
        ctx.drawImage(src, 0, 0, w, h)
        const b64 = c.toDataURL('image/png').split(',')[1] ?? ''
        if (!b64) return
        void window.gewu.writeCover(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)))
      } catch { /* ignore */ }
    }, 1600)
    return () => clearTimeout(timer)
  }, [scene, playing])

  useEffect(() => {
    const ro = new ResizeObserver(() => { if (!playing) renderNow() })
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [playing, renderNow])

  // 空格键 = 临时抓手
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable]')) setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  const rectOf = () => canvasRef.current?.getBoundingClientRect() ?? null
  const toDesign = (e: { clientX: number; clientY: number }) => {
    const rect = rectOf()
    if (!rect) return null
    return screenToDesign(e.clientX, e.clientY, rect, scene.canvas.width, scene.canvas.height, viewRef.current)
  }

  /** 选中元素在画布上的盒子（typed 直接算，code 用低分辨率扫描） */
  const liveBoxes = useMemo<BoxInfo[]>(() => {
    if (!showBounds || !selection.length) return []
    const out: BoxInfo[] = []
    for (const id of selection) {
      const hit = findLayer(scene.layers, id)
      if (!hit) continue
      const anc = ancestorsOf(scene.layers, hit.path)
      const box = worldBox(anc, hit.layer) ?? scanBox(scene, hit.path, time)
      if (!box) continue
      const rotation = anc.reduce((sum, a) => sum + (Number(a.rotation) || 0), 0) + (Number(hit.layer.rotation) || 0)
      out.push({ id, path: hit.path, box, rotation, canRotate: hasOwnBox(hit.layer) })
    }
    return out
  }, [scene, selection, time, showBounds])

  const boxes = liveBoxes

  const selBox = boxes[0] ?? null

  // ---------- 命中测试 ----------
  function hitAt(p: { x: number; y: number }): { id: string; path: string[]; layer: SceneLayer } | null {
    const flat = flatten(scene.layers).reverse()
    for (const f of flat) {
      const layer = f.layer
      if (layer.visible === false || layer.locked) continue
      if (layer.start !== undefined && time < layer.start) continue
      if (layer.end !== undefined && time > layer.end) continue
      const anc = ancestorsOf(scene.layers, f.path)
      if (hasOwnBox(layer)) {
        if (pointInTyped(anc, layer, p)) return { id: layer.id, path: f.path, layer }
      } else if ((layer.draw ?? '').trim()) {
        if (alphaHit(scene, f.path, p, time)) return { id: layer.id, path: f.path, layer }
      }
    }
    return null
  }

  // ---------- 手势 ----------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      const p = toDesign(e)
      if (p) {
        const hit = hitAt(p)
        if (hit) editor.select(hit.id)
        setMenu({ x: e.clientX, y: e.clientY, id: hit?.id ?? (selection.length === 1 ? selection[0] : null), at: p })
      }
      return
    }
    if (e.button === 1 || spaceDown) {
      setGesture({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, origin: { panX: view.panX, panY: view.panY } })
      return
    }
    const p = toDesign(e)
    if (!p) return
    ;(e.target as HTMLElement).focus?.()

    if (e.shiftKey) {
      setGesture({ kind: 'region', start: p, cur: p })
      return
    }
    const hit = hitAt(p)
    if (hit) {
      let ids = selection
      if (e.altKey) {
        const anc = ancestorsOf(scene.layers, hit.path)
        const parent = anc[anc.length - 1]
        if (parent) { editor.select(parent.id); ids = [parent.id] }
      } else if (e.ctrlKey || e.metaKey) {
        editor.toggleSelect(hit.id)
        ids = selection.includes(hit.id) ? selection.filter(i => i !== hit.id) : [...selection, hit.id]
      } else if (!selection.includes(hit.id)) {
        editor.select(hit.id)
        ids = [hit.id]
      }
      const origin = ids
        .map(id => {
          const h = findLayer(scene.layers, id)
          if (!h || h.layer.locked) return null
          return { id, x: Number(h.layer.x) || 0, y: Number(h.layer.y) || 0 }
        })
        .filter((v): v is { id: string; x: number; y: number } => Boolean(v))
      if (origin.length) {
        const box = unionOf(ids)
        setGesture({ kind: 'move', start: p, origin, box: box ?? { x: p.x, y: p.y, w: 1, h: 1 } })
      }
      return
    }
    editor.select(null)
    setGesture({ kind: 'marquee', start: p, cur: p, add: e.ctrlKey || e.metaKey })
  }

  const startResize = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    if (!selBox) return
    const hit = findLayer(scene.layers, selBox.id)
    if (!hit) return
    const layer = hit.layer
    const start = toDesign(e)
    if (!start) return
    setGesture({
      kind: 'resize',
      handle,
      id: selBox.id,
      start,
      origin: {
        x: Number(layer.x) || 0,
        y: Number(layer.y) || 0,
        w: Number(layer.w) || selBox.box.w,
        h: Number(layer.h) || selBox.box.h,
        rotation: Number(layer.rotation) || 0,
        scale: layer.scale === undefined ? 1 : Number(layer.scale) || 1
      },
      box: selBox.box
    })
  }

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!selBox) return
    const hit = findLayer(scene.layers, selBox.id)
    if (!hit) return
    const center = { x: selBox.box.x + selBox.box.w / 2, y: selBox.box.y + selBox.box.h / 2 }
    const p = toDesign(e)
    if (!p) return
    setGesture({
      kind: 'rotate',
      id: selBox.id,
      center,
      startAngle: Math.atan2(p.y - center.y, p.x - center.x),
      origin: Number(hit.layer.rotation) || 0
    })
  }

  // 全局 move / up
  useEffect(() => {
    if (!gesture) return
    const scale = () => {
      const rect = rectOf()
      if (!rect) return 1
      return viewMath(rect.width, rect.height, scene.canvas.width, scene.canvas.height, viewRef.current).scale
    }

    const onMove = (e: PointerEvent) => {
      if (gesture.kind === 'pan') {
        setView(v => ({ ...v, panX: gesture.origin.panX + (e.clientX - gesture.startClient.x), panY: gesture.origin.panY + (e.clientY - gesture.startClient.y) }))
        return
      }
      const p = toDesign(e)
      if (!p) return
      if (gesture.kind === 'marquee' || gesture.kind === 'region') {
        setGesture({ ...gesture, cur: p })
        return
      }
      if (gesture.kind === 'move') {
        let dx = p.x - gesture.start.x
        let dy = p.y - gesture.start.y
        const snap = computeSnap(scene, gesture.box, dx, dy, selection, scale(), userGuides)
        dx = snap.dx
        dy = snap.dy
        setSnapGuides(snap.guides)
        for (const o of gesture.origin) {
          editor.updateLayer(o.id, { x: round2(o.x + dx), y: round2(o.y + dy) }, { label: '移动元素', mergeMs: 800 })
        }
        return
      }
      if (gesture.kind === 'resize') {
        const hit = findLayer(scene.layers, gesture.id)
        if (!hit) return
        const anc = ancestorsOf(scene.layers, hit.path)
        const layer = hit.layer
        if (!hasOwnBox(layer) || (layer.children?.length ?? 0) > 0) {
          // code 图层没有 w/h、组合缩放的是子元素：都用手柄改 scale
          const center = { x: gesture.box.x + gesture.box.w / 2, y: gesture.box.y + gesture.box.h / 2 }
          const d0 = Math.hypot(gesture.start.x - center.x, gesture.start.y - center.y)
          const d1 = Math.hypot(p.x - center.x, p.y - center.y)
          const ratio = d0 > 4 ? d1 / d0 : 1
          editor.updateLayer(gesture.id, { scale: round2(clamp(gesture.origin.scale * ratio, 0.05, 20)) }, { label: '缩放元素', mergeMs: 800 })
          return
        }
        // 转到父坐标系
        const parentLocal = toParentLocal(anc, layer, p)
        const o = gesture.origin
        const rot = gesture.origin.rotation
        if (Math.abs(rot) < 0.01) {
          let x = o.x, y = o.y, w = o.w, h = o.h
          if (gesture.handle.includes('w')) { const right = o.x + o.w; x = Math.min(parentLocal.x, right - MIN_SIZE); w = right - x }
          if (gesture.handle.includes('e')) { w = Math.max(MIN_SIZE, parentLocal.x - o.x) }
          if (gesture.handle.includes('n')) { const bottom = o.y + o.h; y = Math.min(parentLocal.y, bottom - MIN_SIZE); h = bottom - y }
          if (gesture.handle.includes('s')) { h = Math.max(MIN_SIZE, parentLocal.y - o.y) }
          editor.updateLayer(gesture.id, { x: round2(x), y: round2(y), w: round2(w), h: round2(h) }, { label: '缩放元素', mergeMs: 800 })
        } else {
          // 旋转过的元素：保持中心不变，按局部坐标改宽高
          const local = toLayerLocal(anc, layer, p)
          let w = o.w, h = o.h
          if (gesture.handle.includes('e')) w = Math.max(MIN_SIZE, local.x)
          if (gesture.handle.includes('w')) w = Math.max(MIN_SIZE, o.w - local.x)
          if (gesture.handle.includes('s')) h = Math.max(MIN_SIZE, local.y)
          if (gesture.handle.includes('n')) h = Math.max(MIN_SIZE, o.h - local.y)
          const cx = o.x + o.w / 2
          const cy = o.y + o.h / 2
          editor.updateLayer(gesture.id, {
            x: round2(cx - w / 2), y: round2(cy - h / 2), w: round2(w), h: round2(h)
          }, { label: '缩放元素', mergeMs: 800 })
        }
        return
      }
      if (gesture.kind === 'rotate') {
        const angle = Math.atan2(p.y - gesture.center.y, p.x - gesture.center.x)
        let deg = gesture.origin + ((angle - gesture.startAngle) * 180) / Math.PI
        if (e.shiftKey) deg = Math.round(deg / 15) * 15
        editor.updateLayer(gesture.id, { rotation: round2(deg) }, { label: '旋转元素', mergeMs: 800 })
      }
    }

    const onUp = () => {
      if (gesture.kind === 'marquee') {
        const rect = normalizeRect(gesture.start, gesture.cur)
        if (rect.w > 3 || rect.h > 3) {
          const ids: string[] = []
          for (const f of flatten(scene.layers)) {
            const layer = f.layer
            if (layer.visible === false || layer.locked) continue
            if (layer.start !== undefined && time < layer.start) continue
            if (layer.end !== undefined && time > layer.end) continue
            const anc = ancestorsOf(scene.layers, f.path)
            const box = worldBox(anc, layer) ?? scanBox(scene, f.path, time)
            if (box && rectsIntersect(box, rect)) ids.push(layer.id)
          }
          if (gesture.add) editor.selectMany([...new Set([...selection, ...ids])])
          else editor.selectMany(ids)
        }
      }
      setGesture(null)
      setSnapGuides({ v: [], h: [] })
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gesture, editor, scene, selection, time])

  // ---------- 对齐 / 等间距 ----------
  const applyAlign = useCallback((mode: AlignMode) => {
    const patches = computeAlign(scene, selection, mode)
    if (!patches.length) return
    editor.updateScene(s => {
      let layers = s.layers
      for (const p of patches) {
        const hit = findLayer(layers, p.id)
        if (!hit) continue
        layers = updateAt(layers, hit.path, {
          x: round2((Number(hit.layer.x) || 0) + p.dx),
          y: round2((Number(hit.layer.y) || 0) + p.dy)
        })
      }
      return { ...s, layers }
    }, { label: '对齐元素' })
  }, [editor, scene, selection])

  // ---------- 参考线 ----------
  const toDesignClamped = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = rectOf()
    if (!rect) return null
    return screenToDesign(e.clientX, e.clientY, rect, scene.canvas.width, scene.canvas.height, viewRef.current, true)
  }, [scene.canvas.height, scene.canvas.width])

  const startGuideDrag = (e: React.PointerEvent, axis: 'v' | 'h', index: number) => {
    e.stopPropagation()
    e.preventDefault()
    const p = toDesignClamped(e)
    if (!p) return
    setGuideDraft({ axis, index, value: round2(axis === 'v' ? p.x : p.y) })
  }

  const commitGuide = useCallback((axis: 'v' | 'h', index: number, value: number) => {
    const key = axis === 'v' ? 'v' : 'h'
    const list = [...(userGuides[key] ?? [])]
    if (index >= 0 && index < list.length) list[index] = value
    else list.push(value)
    editor.setGuides({ ...userGuides, [key]: list })
  }, [editor, userGuides])

  const removeGuide = useCallback((axis: 'v' | 'h', index: number) => {
    const key = axis === 'v' ? 'v' : 'h'
    const list = [...(userGuides[key] ?? [])]
    list.splice(index, 1)
    editor.setGuides({ ...userGuides, [key]: list })
  }, [editor, userGuides])

  useEffect(() => {
    if (!guideDraft) return
    const move = (e: PointerEvent) => {
      const p = toDesignClamped(e)
      if (!p) return
      setGuideDraft(d => (d ? { ...d, value: round2(d.axis === 'v' ? p.x : p.y) } : d))
    }
    const up = () => {
      commitGuide(guideDraft.axis, guideDraft.index, guideDraft.value)
      setGuideDraft(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [guideDraft, toDesignClamped, commitGuide])

  function addGuideAt(axis: 'v' | 'h') {
    const at = menu?.at
    if (!at) return
    commitGuide(axis, -1, round2(axis === 'v' ? at.x : at.y))
  }

  // 滚轮：Ctrl 缩放，否则平移
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const rect = rectOf()
    if (!rect) return
    if (e.ctrlKey || e.metaKey) {
      const m = viewMath(rect.width, rect.height, scene.canvas.width, scene.canvas.height, view)
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const designX = (px - m.dx) / m.scale
      const designY = (py - m.dy) / m.scale
      const zoom = clamp(view.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.2, 8)
      const m2 = viewMath(rect.width, rect.height, scene.canvas.width, scene.canvas.height, { zoom, panX: 0, panY: 0 })
      setView({
        zoom,
        panX: px - designX * m2.scale - (rect.width - scene.canvas.width * m2.scale) / 2,
        panY: py - designY * m2.scale - (rect.height - scene.canvas.height * m2.scale) / 2
      })
    } else {
      setView(v => ({ ...v, panX: v.panX - e.deltaX, panY: v.panY - e.deltaY }))
    }
  }

  // 双击：文本进入编辑
  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toDesign(e)
    if (!p) return
    const hit = hitAt(p)
    if (hit && layerKind(hit.layer) === 'text') setTextEdit({ id: hit.id, path: hit.path })
  }

  // 键盘（画布聚焦时）
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Escape') {
      if (textEdit) setTextEdit(null)
      else editor.select(null)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!selection.length) return
      e.preventDefault()
      editor.removeLayers(selection)
      return
    }
    if (e.key.startsWith('Arrow')) {
      if (!selection.length) return
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      for (const id of selection) {
        const hit = findLayer(scene.layers, id)
        if (!hit || hit.layer.locked) continue
        editor.updateLayer(id, {
          x: round2((Number(hit.layer.x) || 0) + dx),
          y: round2((Number(hit.layer.y) || 0) + dy)
        }, { label: '微调位置', mergeMs: 600 })
      }
      return
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); editor.duplicate(selection); return }
    if (mod && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      if (e.shiftKey) { for (const id of selection) editor.ungroup(id) }
      else { const gid = editor.group(selection); if (gid) onToast({ text: '已组合', kind: 'ok' }) }
      return
    }
    if (mod && (e.key === ']' || e.key === '[')) {
      e.preventDefault()
      const dir = e.key === ']' ? 1 : -1
      for (const id of selection) editor.reorder(id, dir as -1 | 1)
      return
    }
    // 复制/粘贴在 editor.ts 的全局快捷键里统一处理（画布聚焦也生效）
  }

  // ---------- 菜单 ----------
  const menuItems: MenuItem[] = menu ? buildMenu() : []
  function buildMenu(): MenuItem[] {
    const id = menu?.id ?? null
    const hit = id ? findLayer(scene.layers, id) : null
    const isGroup = Boolean(hit?.layer.children?.length)
    return [
      { id: 'dup', label: '创建副本', hint: 'Ctrl+D', disabled: !selection.length, onClick: () => editor.duplicate(selection) },
      { id: 'del', label: '删除', hint: 'Del', danger: true, disabled: !selection.length, onClick: () => editor.removeLayers(selection) },
      { id: 's1', label: '', separator: true },
      { id: 'group', label: '组合', hint: 'Ctrl+G', disabled: selection.length < 2, onClick: () => { if (editor.group(selection)) onToast({ text: '已组合', kind: 'ok' }) } },
      { id: 'ungroup', label: '解组', hint: 'Ctrl+Shift+G', disabled: !isGroup, onClick: () => { if (id) editor.ungroup(id) } },
      { id: 's2', label: '', separator: true },
      ...ALIGN_BAR.map(a => ({
        id: `align-${a.mode}`,
        label: a.text,
        disabled: selection.length < 2,
        onClick: () => applyAlign(a.mode)
      })),
      { id: 's2b', label: '', separator: true },
      { id: 'front', label: '上移一层', hint: 'Ctrl+]', disabled: !selection.length, onClick: () => selection.forEach(s => editor.reorder(s, 1)) },
      { id: 'back', label: '下移一层', hint: 'Ctrl+[', disabled: !selection.length, onClick: () => selection.forEach(s => editor.reorder(s, -1)) },
      { id: 's3', label: '', separator: true },
      {
        id: 'lock', label: hit?.layer.locked ? '解锁' : '锁定', disabled: !hit,
        onClick: () => { if (id) editor.updateLayer(id, { locked: !hit?.layer.locked }, { label: '锁定图层' }) }
      },
      {
        id: 'hide', label: hit?.layer.visible === false ? '显示' : '隐藏', disabled: !hit,
        onClick: () => { if (id) editor.updateLayer(id, { visible: hit?.layer.visible === false }, { label: '显示/隐藏图层' }) }
      },
      ...(hit && layerKind(hit.layer) === 'text' ? [{ id: 'edit', label: '编辑文字', onClick: () => setTextEdit({ id: hit.layer.id, path: hit.path }) }] : []),
      { id: 's4', label: '', separator: true },
      {
        id: 'ai', label: '让 AI 改这个元素', disabled: !hit,
        onClick: () => {
          if (!hit) return
          void window.gewu.sendPrompt(
            `请只修改元素「${hit.layer.name}」（id=${hit.layer.id}，${hit.path.length > 1 ? '在组合里' : '在根层级'}）。\n` +
            `先用 scene_inspect 看当前场景，然后用 scene_set_layer 按 id 修改这个元素；不要动其它元素。改完用 scene_render_frame 渲染 ${time.toFixed(1)}s 自检。`,
            { time, selectedLayerId: hit.layer.id }
          )
          onToast({ text: '已把这个元素发给 AI', kind: 'ok' })
        }
      },
      { id: 's5', label: '', separator: true },
      { id: 'guide-v', label: '在此加竖参考线', disabled: !menu?.at, onClick: () => addGuideAt('v') },
      { id: 'guide-h', label: '在此加横参考线', disabled: !menu?.at, onClick: () => addGuideAt('h') },
      {
        id: 'guide-clear', label: '清除参考线', disabled: !(userGuides.v.length || userGuides.h.length),
        onClick: () => editor.setGuides({ v: [], h: [] })
      },
      { id: 'ruler', label: showRulers ? '隐藏标尺' : '显示标尺', onClick: () => setShowRulers(v => !v) }
    ]
  }

  // ---------- 渲染 ----------
  const marquee = gesture?.kind === 'marquee' ? normalizeRect(gesture.start, gesture.cur) : null
  const region = gesture?.kind === 'region' ? normalizeRect(gesture.start, gesture.cur) : null
  const rect = rectOf()

  return (
    <main className="stage">
      <StageToolbar
        onToast={onToast}
        showBounds={showBounds}
        onToggleBounds={() => setShowBounds(v => !v)}
        showRulers={showRulers}
        onToggleRulers={() => setShowRulers(v => !v)}
        zoom={view.zoom}
        onZoom={z => setView(v => ({ ...v, zoom: z, panX: 0, panY: 0 }))}
        exportJob={exportJob}
      />
      <div className="stage-body" ref={wrapRef}>
        <div className="stage-frame" ref={frameRef}>
          <canvas
            ref={canvasRef}
            className="stage-canvas"
            data-canvas="1"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={e => {
              if (gesture) return
              const p = toDesign(e)
              setHoverId(p ? hitAt(p)?.id ?? null : null)
            }}
            onPointerLeave={() => setHoverId(null)}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes(DRAG_MIME)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={async e => {
              const asset = readDragAsset(e)
              if (!asset) return
              e.preventDefault()
              const p = toDesign(e)
              const res = await dropAssetAt(editor, asset, time, null, p ?? undefined)
              onToast({ text: res.message, kind: res.ok ? 'ok' : 'err' })
            }}
            onKeyDown={onKeyDown}
            onContextMenu={e => e.preventDefault()}
            style={{ cursor: spaceDown ? 'grab' : hoverId ? 'move' : 'default' }}
          />

          {/* 多选/单选盒子 */}
          {showBounds && boxes.map(b => (
            <div
              key={b.id}
              className={`sel-box ${selection.length > 1 ? 'multi' : ''}`}
              style={boxCss(b, rect, scene.canvas.width, scene.canvas.height, view)}
            >
              {boxes.length === 1 && (
                <>
                  <span className="sel-tag">{findLayer(scene.layers, b.id)?.layer.name ?? ''}</span>
                  {HANDLES.map(h => (
                    <i key={h} className={`h ${h}`} onPointerDown={e => startResize(e, h)} />
                  ))}
                  {b.canRotate && (
                    <i className="h rot" onPointerDown={startRotate} />
                  )}
                </>
              )}
            </div>
          ))}

          {/* 标尺 / 用户参考线 */}
          {rect && (() => {
            const m = viewMath(rect.width, rect.height, scene.canvas.width, scene.canvas.height, view)
            const step = niceStep(64 / m.scale)
            const xs: number[] = []
            for (let x = 0; x <= scene.canvas.width + 1e-6; x += step) xs.push(Math.round(x * 100) / 100)
            const ys: number[] = []
            for (let y = 0; y <= scene.canvas.height + 1e-6; y += step) ys.push(Math.round(y * 100) / 100)
            const draft = guideDraft
            return (
              <>
                {showRulers && (
                  <>
                    <div
                      className="stage-ruler top"
                      style={{ left: `${m.dx}px`, top: `${Math.max(0, m.dy - RULER)}px`, width: `${m.dw}px` }}
                      onPointerDown={e => startGuideDrag(e, 'h', -1)}
                      title="从标尺往下拖，拉出横参考线"
                    >
                      {xs.map((x, i) => (
                        <span key={x} className={`rk ${i % 5 === 0 ? 'major' : ''}`} style={{ left: `${x * m.scale}px` }}>
                          {i % 5 === 0 ? Math.round(x) : ''}
                        </span>
                      ))}
                    </div>
                    <div
                      className="stage-ruler left"
                      style={{ left: `${Math.max(0, m.dx - RULER)}px`, top: `${m.dy}px`, height: `${m.dh}px` }}
                      onPointerDown={e => startGuideDrag(e, 'v', -1)}
                      title="从标尺往右拖，拉出竖参考线"
                    >
                      {ys.map((y, i) => (
                        <span key={y} className={`rk ${i % 5 === 0 ? 'major' : ''}`} style={{ top: `${y * m.scale}px` }} />
                      ))}
                    </div>
                  </>
                )}
                {userGuides.v.map((x, i) => (
                  <div
                    key={`gv${i}`}
                    className="user-guide v"
                    style={{ left: `${m.dx + x * m.scale}px`, top: `${m.dy}px`, height: `${m.dh}px` }}
                    onPointerDown={e => startGuideDrag(e, 'v', i)}
                    onDoubleClick={() => removeGuide('v', i)}
                    title={`竖参考线 x=${Math.round(x)} · 拖动移动 / 双击删除`}
                  />
                ))}
                {userGuides.h.map((y, i) => (
                  <div
                    key={`gh${i}`}
                    className="user-guide h"
                    style={{ top: `${m.dy + y * m.scale}px`, left: `${m.dx}px`, width: `${m.dw}px` }}
                    onPointerDown={e => startGuideDrag(e, 'h', i)}
                    onDoubleClick={() => removeGuide('h', i)}
                    title={`横参考线 y=${Math.round(y)} · 拖动移动 / 双击删除`}
                  />
                ))}
                {draft && (draft.axis === 'v' ? (
                  <div className="user-guide v draft" style={{ left: `${m.dx + draft.value * m.scale}px`, top: `${m.dy}px`, height: `${m.dh}px` }} />
                ) : (
                  <div className="user-guide h draft" style={{ top: `${m.dy + draft.value * m.scale}px`, left: `${m.dx}px`, width: `${m.dw}px` }} />
                ))}
              </>
            )
          })()}

          {/* 吸附参考线 */}
          {snapGuides.v.map(x => <div key={`v${x}`} className="snap-line v" style={{ left: `${screenX(x, rect, scene.canvas.width, scene.canvas.height, view)}px` }} />)}
          {snapGuides.h.map(y => <div key={`h${y}`} className="snap-line h" style={{ top: `${screenY(y, rect, scene.canvas.width, scene.canvas.height, view)}px` }} />)}

          {/* 多选对齐条 */}
          {selection.length > 1 && boxes.length > 1 && (
            <div className="align-bar" role="toolbar" aria-label="对齐与分布">
              <span className="align-bar-label">{selection.length} 个元素</span>
              {ALIGN_BAR.map(a => (
                <button key={a.mode} className="align-btn" data-align={a.mode} onClick={() => applyAlign(a.mode)} title={ALIGN_LABEL[a.mode]}>
                  {a.text}
                </button>
              ))}
            </div>
          )}

          {/* 框选 */}
          {marquee && <div className="marquee-box" style={rectCss(marquee, rect, scene.canvas.width, scene.canvas.height, view)} />}

          {/* 框选给 AI（Shift+拖） */}
          {region && (
            <>
              <div className="region-box" style={rectCss(region, rect, scene.canvas.width, scene.canvas.height, view)} />
              <div
                className="region-actions"
                style={regionActionsCss(region, rect, scene.canvas.width, scene.canvas.height, view)}
              >
                <button className="btn primary sm" onClick={() => {
                  const r = region
                  setGesture(null)
                  void sendRegion(r)
                }}>让 AI 重画这块</button>
                <button className="btn sm" onClick={() => setGesture(null)}>取消</button>
              </div>
            </>
          )}

          {/* 文本就地编辑 */}
          {textEdit && rect && (() => {
            const hit = findLayer(scene.layers, textEdit.id)
            if (!hit) return null
            const b = worldBox(ancestorsOf(scene.layers, hit.path), hit.layer)
            if (!b) return null
            return (
              <TextEditor
                key={textEdit.id}
                layer={hit.layer}
                style={textEditorCss(b, rect, scene.canvas.width, scene.canvas.height, view, hit.layer)}
                onCommit={content => {
                  const t = hit.layer.text
                  if (t) {
                    const h = autoTextHeight(content, t, hit.layer.w ?? b.w)
                    editor.updateLayer(textEdit.id, { text: { ...t, content }, h: round2(h) }, { label: '改文字' })
                  }
                  setTextEdit(null)
                }}
                onCancel={() => setTextEdit(null)}
              />
            )
          })()}
        </div>
        <div className="stage-hint">
          {selection.length
            ? `${selection.length} 个选中 · 拖动画布元素移动 · 角手柄缩放 · 上方圆点旋转 · 方向键微调 · Del 删除`
            : '点选画面元素 · 空白处拖框多选 · Shift+拖框「让 AI 重画这块」· 空格拖动平移 · Ctrl+滚轮缩放'}
        </div>
      </div>
      <Timeline />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </main>
  )

  function unionOf(ids: string[]): Rect | null {
    const boxes = ids.map(id => {
      const hit = findLayer(scene.layers, id)
      if (!hit) return null
      const anc = ancestorsOf(scene.layers, hit.path)
      return worldBox(anc, hit.layer) ?? scanBox(scene, hit.path, time)
    }).filter((b): b is Rect => Boolean(b))
    if (!boxes.length) return null
    const x = Math.min(...boxes.map(b => b.x))
    const y = Math.min(...boxes.map(b => b.y))
    return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }
  }

  async function sendRegion(r: Rect) {
    const text = `我框选了画面中的一块区域（设计坐标 x=${Math.round(r.x)}, y=${Math.round(r.y)}, w=${Math.round(r.w)}, h=${Math.round(r.h)}，时间 ${time.toFixed(1)}s）。\n` +
      `请只修改这块区域对应的内容：先用 scene_inspect 看现有图层/组合，判断该区域由哪个元素负责，然后用 scene_set_layer 改写它（或新增一个覆盖该区域的元素）。\n` +
      `不要改动区域之外的画面。改完用 scene_render_frame 渲染 ${time.toFixed(1)}s 自检。`
    await window.gewu.sendPrompt(text, { time, selectedLayerId: editor.state.selectedLayerId ?? undefined, region: r })
    onToast({ text: '已把选区发给 AI', kind: 'ok' })
  }
}

/* ------------------------------ 子组件 ------------------------------ */

function TextEditor({ layer, style, onCommit, onCancel }: {
  layer: SceneLayer
  style: React.CSSProperties
  onCommit(content: string): void
  onCancel(): void
}) {
  const [value, setValue] = useState(layer.text?.content ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <textarea
      ref={ref}
      className="text-editor"
      style={style}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onCommit(value)
      }}
      onBlur={() => onCommit(value)}
    />
  )
}

/* ------------------------------ 几何/工具 ------------------------------ */

function boxCss(b: BoxInfo, rect: DOMRect | null, W: number, H: number, view: ViewState): React.CSSProperties {
  if (!rect) return { display: 'none' }
  const m = viewMath(rect.width, rect.height, W, H, view)
  const x = m.dx + b.box.x * m.scale
  const y = m.dy + b.box.y * m.scale
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${Math.max(2, b.box.w * m.scale)}px`,
    height: `${Math.max(2, b.box.h * m.scale)}px`,
    transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined
  }
}

function rectCss(r: Rect, rect: DOMRect | null, W: number, H: number, view: ViewState): React.CSSProperties {
  if (!rect) return { display: 'none' }
  const m = viewMath(rect.width, rect.height, W, H, view)
  return {
    left: `${m.dx + r.x * m.scale}px`,
    top: `${m.dy + r.y * m.scale}px`,
    width: `${r.w * m.scale}px`,
    height: `${r.h * m.scale}px`
  }
}

function regionActionsCss(r: Rect, rect: DOMRect | null, W: number, H: number, view: ViewState): React.CSSProperties {
  if (!rect) return { display: 'none' }
  const m = viewMath(rect.width, rect.height, W, H, view)
  return { left: `${m.dx + (r.x + r.w / 2) * m.scale}px`, top: `${m.dy + (r.y + r.h) * m.scale + 10}px` }
}

function textEditorCss(b: Rect, rect: DOMRect, W: number, H: number, view: ViewState, layer: SceneLayer): React.CSSProperties {
  const m = viewMath(rect.width, rect.height, W, H, view)
  const size = (layer.text?.size ?? 48) * m.scale
  return {
    left: `${m.dx + b.x * m.scale}px`,
    top: `${m.dy + b.y * m.scale}px`,
    width: `${Math.max(40, b.w * m.scale)}px`,
    height: `${Math.max(24, b.h * m.scale)}px`,
    fontSize: `${size}px`,
    lineHeight: layer.text?.lineHeight ?? 1.35,
    textAlign: layer.text?.align ?? 'left',
    color: layer.text?.color ?? '#e8eef2'
  }
}

function screenX(x: number, rect: DOMRect | null, W: number, H: number, view: ViewState): number {
  if (!rect) return 0
  return viewMath(rect.width, rect.height, W, H, view).dx + x * viewMath(rect.width, rect.height, W, H, view).scale
}
function screenY(y: number, rect: DOMRect | null, W: number, H: number, view: ViewState): number {
  if (!rect) return 0
  return viewMath(rect.width, rect.height, W, H, view).dy + y * viewMath(rect.width, rect.height, W, H, view).scale
}

/** 父坐标系里的点（去掉祖先变换） */
function toParentLocal(anc: SceneLayer[], layer: SceneLayer, p: { x: number; y: number }): { x: number; y: number } {
  const m = new DOMMatrix()
  for (const a of anc) m.multiplySelf(layerMatrixOf(a))
  const inv = m.inverse()
  const pt = inv.transformPoint(new DOMPoint(p.x, p.y))
  return { x: pt.x, y: pt.y }
}

function toLayerLocal(anc: SceneLayer[], layer: SceneLayer, p: { x: number; y: number }): { x: number; y: number } {
  const m = new DOMMatrix()
  for (const a of anc) m.multiplySelf(layerMatrixOf(a))
  m.multiplySelf(layerMatrixOf(layer))
  const pt = m.inverse().transformPoint(new DOMPoint(p.x, p.y))
  return { x: pt.x, y: pt.y }
}

/** 避免循环依赖：这里复制一份最小变换矩阵（与 stage-geometry.layerMatrix 等价） */
function layerMatrixOf(layer: SceneLayer): DOMMatrix {
  const m = new DOMMatrix()
  const x = Number(layer.x) || 0
  const y = Number(layer.y) || 0
  const rotation = Number(layer.rotation) || 0
  const scale = layer.scale === undefined ? 1 : Number(layer.scale) || 1
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (hasOwnBox(layer)) {
    m.translateSelf(x + w / 2, y + h / 2)
    if (rotation) m.rotateSelf(rotation)
    if (scale !== 1) m.scaleSelf(scale, scale)
    m.translateSelf(-w / 2, -h / 2)
  } else {
    m.translateSelf(x, y)
    if (rotation || scale !== 1) {
      m.translateSelf(w / 2, h / 2)
      if (rotation) m.rotateSelf(rotation)
      if (scale !== 1) m.scaleSelf(scale, scale)
      m.translateSelf(-w / 2, -h / 2)
    }
  }
  return m
}

/** 像素级命中：只画这一层，看点击点是否不透明 */
function alphaHit(scene: Scene, path: string[], p: { x: number; y: number }, t: number): boolean {
  const N = 9
  const C = 4
  const tmp = document.createElement('canvas')
  tmp.width = N
  tmp.height = N
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, N, N)
  ctx.setTransform(1, 0, 0, 1, C - p.x, C - p.y)
  renderScene({
    scene, ctx, width: scene.canvas.width, height: scene.canvas.height, t,
    onlyPath: path, onlySelf: true, drawBackground: false, onLayerError: () => undefined,
    asset: assetImage
  })
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const data = ctx.getImageData(C - 1, C - 1, 3, 3).data
  for (let k = 3; k < data.length; k += 4) if (data[k] > 8) return true
  return false
}

/** 低分辨率 alpha 扫描得到图层包围盒 */
function scanBox(scene: Scene, path: string[], t: number): Rect | null {
  const W = 160
  const H = Math.max(8, Math.round((W * scene.canvas.height) / scene.canvas.width))
  const tmp = document.createElement('canvas')
  tmp.width = W
  tmp.height = H
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.scale(W / scene.canvas.width, H / scene.canvas.height)
  renderScene({
    scene, ctx, width: scene.canvas.width, height: scene.canvas.height, t,
    onlyPath: path, drawBackground: false, onLayerError: () => undefined, asset: assetImage
  })
  ctx.restore()
  const data = ctx.getImageData(0, 0, W, H).data
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const sx = scene.canvas.width / W
  const sy = scene.canvas.height / H
  return { x: minX * sx, y: minY * sy, w: (maxX - minX + 1) * sx, h: (maxY - minY + 1) * sy }
}

/** 移动时的吸附：画布边缘/中心 + 用户参考线 + 其它元素边缘，返回修正后的位移和参考线 */
function computeSnap(scene: Scene, moving: Rect, dx: number, dy: number, selection: string[], scale: number, userGuides?: { v: number[]; h: number[] }): { dx: number; dy: number; guides: { v: number[]; h: number[] } } {
  const tol = SNAP_PX / Math.max(0.05, scale)
  const W = scene.canvas.width
  const H = scene.canvas.height
  const targetsX = [0, W / 2, W, ...(userGuides?.v ?? [])]
  const targetsY = [0, H / 2, H, ...(userGuides?.h ?? [])]
  for (const f of flatten(scene.layers)) {
    if (selection.includes(f.layer.id)) continue
    const anc = ancestorsOf(scene.layers, f.path)
    const b = worldBox(anc, f.layer)
    if (!b) continue
    targetsX.push(b.x, b.x + b.w / 2, b.x + b.w)
    targetsY.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  const edgesX = [moving.x + dx, moving.x + dx + moving.w / 2, moving.x + dx + moving.w]
  const edgesY = [moving.y + dy, moving.y + dy + moving.h / 2, moving.y + dy + moving.h]
  let bestX: { delta: number; at: number } | null = null
  for (const e of edgesX) {
    for (const t of targetsX) {
      const d = t - e
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) bestX = { delta: d, at: t }
    }
  }
  let bestY: { delta: number; at: number } | null = null
  for (const e of edgesY) {
    for (const t of targetsY) {
      const d = t - e
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) bestY = { delta: d, at: t }
    }
  }
  return {
    dx: dx + (bestX?.delta ?? 0),
    dy: dy + (bestY?.delta ?? 0),
    guides: { v: bestX ? [bestX.at] : [], h: bestY ? [bestY.at] : [] }
  }
}

function autoTextHeight(content: string, text: NonNullable<SceneLayer['text']>, width: number): number {
  const size = text.size || 48
  const lineHeight = (text.lineHeight ?? 1.35) * size
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.font = `${text.weight ?? 600} ${size}px ${text.font ?? '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif'}`
  let lines = 0
  for (const raw of content.split('\n')) {
    let line = ''
    let n = 1
    for (const ch of raw) {
      if (ctx.measureText(line + ch).width > width && line) { n++; line = ch } else line += ch
    }
    lines += n
  }
  return Math.max(lineHeight, lines * lineHeight)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
function clamp(v: number, a: number, b: number): number {
  return Math.min(Math.max(v, a), b)
}

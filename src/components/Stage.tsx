import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import type { Scene } from '../shared/scene'
import { SceneRenderer, blitTo } from '../engine/preview'
import { renderScene } from '../engine/render'
import { assetImage } from '../engine/assets'
import { Timeline } from './Timeline'
import { StageToolbar } from './StageToolbar'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
  exportJob: { running: boolean; frame: number; total: number; phase: string } | null
}

export function Stage({ onToast, exportJob }: Props) {
  const editor = useEditor()
  const { scene, time, playing, selectedLayerId } = editor.state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<SceneRenderer | null>(null)
  const lastTs = useRef<number>(0)
  const timeRef = useRef(time)
  timeRef.current = time
  const [showBounds, setShowBounds] = useState(true)
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [selBox, setSelBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [drag, setDrag] = useState<{ sx: number; sy: number; x: number; y: number } | null>(null)
  const [hoverLayer, setHoverLayer] = useState<string | null>(null)

  if (!rendererRef.current) rendererRef.current = new SceneRenderer(scene.canvas.width, scene.canvas.height)

  const renderNow = useCallback(() => {
    const r = rendererRef.current
    const c = canvasRef.current
    if (!r || !c) return
    r.render(scene, timeRef.current)
    blitTo(c, r.element)
  }, [scene])

  // 给播放循环用的稳定引用（避免把变化的函数塞进 effect 依赖）
  const renderNowRef = useRef(renderNow)
  renderNowRef.current = renderNow
  const editorRef = useRef(editor)
  editorRef.current = editor
  const durationRef = useRef(scene.canvas.duration)
  durationRef.current = scene.canvas.duration

  // 播放循环
  // 只依赖 playing：editor / scene / renderNow 每帧都会变，若放进依赖数组，
  // 这个 effect 会每帧被拆掉重建，lastTs 跟着重置，dt 永远只量到一小段，
  // 结果就是「点了播放几乎不动」。所以统一走 ref。
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
      // 单帧最多推进 0.25s：卡顿或窗口失焦回来后不要一下跳很远
      const dt = Math.min(0.25, Math.max(0, (now - lastTs.current) / 1000))
      lastTs.current = now
      // 播放中用户拖动播放头 → 以外部值为准
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

  // 场景/时间变化时重绘（非播放状态）
  useEffect(() => {
    if (!playing) renderNow()
  }, [time, scene, playing, renderNow])

  // 场景里引用了新图片时，先等它加载完再重绘（否则第一帧是占位框）
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    let alive = true
    void r.prepare(scene).then(() => { if (alive) renderNow() })
    return () => { alive = false }
  }, [scene, renderNow])

  // 窗口尺寸变化
  useEffect(() => {
    const ro = new ResizeObserver(() => { if (!playing) renderNow() })
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [playing, renderNow])

  // 选中图层的包围盒
  useEffect(() => {
    const r = rendererRef.current
    if (!r || !selectedLayerId || !showBounds) { setSelBox(null); return }
    const layer = scene.layers.find(l => l.id === selectedLayerId)
    if (!layer) { setSelBox(null); return }
    const box = computeLayerBox(r, scene, layer.id, time)
    setSelBox(box)
  }, [selectedLayerId, scene, time, showBounds])

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const scale = Math.min(rect.width / scene.canvas.width, rect.height / scene.canvas.height)
    const dx = (rect.width - scene.canvas.width * scale) / 2
    const dy = (rect.height - scene.canvas.height * scale) / 2
    const x = (e.clientX - rect.left - dx) / scale
    const y = (e.clientY - rect.top - dy) / scale
    if (x < 0 || y < 0 || x > scene.canvas.width || y > scene.canvas.height) return
    const hit = hitTest(rendererRef.current!, scene, x, y, time)
    editor.select(hit)
    if (!hit) onToast({ text: '没点到图层，可以框选一块区域让 AI 重画', kind: 'info' })
  }

  const regionSelection = drag && Math.abs(drag.x - drag.sx) > 12 && Math.abs(drag.y - drag.sy) > 12

  function promptRegion() {
    if (!drag) return
    const x = Math.min(drag.sx, drag.x)
    const y = Math.min(drag.sy, drag.y)
    const w = Math.abs(drag.x - drag.sx)
    const h = Math.abs(drag.y - drag.sy)
    setDrag(null)
    const text = `我框选了画面中的一块区域（设计坐标 x=${Math.round(x)}, y=${Math.round(y)}, w=${Math.round(w)}, h=${Math.round(h)}，时间 ${time.toFixed(1)}s）。\n` +
      `请只修改这块区域对应的内容：先用 scene_inspect 和 scene_read 看现有图层，判断该区域由哪个图层负责，然后用 scene_set_layer 改写该图层的绘制代码（或新增一个覆盖该区域的图层）。\n` +
      `不要改动区域之外的画面。改完用 scene_render_frame 渲染 ${time.toFixed(1)}s 自检。`
    void window.gewu.sendPrompt(text, {
      time,
      selectedLayerId: editor.state.selectedLayerId ?? undefined,
      region: { x, y, w, h }
    })
    onToast({ text: '已把选区发给 AI', kind: 'ok' })
  }

  return (
    <main className="stage">
      <StageToolbar
        onToast={onToast}
        showBounds={showBounds}
        onToggleBounds={() => setShowBounds(v => !v)}
        zoom={zoom}
        onZoom={setZoom}
        exportJob={exportJob}
      />
      <div className="stage-body" ref={wrapRef}>
        <div className="stage-frame">
          <canvas
            ref={canvasRef}
            className="stage-canvas"
            onClick={handleCanvasClick}
            onMouseDown={e => {
              const p = toDesign(e, canvasRef.current!, scene.canvas.width, scene.canvas.height)
              if (!p) return
              setDrag({ sx: p.x, sy: p.y, x: p.x, y: p.y })
            }}
            onMouseMove={e => {
              const p = toDesign(e, canvasRef.current!, scene.canvas.width, scene.canvas.height)
              if (drag && p) setDrag({ ...drag, x: p.x, y: p.y })
              if (p && !drag && rendererRef.current) {
                const hit = hitTest(rendererRef.current, scene, p.x, p.y, time)
                setHoverLayer(hit)
              }
            }}
            onMouseUp={() => {
              if (regionSelection) return
              setDrag(null)
            }}
            onMouseLeave={() => { setDrag(null); setHoverLayer(null) }}
            style={{ cursor: hoverLayer ? 'pointer' : 'crosshair' }}
          />
          {regionSelection && drag && (
            <RegionOverlay drag={drag} sceneW={scene.canvas.width} sceneH={scene.canvas.height} canvasEl={canvasRef.current!} onConfirm={promptRegion} onCancel={() => setDrag(null)} />
          )}
          {selBox && !regionSelection && (
            <div
              className="sel-box"
              style={boxStyle(selBox, scene.canvas.width, scene.canvas.height, canvasRef.current)}
            >
              <span className="sel-tag">{scene.layers.find(l => l.id === selectedLayerId)?.name ?? ''}</span>
              <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
            </div>
          )}
        </div>
      </div>
      <Timeline />
    </main>
  )
}

function toDesign(e: React.MouseEvent, c: HTMLCanvasElement, w: number, h: number): { x: number; y: number } | null {
  const rect = c.getBoundingClientRect()
  const scale = Math.min(rect.width / w, rect.height / h)
  const dx = (rect.width - w * scale) / 2
  const dy = (rect.height - h * scale) / 2
  const x = (e.clientX - rect.left - dx) / scale
  const y = (e.clientY - rect.top - dy) / scale
  if (x < 0 || y < 0 || x > w || y > h) return null
  return { x, y }
}

function boxStyle(box: { x: number; y: number; w: number; h: number }, w: number, h: number, c: HTMLCanvasElement | null) {
  if (!c) return {}
  const rect = c.getBoundingClientRect()
  const scale = Math.min(rect.width / w, rect.height / h)
  const dx = (rect.width - w * scale) / 2
  const dy = (rect.height - h * scale) / 2
  return {
    left: `${dx + box.x * scale}px`,
    top: `${dy + box.y * scale}px`,
    width: `${Math.max(2, box.w * scale)}px`,
    height: `${Math.max(2, box.h * scale)}px`
  }
}

/** 像素级命中测试：把每个图层单独画一遍，看点击点是否不透明 */
function hitTest(renderer: SceneRenderer, scene: Scene, x: number, y: number, t: number): string | null {
  // 关键：不要整幅缩放到 4×4 去采样。缩到 4×4 后 40px 的字、2px 的线只剩不到 0.1 像素，
  // alpha 几乎为 0，于是永远只能命中铺满画面的背景层。
  // 正确做法是把画布平移，让点击点正好落在小画布中心，按 1:1 渲染一小块。
  const N = 9
  const C = 4
  const tmp = document.createElement('canvas')
  tmp.width = N
  tmp.height = N
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const layer = scene.layers[i]
    if (layer.visible === false) continue
    if (layer.start !== undefined && t < layer.start) continue
    if (layer.end !== undefined && t > layer.end) continue
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, N, N)
    ctx.setTransform(1, 0, 0, 1, C - x, C - y)
    renderScene({
      scene, ctx, width: scene.canvas.width, height: scene.canvas.height, t,
      onlyLayerId: layer.id, drawBackground: false, onLayerError: () => undefined,
      asset: assetImage
    })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // 取 3×3 里的最大 alpha，容忍 1px 误差（细线、细笔画）
    const data = ctx.getImageData(C - 1, C - 1, 3, 3).data
    let maxA = 0
    for (let k = 3; k < data.length; k += 4) if (data[k] > maxA) maxA = data[k]
    if (maxA > 8) return layer.id
    void renderer
  }
  return null
}

/** 计算图层内容的包围盒：低分辨率渲染 + alpha 扫描 */
function computeLayerBox(renderer: SceneRenderer, scene: Scene, layerId: string, t: number) {
  const W = 160
  const H = Math.round((W * scene.canvas.height) / scene.canvas.width)
  const tmp = document.createElement('canvas')
  tmp.width = W
  tmp.height = H
  const ctx = tmp.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, W, H)
  ctx.save()
  ctx.scale(W / scene.canvas.width, H / scene.canvas.height)
  renderScene({
    scene, ctx, width: scene.canvas.width, height: scene.canvas.height, t,
    onlyLayerId: layerId, drawBackground: false, onLayerError: () => undefined,
    asset: assetImage
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

function RegionOverlay({ drag, sceneW, sceneH, canvasEl, onConfirm, onCancel }: {
  drag: { sx: number; sy: number; x: number; y: number }
  sceneW: number
  sceneH: number
  canvasEl: HTMLCanvasElement
  onConfirm(): void
  onCancel(): void
}) {
  const rect = canvasEl.getBoundingClientRect()
  const scale = Math.min(rect.width / sceneW, rect.height / sceneH)
  const dx = (rect.width - sceneW * scale) / 2
  const dy = (rect.height - sceneH * scale) / 2
  const x = dx + Math.min(drag.sx, drag.x) * scale
  const y = dy + Math.min(drag.sy, drag.y) * scale
  const w = Math.abs(drag.x - drag.sx) * scale
  const h = Math.abs(drag.y - drag.sy) * scale
  return (
    <>
      <div className="region-box" style={{ left: x, top: y, width: w, height: h }} />
      <div className="region-actions" style={{ left: x + w / 2, top: y + h + 10 }}>
        <button className="btn primary sm" onClick={onConfirm}>让 AI 重画这块</button>
        <button className="btn sm" onClick={onCancel}>取消</button>
      </div>
    </>
  )
}

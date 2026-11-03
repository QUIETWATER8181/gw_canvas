import type { Scene, SceneLayer } from '../shared/scene'
import { flatten } from '../shared/layers'
import { renderScene } from './render'
import { assetImage, preloadScene, scanAssetRefs } from './assets'

export interface RenderFrameResult {
  dataUrl: string
  errors: { layerId: string; error: string }[]
  preview: string
  size: number
  boxes: LayerBox[]
}

const ASCII_RAMP = ' .:-=+*#%@'

/**
 * 把 ImageData 转成带 ANSI 颜色的字符预览，让纯文本模型也能「看」到画面。
 * 用每个格子的最大亮度（保住细线），并按分位数做对比度归一化，
 * 否则深色背景上的矢量线条在均值下会被冲淡到看不见。
 */
export function imageToAnsiPreview(data: Uint8ClampedArray, w: number, h: number, cols = 96): string {
  const rows = Math.max(10, Math.round((cols * h) / w / 2.1))
  const cellW = w / cols
  const cellH = h / rows
  const lum = new Float32Array(cols * rows)
  const rgb = new Uint8Array(cols * rows * 3)
  const stepX = Math.max(1, Math.floor(cellW / 6))
  const stepY = Math.max(1, Math.floor(cellH / 6))

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.floor(rx * cellW)
      const x1 = Math.min(w, Math.ceil((rx + 1) * cellW))
      const y0 = Math.floor(ry * cellH)
      const y1 = Math.min(h, Math.ceil((ry + 1) * cellH))
      let best = -1
      let br = 0, bg = 0, bb = 0
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const i = (y * w + x) * 4
          const r = data[i], g = data[i + 1], b = data[i + 2]
          const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
          if (l > best) { best = l; br = r; bg = g; bb = b }
        }
      }
      const k = ry * cols + rx
      lum[k] = best < 0 ? 0 : best / 255
      rgb[k * 3] = br
      rgb[k * 3 + 1] = bg
      rgb[k * 3 + 2] = bb
    }
  }

  // 分位数归一化：把第 98 百分位映射到 1
  const sorted = Array.from(lum).sort((a, b) => a - b)
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] || 1
  const norm = p98 > 0.08 ? 1 / p98 : 1

  const lines: string[] = []
  for (let ry = 0; ry < rows; ry++) {
    let line = ''
    let lastFg = ''
    for (let rx = 0; rx < cols; rx++) {
      const k = ry * cols + rx
      const v = Math.min(1, lum[k] * norm)
      const ch = ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.max(0, Math.round(v * (ASCII_RAMP.length - 1))))]
      const r = rgb[k * 3], g = rgb[k * 3 + 1], b = rgb[k * 3 + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      let color = ''
      if (max - min < 20 || max < 40) color = ''
      else if (r === max && g >= b) color = g > r * 0.72 ? '\x1b[33m' : '\x1b[31m'
      else if (r === max) color = '\x1b[35m'
      else if (g === max) color = '\x1b[32m'
      else color = b > g * 1.1 ? '\x1b[34m' : '\x1b[36m'
      if (color !== lastFg) {
        line += color || '\x1b[0m'
        lastFg = color
      }
      line += ch
    }
    if (lastFg) line += '\x1b[0m'
    lines.push(line)
  }
  return lines.join('\n')
}

export interface LayerBox {
  id: string
  name: string
  /** 路径（嵌套元素用） */
  path: string[]
  x: number
  y: number
  w: number
  h: number
  coverage: number
}

/** 每个图层当前帧的实际占据范围（低分辨率 alpha 扫描），给文本模型判断构图 */
export function layerBoxes(scene: Scene, t: number, sampleWidth = 160): LayerBox[] {
  const out: LayerBox[] = []
  const W = sampleWidth
  const H = Math.max(8, Math.round((W * scene.canvas.height) / scene.canvas.width))
  const tmp = document.createElement('canvas')
  tmp.width = W
  tmp.height = H
  const ctx = tmp.getContext('2d', { willReadFrequently: true })
  if (!ctx) return out
  for (const flat of flatten(scene.layers)) {
    const layer = flat.layer
    if (layer.visible === false) continue
    if (layer.start !== undefined && t < layer.start) continue
    if (layer.end !== undefined && t > layer.end) continue
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.scale(W / scene.canvas.width, H / scene.canvas.height)
    renderScene({
      scene, ctx, width: scene.canvas.width, height: scene.canvas.height, t,
      onlyPath: flat.path, drawBackground: false, onLayerError: () => undefined,
      asset: assetImage
    })
    ctx.restore()
    const data = ctx.getImageData(0, 0, W, H).data
    let minX = W, minY = H, maxX = -1, maxY = -1, lit = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > 8) {
          lit++
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) continue
    const sx = scene.canvas.width / W
    const sy = scene.canvas.height / H
    out.push({
      id: layer.id,
      name: layer.name,
      path: flat.path,
      x: Math.round(minX * sx),
      y: Math.round(minY * sy),
      w: Math.round((maxX - minX + 1) * sx),
      h: Math.round((maxY - minY + 1) * sy),
      coverage: Math.round((lit / (W * H)) * 1000) / 10
    })
  }
  return out
}


/** 场景渲染器：维护一个离屏 canvas，按设计尺寸绘制 */
export class SceneRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  lastErrors: { layerId: string; error: string }[] = []

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  get element(): HTMLCanvasElement { return this.canvas }

  private preparedKey = ''

  /** 预加载场景里用到的图片；场景变了才重新加载 */
  prepare(scene: Scene): Promise<void> {
    const key = scanAssetRefs(scene).join('|')
    if (key === this.preparedKey) return Promise.resolve()
    this.preparedKey = key
    return preloadScene(scene)
  }

  render(scene: Scene, t: number, opts?: { hideLayerIds?: Set<string>; onlyLayerId?: string; onlyPath?: string[] }): void {
    this.resize(scene.canvas.width, scene.canvas.height)
    this.lastErrors = []
    this.ctx.save()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    renderScene({
      scene,
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      t,
      hideLayerIds: opts?.hideLayerIds,
      onlyLayerId: opts?.onlyLayerId,
      onlyPath: opts?.onlyPath,
      onLayerError: (layerId, error) => {
        if (!this.lastErrors.some(e => e.layerId === layerId)) this.lastErrors.push({ layerId, error })
      },
      asset: assetImage
    })
    this.ctx.restore()
  }

  /** 渲染某一帧并生成预览 + PNG */
  capture(scene: Scene, t: number, cols = 96): RenderFrameResult {
    this.render(scene, t)
    const data = this.ctx.getImageData(0, 0, this.width, this.height).data
    const preview = imageToAnsiPreview(data, this.width, this.height, cols)
    return {
      dataUrl: this.canvas.toDataURL('image/png'),
      errors: this.lastErrors,
      preview,
      size: this.width,
      boxes: layerBoxes(scene, t)
    }
  }

  /** 生成某个图层的缩略图（透明背景） */
  layerThumb(scene: Scene, layer: SceneLayer, t: number, w = 64, h = 36): string {
    const tmp = document.createElement('canvas')
    tmp.width = w
    tmp.height = h
    const c = tmp.getContext('2d')!
    c.fillStyle = '#0d1117'
    c.fillRect(0, 0, w, h)
    const scale = Math.min(w / scene.canvas.width, h / scene.canvas.height)
    c.save()
    c.translate((w - scene.canvas.width * scale) / 2, (h - scene.canvas.height * scale) / 2)
    c.scale(scale, scale)
    renderScene({
      scene,
      ctx: c,
      width: scene.canvas.width,
      height: scene.canvas.height,
      t,
      onlyLayerId: layer.id,
      onLayerError: () => undefined,
      asset: assetImage
    })
    c.restore()
    return tmp.toDataURL('image/png')
  }
}

/** 预览用：把离屏 canvas 画到显示 canvas 上（含 letterbox + 可选缩放平移） */
export function blitTo(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  bg = '#0a0e13',
  view?: { zoom: number; panX: number; panY: number }
): void {
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cw, ch)
  const base = Math.min(cw / source.width, ch / source.height)
  const scale = base * (view?.zoom ?? 1)
  const dw = source.width * scale
  const dh = source.height * scale
  const dx = (cw - dw) / 2 + (view?.panX ?? 0)
  const dy = (ch - dh) / 2 + (view?.panY ?? 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, dx, dy, dw, dh)
}

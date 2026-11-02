/**
 * 让文字模型「看见」图片：把参考图/首尾帧转成字符预览 + 调色板 + 分区色块。
 * 和 scene_render_frame 用的是同一套字符画逻辑，模型已经习惯了这种表达。
 */
import { imageFor } from './assets'
import { imageToAnsiPreview } from './preview'

export interface ImageDescription {
  width: number
  height: number
  /** 字符预览（带 ANSI 颜色） */
  preview: string
  /** 主色（按占比排序的 hex） */
  palette: string[]
  /** 8 列 × 5 行的分区平均色 */
  grid: string[][]
  /** 平均亮度 0..255 */
  brightness: number
  /** 边缘密度（0..1），越高细节越多 */
  detail: number
}

const MAX_SIDE = 96

function toCanvas(name: string, maxSide = MAX_SIDE): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const entry = imageFor(name)
  if (!entry) return null
  const iw = entry.width
  const ih = entry.height
  const scale = Math.min(1, maxSide / Math.max(iw, ih))
  const w = Math.max(4, Math.round(iw * scale))
  const h = Math.max(4, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(entry.el, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

export function describeImage(name: string, cols = 64): ImageDescription | null {
  const c = toCanvas(name, 128)
  if (!c) return null
  const { ctx, w, h } = c
  const data = ctx.getImageData(0, 0, w, h).data

  // 调色板：粗量化后按占比排序
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    sum += (r + g + b) / 3
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const hit = buckets.get(key)
    if (hit) {
      hit.n++
      hit.r += r
      hit.g += g
      hit.b += b
    } else {
      buckets.set(key, { n: 1, r, g, b })
    }
  }
  const palette = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)
    .map(v => `${hex(v.r / v.n, v.g / v.n, v.b / v.n)} ${Math.round((v.n / (w * h)) * 100)}%`)

  // 分区色块
  const GX = 8
  const GY = 5
  const grid: string[][] = []
  for (let gy = 0; gy < GY; gy++) {
    const row: string[] = []
    for (let gx = 0; gx < GX; gx++) {
      const x0 = Math.floor((gx * w) / GX)
      const x1 = Math.floor(((gx + 1) * w) / GX)
      const y0 = Math.floor((gy * h) / GY)
      const y1 = Math.floor(((gy + 1) * h) / GY)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          n++
        }
      }
      row.push(n ? hex(r / n, g / n, b / n) : '#000000')
    }
    grid.push(row)
  }

  // 边缘密度：相邻像素亮度差的均值
  let edge = 0
  let cnt = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4
      const j = (y * w + x + 1) * 4
      const k = ((y + 1) * w + x) * 4
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3
      const vr = (data[j] + data[j + 1] + data[j + 2]) / 3
      const vd = (data[k] + data[k + 1] + data[k + 2]) / 3
      edge += Math.abs(v - vr) + Math.abs(v - vd)
      cnt++
    }
  }

  return {
    width: c.w,
    height: c.h,
    preview: imageToAnsiPreview(data, w, h, cols),
    palette,
    grid,
    brightness: sum / (w * h),
    detail: cnt ? Math.min(1, edge / cnt / 60) : 0
  }
}

export interface ImageDiff {
  /** 变化的包围盒（按图片宽高的比例 0..1） */
  bbox: { x: number; y: number; w: number; h: number } | null
  /** 变化像素占比 */
  changedRatio: number
  /** 变化区域的运动向量（比例坐标）：变暗处 → 变亮处，正数=向右/向下 */
  centroidShift: { dx: number; dy: number } | null
  /** 12×7 的变化强度图，数字 0-9 */
  map: string[]
  /** 整体平均色差 0..255 */
  meanDelta: number
}

/** 比较两张图（首帧 / 尾帧），告诉模型哪里变了、往哪个方向变 */
export function compareImages(a: string, b: string): ImageDiff | null {
  const ca = toCanvas(a, 128)
  const cb = toCanvas(b, 128)
  if (!ca || !cb) return null
  const W = Math.min(ca.w, cb.w)
  const H = Math.min(ca.h, cb.h)
  const da = ca.ctx.getImageData(0, 0, W, H).data
  const db = cb.ctx.getImageData(0, 0, W, H).data

  const GX = 12
  const GY = 7
  const cells = new Float64Array(GX * GY)
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  let changed = 0
  let delta = 0

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3
      delta += d
      if (d > 26) {
        changed++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
      cells[Math.min(GY - 1, Math.floor((y / H) * GY)) * GX + Math.min(GX - 1, Math.floor((x / W) * GX))] += d
    }
  }
  const cellArea = (W / GX) * (H / GY)
  const map: string[] = []
  for (let gy = 0; gy < GY; gy++) {
    let row = ''
    for (let gx = 0; gx < GX; gx++) {
      const v = cells[gy * GX + gx] / cellArea
      row += String(Math.min(9, Math.round(v / 12)))
    }
    map.push(row)
  }

  // 运动方向：变暗的像素 ≈ 元素原来在哪，变亮的像素 ≈ 元素现在在哪
  let dw = 0, dxx = 0, dyy = 0
  let lw = 0, lxx = 0, lyy = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const va = (da[i] + da[i + 1] + da[i + 2]) / 3
      const vb = (db[i] + db[i + 1] + db[i + 2]) / 3
      const diff = vb - va
      if (diff < -20) { dw += -diff; dxx += -diff * x; dyy += -diff * y }
      else if (diff > 20) { lw += diff; lxx += diff * x; lyy += diff * y }
    }
  }

  const shift = dw > 0 && lw > 0
    ? { dx: (lxx / lw - dxx / dw) / W, dy: (lyy / lw - dyy / dw) / H }
    : null

  return {
    bbox: maxX >= 0 ? { x: minX / W, y: minY / H, w: (maxX - minX) / W, h: (maxY - minY) / H } : null,
    changedRatio: changed / (W * H),
    centroidShift: shift,
    map,
    meanDelta: delta / (W * H)
  }
}

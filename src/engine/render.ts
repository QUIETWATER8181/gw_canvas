import type { Scene, SceneLayer } from '../shared/scene'
import type { Ctx2D, DrawScope } from './types'
import { createDrawKit } from './draw'
import { assetImage } from './assets'
import { ease, util } from './ease'

export type LayerDraw = (scope: DrawScope) => void

export interface CompileResult {
  draw: LayerDraw | null
  error: string | null
}

const cache = new Map<string, CompileResult>()

/**
 * 编译图层绘制代码。代码以函数体形式执行，可用变量见 LayerScope：
 * ctx, t, p, duration, width, height, cx, cy, theme, ease, util, g, asset
 * 返回 undefined；所有绘制都通过 g.* 或 ctx.* 完成。
 */
export function compileLayer(layer: SceneLayer): CompileResult {
  const key = `${layer.id}\u0000${layer.draw}`
  const hit = cache.get(key)
  if (hit) return hit
  let result: CompileResult
  try {
    // 用 async 包裹，允许用户在代码里使用 await（引擎按同步调用，await 会退化为微任务，不阻塞渲染）
    const fn = new Function(
      'scope',
      `"use strict";
const { ctx, t, p, duration, width, height, cx, cy, theme, ease, util, g, asset } = scope;
${layer.draw}
`
    ) as (scope: DrawScope) => void
    result = { draw: fn, error: null }
  } catch (error) {
    result = { draw: null, error: error instanceof Error ? error.message : String(error) }
  }
  cache.set(key, result)
  if (cache.size > 200) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  return result
}

export function clearCompileCache(): void {
  cache.clear()
}

export interface RenderOptions {
  scene: Scene
  ctx: Ctx2D
  /** 设计尺寸 */
  width: number
  height: number
  /** 当前时间（秒） */
  t: number
  /** 只渲染指定图层（用于选区高亮/命中测试） */
  onlyLayerId?: string
  /** 隐藏某些图层（导出时用） */
  hideLayerIds?: Set<string>
  /** 是否绘制背景 */
  drawBackground?: boolean
  /** 是否绘制字幕（默认绘制） */
  drawSubtitles?: boolean
  /** 错误回调 */
  onLayerError?: (layerId: string, error: string) => void
  /** 资源解析；缺省从图片缓存取 */
  asset?: (name: string) => HTMLImageElement | null
}

/** 把场景渲染到给定上下文（上下文需已按 scale 缩放，坐标系为设计坐标） */
export function renderScene(opts: RenderOptions): void {
  const { scene, ctx, t } = opts
  const W = opts.width
  const H = opts.height
  const theme = scene.theme

  ctx.save()
  if (opts.drawBackground !== false) {
    ctx.fillStyle = scene.canvas.background ?? theme.bg
    ctx.fillRect(0, 0, W, H)
  }

  const kit = createDrawKit({ width: W, height: H, theme, ctx })
  const duration = scene.canvas.duration
  const p = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0
  const asset = opts.asset ?? assetImage

  for (const layer of scene.layers) {
    if (opts.onlyLayerId && layer.id !== opts.onlyLayerId) continue
    if (opts.hideLayerIds?.has(layer.id)) continue
    if (layer.visible === false) continue
    if (layer.start !== undefined && t < layer.start) continue
    if (layer.end !== undefined && t > layer.end) continue
    if (!layer.draw?.trim()) continue

    const compiled = compileLayer(layer)
    if (!compiled.draw) {
      opts.onLayerError?.(layer.id, compiled.error ?? '编译失败')
      continue
    }

    ctx.save()
    ctx.globalAlpha = layer.opacity ?? 1
    if (layer.blend) ctx.globalCompositeOperation = layer.blend
    if (layer.x || layer.y) ctx.translate(layer.x ?? 0, layer.y ?? 0)
    const scope: DrawScope = {
      t, p, duration, width: W, height: H, ctx, theme, cx: W / 2, cy: H / 2,
      ease, util, g: kit, asset
    }
    try {
      compiled.draw(scope)
    } catch (error) {
      const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      opts.onLayerError?.(layer.id, msg)
    } finally {
      ctx.restore()
    }
  }

  // 字幕画在所有图层之上
  if (opts.drawSubtitles !== false && scene.subtitles?.length) {
    for (const sub of scene.subtitles) {
      if (t < sub.start || t > sub.end) continue
      const fade = Math.min(1, (t - sub.start) / 0.18, (sub.end - t) / 0.18)
      drawSubtitle(ctx, sub.text, W, H, theme, Math.max(0, fade))
    }
  }

  ctx.restore()
}

function drawSubtitle(ctx: Ctx2D, text: string, W: number, H: number, theme: Scene['theme'], alpha: number): void {
  const size = Math.round(Math.min(W, H) * 0.042)
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.font = `600 ${size}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const maxWidth = W * 0.82
  const lines = wrapText(ctx, text, maxWidth)
  const lineHeight = size * 1.45
  const baseY = H - Math.round(H * 0.075)
  const startY = baseY - (lines.length - 1) * lineHeight
  ctx.fillStyle = 'rgba(6,10,14,0.55)'
  const boxW = Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width))) + size * 1.2
  const boxH = lines.length * lineHeight + size * 0.7
  ctx.beginPath()
  const bx = W / 2 - boxW / 2
  const by = startY - size * 1.0
  const r = size * 0.45
  ctx.moveTo(bx + r, by)
  ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r)
  ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r)
  ctx.arcTo(bx, by + boxH, bx, by, r)
  ctx.arcTo(bx, by, bx + boxW, by, r)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = theme.fg
  lines.forEach((line, i) => {
    ctx.fillText(line, W / 2, startY + i * lineHeight, maxWidth)
  })
  ctx.restore()
}

function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    const next = line + ch
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line)
      line = ch
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

/** 图层在该时刻是否可见 */
export function layerVisibleAt(layer: SceneLayer, t: number): boolean {
  if (layer.visible === false) return false
  if (layer.start !== undefined && t < layer.start) return false
  if (layer.end !== undefined && t > layer.end) return false
  return true
}

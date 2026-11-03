import type { Scene, SceneLayer } from '../shared/scene'
import { hasOwnBox, layerKind } from '../shared/scene'
import type { Ctx2D, DrawScope } from './types'
import { createDrawKit } from './draw'
import { createThree3D } from './three3d'
import { assetImage } from './assets'
import { ease, util } from './ease'

export type LayerDraw = (scope: DrawScope) => void

export interface CompileResult {
  draw: LayerDraw | null
  error: string | null
}

const cache = new Map<string, CompileResult>()

/** 图层作用域里预置的变量名。用它们当局部变量会报「已经声明过」。 */
export const RESERVED_NAMES = [
  'ctx', 't', 'p', 'duration', 'width', 'height', 'cx', 'cy',
  'theme', 'ease', 'util', 'g', 'asset', 'three'
] as const

/**
 * 把 V8 的「Identifier 'x' has already been declared」翻译成人话。
 * `p` / `t` 这种单字母名最容易撞车，而报错原文完全看不出是「你撞了内置变量」。
 */
function explainCompileError(message: string): string {
  const dup = message.match(/Identifier '([^']+)' has already been declared/)
  if (dup) {
    const name = dup[1]
    const reserved = (RESERVED_NAMES as readonly string[]).includes(name)
    return reserved
      ? `变量名 ${name} 是图层内置变量（可用：${RESERVED_NAMES.join(' / ')}），换个名字，比如 ${name}2 或 ${name}os`
      : `${message}（同一段代码里重复声明了 ${name}）`
  }
  return message
}

/**
 * 编译图层绘制代码。代码以函数体形式执行，可用变量见 DrawScope：
 * ctx, t, p, duration, width, height, cx, cy, theme, ease, util, g, asset
 * 返回 undefined；所有绘制都通过 g.* 或 ctx.* 完成。
 */
export function compileLayer(layer: SceneLayer): CompileResult {
  const source = layer.draw ?? ''
  if (!source.trim()) return { draw: null, error: null }
  const key = `${layer.id}\u0000${source}`
  const hit = cache.get(key)
  if (hit) return hit
  let result: CompileResult
  try {
    // 用 async 包裹，允许用户在代码里使用 await（引擎按同步调用，await 会退化为微任务，不阻塞渲染）
    const fn = new Function(
      'scope',
      `"use strict";
const { ctx, t, p, duration, width, height, cx, cy, theme, ease, util, g, asset, three } = scope;
${source}
`
    ) as (scope: DrawScope) => void
    result = { draw: fn, error: null }
  } catch (error) {
    result = { draw: null, error: explainCompileError(error instanceof Error ? error.message : String(error)) }
  }
  cache.set(key, result)
  if (cache.size > 400) {
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
  /** 只渲染某条路径（含祖先的 transform），用于嵌套元素命中测试 */
  onlyPath?: string[]
  /** 只画目标节点自己的内容，不画它的子元素（命中测试用） */
  onlySelf?: boolean
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

interface PaintEnv {
  ctx: Ctx2D
  W: number
  H: number
  t: number
  p: number
  duration: number
  theme: Scene['theme']
  kit: ReturnType<typeof createDrawKit>
  three: ReturnType<typeof createThree3D>
  asset: (name: string) => HTMLImageElement | null
  onlyPath?: string[]
  onlySelf?: boolean
  onlyLayerId?: string
  hide?: Set<string>
  onError?: (id: string, msg: string) => void
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

  const duration = scene.canvas.duration
  const env: PaintEnv = {
    ctx,
    W,
    H,
    t,
    p: duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 0,
    duration,
    theme,
    kit: createDrawKit({ width: W, height: H, theme, ctx }),
    three: createThree3D({ width: W, height: H, theme, ctx }),
    asset: opts.asset ?? assetImage,
    onlyPath: opts.onlyPath,
    onlySelf: opts.onlySelf,
    onlyLayerId: opts.onlyLayerId,
    hide: opts.hideLayerIds,
    onError: opts.onLayerError
  }

  paintList(scene.layers, env, [])

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

function paintList(layers: SceneLayer[], env: PaintEnv, basePath: string[]): void {
  for (const layer of layers) {
    const path = [...basePath, layer.id]
    const isTarget = env.onlyPath ? samePath(path, env.onlyPath) : true
    const isAncestor = env.onlyPath ? isPrefix(path, env.onlyPath) : true
    if (env.onlyLayerId && !env.onlyPath) {
      // 老接口：只要这一层（以及它的子树）
      if (layer.id !== env.onlyLayerId && !hasDescendant(layer, env.onlyLayerId)) continue
    }
    if (!isTarget && !isAncestor) continue
    if (env.hide?.has(layer.id)) continue
    if (layer.visible === false) continue
    if (layer.start !== undefined && env.t < layer.start) continue
    if (layer.end !== undefined && env.t > layer.end) continue

    const paintSelf = isTarget
    const paintKids = (isTarget || isAncestor) && !(isTarget && env.onlySelf)

    env.ctx.save()
    env.ctx.globalAlpha *= clamp01(layer.opacity ?? 1)
    if (layer.blend && layer.blend !== 'source-over') env.ctx.globalCompositeOperation = layer.blend
    applyTransform(env.ctx, layer)

    if (paintSelf) paintContent(layer, env)

    const kids = layer.children ?? []
    if (kids.length && paintKids) paintList(kids, env, path)
    env.ctx.restore()
  }
}

function hasDescendant(layer: SceneLayer, id: string): boolean {
  for (const kid of layer.children ?? []) {
    if (kid.id === id || hasDescendant(kid, id)) return true
  }
  return false
}

function applyTransform(ctx: Ctx2D, layer: SceneLayer): void {
  const x = Number(layer.x) || 0
  const y = Number(layer.y) || 0
  const rotation = Number(layer.rotation) || 0
  const scale = layer.scale === undefined ? 1 : Number(layer.scale) || 0
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (hasOwnBox(layer)) {
    // typed 元素绕盒子中心旋转/缩放，拖动手感才正常
    ctx.translate(x + w / 2, y + h / 2)
    if (rotation) ctx.rotate((rotation * Math.PI) / 180)
    if (scale !== 1) ctx.scale(scale, scale)
    ctx.translate(-w / 2, -h / 2)
  } else {
    if (x || y) ctx.translate(x, y)
    if (rotation || scale !== 1) {
      const cx = w / 2
      const cy = h / 2
      ctx.translate(cx, cy)
      if (rotation) ctx.rotate((rotation * Math.PI) / 180)
      if (scale !== 1) ctx.scale(scale, scale)
      ctx.translate(-cx, -cy)
    }
  }
}

function paintContent(layer: SceneLayer, env: PaintEnv): void {
  const kind = layerKind(layer)
  try {
    if (kind === 'text') paintText(layer, env)
    else if (kind === 'image') paintImage(layer, env)
    else if (kind === 'shape') paintShape(layer, env)
    else if (kind === 'group') {
      // 组合可以自带一层代码（当背景板用），没有就只画子元素
      if ((layer.draw ?? '').trim()) paintCode(layer, env)
    } else paintCode(layer, env)
  } catch (error) {
    const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    env.onError?.(layer.id, msg)
  }
}

function paintCode(layer: SceneLayer, env: PaintEnv): void {
  const compiled = compileLayer(layer)
  if (!compiled.draw) {
    if (compiled.error) env.onError?.(layer.id, compiled.error)
    return
  }
  const scope: DrawScope = {
    t: env.t,
    p: env.p,
    duration: env.duration,
    width: env.W,
    height: env.H,
    ctx: env.ctx,
    theme: env.theme,
    cx: env.W / 2,
    cy: env.H / 2,
    ease,
    util,
    g: env.kit,
    asset: env.asset,
    three: env.three
  }
  compiled.draw(scope)
}

function paintText(layer: SceneLayer, env: PaintEnv): void {
  const props = layer.text
  if (!props || !props.content) return
  const ctx = env.ctx
  const size = Math.max(4, Number(props.size) || 48)
  const weight = props.weight ?? 600
  const lineHeight = (props.lineHeight ?? 1.35) * size
  const maxWidth = Math.max(16, Number(props.maxWidth) || Number(layer.w) || env.W - (layer.x ?? 0))
  const color = props.color ?? env.theme.fg
  const align = props.align ?? 'left'
  const font = props.font ?? '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif'

  ctx.save()
  ctx.font = `${weight} ${size}px ${font}`
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  ctx.fillStyle = color
  const lines = wrapText(ctx, props.content, maxWidth)
  const blockH = lines.length * lineHeight
  if (props.background) {
    ctx.fillStyle = props.background
    const w = Math.max(...lines.map(l => ctx.measureText(l).width), 1)
    const pad = size * 0.25
    const bx = align === 'center' ? (maxWidth - w) / 2 : align === 'right' ? maxWidth - w : 0
    ctx.fillRect(bx - pad, -pad, w + pad * 2, blockH + pad * 2)
    ctx.fillStyle = color
  }
  const tx = align === 'center' ? maxWidth / 2 : align === 'right' ? maxWidth : 0
  lines.forEach((line, i) => ctx.fillText(line, tx, i * lineHeight, maxWidth))
  ctx.restore()
}

function paintImage(layer: SceneLayer, env: PaintEnv): void {
  const props = layer.image
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (!props?.src || w <= 0 || h <= 0) return
  const img = env.asset(props.src)
  const ctx = env.ctx
  ctx.save()
  if (props.radius) {
    roundRect(ctx, 0, 0, w, h, props.radius)
    ctx.clip()
  }
  if (!img || !img.complete || !img.naturalWidth) {
    ctx.strokeStyle = props.placeholder ?? 'rgba(125,139,150,0.6)'
    ctx.lineWidth = 2
    ctx.setLineDash?.([8, 6])
    ctx.strokeRect(1, 1, w - 2, h - 2)
    ctx.setLineDash?.([])
    ctx.fillStyle = 'rgba(125,139,150,0.75)'
    ctx.font = `500 ${Math.max(12, Math.min(w, h) * 0.08)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(props.src.split('/').pop() ?? 'image', w / 2, h / 2)
    ctx.restore()
    return
  }
  const fit = props.fit ?? 'stretch'
  if (fit === 'stretch') {
    ctx.drawImage(img, 0, 0, w, h)
  } else {
    const ir = img.naturalWidth / img.naturalHeight
    const br = w / h
    const cover = fit === 'cover'
    let dw = w
    let dh = h
    if ((ir > br) !== cover) dh = w / ir
    else dw = h * ir
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  }
  ctx.restore()
}

function paintShape(layer: SceneLayer, env: PaintEnv): void {
  const props = layer.shape
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (!props || w <= 0 || h <= 0) return
  const ctx = env.ctx
  const fill = props.fill ?? env.theme.accent
  const stroke = props.stroke
  const lw = Math.max(0, Number(props.strokeWidth ?? 0))
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  if (props.type === 'rect') {
    if (props.radius) roundRect(ctx, 0, 0, w, h, props.radius)
    else ctx.rect(0, 0, w, h)
  } else if (props.type === 'ellipse') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  } else if (props.type === 'triangle') {
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
  } else {
    // line / arrow：从左上到右下
    ctx.moveTo(0, 0)
    ctx.lineTo(w, h)
  }
  if (props.type === 'line' || props.type === 'arrow') {
    ctx.strokeStyle = stroke ?? fill
    ctx.lineWidth = lw || 4
    ctx.stroke()
    if (props.type === 'arrow') {
      const angle = Math.atan2(h, w)
      const head = Math.max(10, (lw || 4) * 4)
      ctx.beginPath()
      ctx.moveTo(w, h)
      ctx.lineTo(w - head * Math.cos(angle - 0.42), h - head * Math.sin(angle - 0.42))
      ctx.moveTo(w, h)
      ctx.lineTo(w - head * Math.cos(angle + 0.42), h - head * Math.sin(angle + 0.42))
      ctx.stroke()
    }
  } else {
    if (fill && fill !== 'none') {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (stroke) {
      ctx.strokeStyle = stroke
      ctx.lineWidth = lw || 2
      ctx.stroke()
    }
  }
  ctx.restore()
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1))
}

function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function isPrefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => v === path[i])
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

export function wrapText(ctx: Ctx2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const rawLine of String(text).split('\n')) {
    let line = ''
    for (const ch of rawLine) {
      const next = line + ch
      if (ctx.measureText(next).width > maxWidth && line) {
        out.push(line)
        line = ch
      } else {
        line = next
      }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

/** 图层在该时刻是否可见 */
export function layerVisibleAt(layer: SceneLayer, t: number): boolean {
  if (layer.visible === false) return false
  if (layer.start !== undefined && t < layer.start) return false
  if (layer.end !== undefined && t > layer.end) return false
  return true
}

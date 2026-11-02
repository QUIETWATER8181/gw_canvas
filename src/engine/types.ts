import type { SceneTheme } from '../shared/scene'

export type Ctx2D = CanvasRenderingContext2D

export interface Vec {
  x: number
  y: number
}

export interface DrawScope {
  /** 当前时间（秒） */
  t: number
  /** 场景时长（秒） */
  duration: number
  /** 归一化进度 0..1 */
  p: number
  /** 画布设计尺寸 */
  width: number
  height: number
  /** 画布 2D 上下文；已按图层平移/透明度设置好 */
  ctx: Ctx2D
  theme: SceneTheme
  /** 画布中心 */
  cx: number
  cy: number
  /** 缓动函数集合 */
  ease: EaseFns
  /** 物理/数学小工具 */
  util: UtilFns
  /** 高级绘图原语 */
  g: DrawKit
  /**
   * 取一张已加载的图片（可直接传给 ctx.drawImage）。
   * 场景渲染前会自动 preload 所有 asset('…') / g.image('…') 引用到的图。
   * 图片还没加载好时返回 null。
   */
  asset(name: string): HTMLImageElement | null
}

export interface EaseFns {
  linear(x: number): number
  inQuad(x: number): number
  outQuad(x: number): number
  inOutQuad(x: number): number
  inCubic(x: number): number
  outCubic(x: number): number
  inOutCubic(x: number): number
  outBack(x: number): number
  outElastic(x: number): number
  /** 0..1 的平滑出现：在 [a,b] 区间内从 0 到 1 */
  span(t: number, a: number, b: number): number
  /** 在 [a,b] 内 0→1→0 */
  pulse(t: number, a: number, b: number): number
}

export interface UtilFns {
  clamp(x: number, a: number, b: number): number
  lerp(a: number, b: number, x: number): number
  map(x: number, a: number, b: number, c: number, d: number): number
  /** 角度 → 弧度（util.rad(90) === Math.PI/2） */
  rad(d: number): number
  /** 弧度 → 角度（util.deg(Math.PI) === 180） */
  deg(r: number): number
  /** 伪随机（确定性） */
  rand(seed: number): number
  /** 正弦波：sin(2π(f t + phase)) */
  wave(t: number, freq: number, phase?: number): number
  /** 阻尼振荡：A e^{-λt} cos(ωt+φ) */
  damped(t: number, amp: number, omega: number, lambda: number, phase?: number): number
  /** 把秒格式化成 mm:ss */
  time(sec: number): string
}

export interface DrawKit {
  /** 清屏为纯色 */
  clear(color?: string): void
  /** 圆角矩形路径（不填充） */
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  rect(x: number, y: number, w: number, h: number, opts?: FillStroke): void
  circle(x: number, y: number, r: number, opts?: FillStroke): void
  line(x1: number, y1: number, x2: number, y2: number, opts?: StrokeOpts): void
  /** 箭头，带箭头尖 */
  arrow(x1: number, y1: number, x2: number, y2: number, opts?: ArrowOpts): void
  /** 双箭头尺寸标注 */
  dim(x1: number, y1: number, x2: number, y2: number, label?: string, opts?: ArrowOpts & { offset?: number }): void
  /** 折线/函数曲线：points 为设计坐标点列 */
  path(points: Vec[], opts?: StrokeOpts & { close?: boolean; fill?: string }): void
  /** 采样函数绘制曲线 */
  plot(fn: (x: number) => number, x0: number, x1: number, opts?: StrokeOpts & { step?: number }): void
  text(s: string, x: number, y: number, opts?: TextOpts): void
  /** 公式（轻量 TeX 子集），居中于 (x,y) */
  math(tex: string, x: number, y: number, opts?: TextOpts & { align?: 'center' | 'left' | 'right' }): void
  /** 带背景的标签 */
  chip(s: string, x: number, y: number, opts?: TextOpts & { pad?: number; bg?: string }): void
  /** 坐标系（带刻度） */
  axes(o: AxesOpts): void
  /** 矢量箭头，从原点起 */
  vector(x: number, y: number, dx: number, dy: number, opts?: ArrowOpts & { label?: string }): void
  /** 点列/散点 */
  dots(points: Vec[], r: number, color: string): void
  /** 网格背景 */
  grid(step?: number, color?: string): void
  /** 发光线条（多次描边模拟） */
  glow(points: Vec[], color: string, width?: number): void
  /** 波/振动：沿 x 轴画一条正弦波 */
  sineWave(x0: number, x1: number, y0: number, amp: number, cycles: number, phase: number, opts?: StrokeOpts): void
  /** 保存/恢复绘图状态 */
  save(): void
  restore(): void
  /** 裁剪到矩形 */
  clip(x: number, y: number, w: number, h: number, fn: () => void): void
  /** 在局部坐标系里绘制 */
  with(transform: { x?: number; y?: number; rotate?: number; scale?: number }, fn: () => void): void
  /**
   * 画一张图片（assets/ 下的相对路径）。
   * 缺省按原始尺寸居中于 (x,y)；给了 w/h 就拉伸到该尺寸。
   * fit:'cover' 时按比例铺满并裁切（用于背景板）。
   */
  image(
    name: string,
    x: number,
    y: number,
    w?: number,
    h?: number,
    opts?: { alpha?: number; fit?: 'stretch' | 'cover' | 'contain'; radius?: number; grayscale?: number }
  ): void
}

export interface FillStroke {
  fill?: string | null
  stroke?: string | null
  width?: number
  dash?: number[]
  alpha?: number
  shadow?: string
  shadowBlur?: number
}

export interface StrokeOpts {
  stroke?: string
  width?: number
  dash?: number[]
  alpha?: number
  cap?: CanvasLineCap
  shadow?: string
  shadowBlur?: number
}

export interface ArrowOpts extends StrokeOpts {
  head?: number
  fill?: string
}

export interface TextOpts {
  size?: number
  color?: string
  font?: string
  weight?: number | string
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  alpha?: number
  maxWidth?: number
  letterSpacing?: number
}

export interface AxesOpts {
  x: number
  y: number
  w: number
  h: number
  xRange?: [number, number]
  yRange?: [number, number]
  xLabel?: string
  yLabel?: string
  ticks?: number
  color?: string
  grid?: boolean
  tickSize?: number
  labelSize?: number
}

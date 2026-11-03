/** 场景数据模型：agent 写它，画布渲染它，属性面板改它。 */

export type Vec2 = { x: number; y: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type BlendMode = 'source-over' | 'lighter' | 'multiply' | 'screen' | 'overlay'

/**
 * 图层种类。缺省（undefined）= 'code'，兼容老场景：
 * 老场景每个图层就是一段 draw 代码，没有元素结构。
 *
 * - group  组合：自己通常不画东西，只把 x/y/scale/rotation 传给 children
 * - text   文本：content/size/color… 由引擎排版，可双击改字
 * - image  图片：src 指向 assets/，可拖拽改大小
 * - shape  形状：矩形/圆/线/箭头，属性面板直接改颜色和线宽
 * - code   代码：一段 Canvas 2D 代码（AI 生成的复杂画面、老场景）
 */
export type LayerKind = 'group' | 'text' | 'image' | 'shape' | 'code'

export interface TextProps {
  content: string
  /** 字号（设计坐标 px） */
  size: number
  weight?: number
  color?: string
  align?: 'left' | 'center' | 'right'
  /** 行高倍数，默认 1.35 */
  lineHeight?: number
  /** 换行宽度；缺省用图层 w */
  maxWidth?: number
  font?: string
  /** 背景色块（字幕/标题条常用），缺省无 */
  background?: string
}

export interface ImageProps {
  /** 相对草稿目录，如 assets/foo.png */
  src: string
  /** 圆角（px） */
  radius?: number
  fit?: 'stretch' | 'contain' | 'cover'
  /** 图片没加载出来时画个占位框 */
  placeholder?: string
}

export type ShapeType = 'rect' | 'ellipse' | 'line' | 'arrow' | 'triangle'

export interface ShapeProps {
  type: ShapeType
  fill?: string
  stroke?: string
  strokeWidth?: number
  /** 矩形圆角 */
  radius?: number
}

/** 图层：场景的最小可编辑单元。 */
export interface SceneLayer {
  id: string
  name: string
  /** 种类，缺省 code */
  kind?: LayerKind
  /** 该图层可见的时间区间（秒），缺省为整段 */
  start?: number
  end?: number
  /** 图层在父坐标系中的位置。typed 元素这里是包围盒左上角 */
  x?: number
  y?: number
  /** typed 元素的宽高（设计坐标） */
  w?: number
  h?: number
  /** 绕自身中心的缩放 */
  scale?: number
  /** 绕自身中心的旋转（度） */
  rotation?: number
  opacity?: number
  blend?: BlendMode
  visible?: boolean
  locked?: boolean
  /** 命中区域（设计坐标），用于点选；缺省时用像素 alpha 命中测试 */
  bounds?: Rect
  /** 绘制代码（kind=code 时必填）。签名见 engine/render.ts 中的 DrawScope */
  draw?: string
  text?: TextProps
  image?: ImageProps
  shape?: ShapeProps
  /** 组合里的元素，按数组顺序从下往上画 */
  children?: SceneLayer[]
  /** 自由备注，给 agent 和人看 */
  note?: string
}

export interface SceneTheme {
  bg: string
  fg: string
  muted: string
  accent: string
  accent2: string
  accent3: string
  grid: string
}

export interface SceneAudio {
  id: string
  name: string
  /** 相对 workspace 的路径 */
  src: string
  /** 音频在时间轴上的起点（秒） */
  start: number
  /** 音频时长（秒）；未知时按整段算 */
  dur?: number
  volume?: number
}

export interface SceneSubtitle {
  id: string
  start: number
  end: number
  text: string
}

export interface SceneMeta {
  title: string
  /** 一句话主题，agent 用来保持上下文 */
  brief?: string
  /** 视觉风格说明 */
  style?: string
}

/** 用户自己拉的参考线（设计坐标）。只影响吸附和显示，不参与渲染、不进导出。 */
export interface SceneGuides {
  /** 竖参考线的 x */
  v: number[]
  /** 横参考线的 y */
  h: number[]
}

export interface Scene {
  version: 1
  meta: SceneMeta
  canvas: { width: number; height: number; fps: number; duration: number; background?: string }
  theme: SceneTheme
  layers: SceneLayer[]
  audio: SceneAudio[]
  subtitles: SceneSubtitle[]
  guides?: SceneGuides
}

export const DEFAULT_THEME: SceneTheme = {
  bg: '#0d1117',
  fg: '#e8eef2',
  muted: '#7d8b96',
  accent: '#4fc3d9',
  accent2: '#f2b544',
  accent3: '#e06c75',
  grid: '#1b2632'
}

export function emptyScene(title = '未命名场景'): Scene {
  return {
    version: 1,
    meta: { title },
    canvas: { width: 1920, height: 1080, fps: 30, duration: 8 },
    theme: { ...DEFAULT_THEME },
    layers: [],
    audio: [],
    subtitles: []
  }
}

/** 图层的真实种类（老场景没有 kind） */
export function layerKind(layer: SceneLayer): LayerKind {
  if (layer.kind) return layer.kind
  return layer.children?.length ? 'group' : 'code'
}

export function isGroup(layer: SceneLayer): boolean {
  return layerKind(layer) === 'group' || Boolean(layer.children?.length)
}

/** typed 元素自带宽高，不需要像素扫描就能算包围盒 */
export function hasOwnBox(layer: SceneLayer): boolean {
  const k = layerKind(layer)
  return (k === 'text' || k === 'image' || k === 'shape') && Number(layer.w) > 0 && Number(layer.h) > 0
}

export const KIND_LABEL: Record<LayerKind, string> = {
  group: '组合',
  text: '文本',
  image: '图片',
  shape: '形状',
  code: '代码'
}

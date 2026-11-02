/** 场景数据模型：agent 写它，画布渲染它，属性面板改它。 */

export type Vec2 = { x: number; y: number }

export type Rect = { x: number; y: number; w: number; h: number }

export type BlendMode = 'source-over' | 'lighter' | 'multiply' | 'screen' | 'overlay'

/** 图层：场景的最小可编辑单元。draw 是一段 JS 源码，由引擎编译执行。 */
export interface SceneLayer {
  id: string
  name: string
  /** 该图层可见的时间区间（秒），缺省为整段 */
  start?: number
  end?: number
  /** 图层在画布坐标系中的平移 */
  x?: number
  y?: number
  opacity?: number
  blend?: BlendMode
  visible?: boolean
  locked?: boolean
  /** 命中区域（设计坐标），用于点选；缺省时用像素 alpha 命中测试 */
  bounds?: Rect
  /** 绘制代码。签名见 engine/compile.ts 中的 LayerScope */
  draw: string
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

export interface Scene {
  version: 1
  meta: SceneMeta
  canvas: { width: number; height: number; fps: number; duration: number; background?: string }
  theme: SceneTheme
  layers: SceneLayer[]
  audio: SceneAudio[]
  subtitles: SceneSubtitle[]
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

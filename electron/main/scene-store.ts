import { readFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { atomicWrite } from './atomic'
import { emptyScene, type Scene, type SceneLayer } from '@shared/scene'
import { demoScene } from '@shared/demo'

const SCENE_FILE = 'scene.json'

/** 场景写盘统一走这里：原子写，避免半截 JSON 把用户的场景弄没 */
export async function writeSceneFile(path: string, scene: Scene): Promise<void> {
  await atomicWrite(path, JSON.stringify(scene, null, 2))
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const KINDS = new Set(['group', 'text', 'image', 'shape', 'code'])
const SHAPES = new Set(['rect', 'ellipse', 'line', 'arrow', 'triangle'])
const MAX_DEPTH = 4
const MAX_LAYERS = 300

/** 校验并修复 agent 写入的场景，避免把非法结构送进渲染器 */
export function normalizeScene(input: unknown): Scene {
  const fallback = emptyScene()
  if (!input || typeof input !== 'object') return fallback
  const raw = input as Partial<Scene>
  const canvas = { ...fallback.canvas, ...(raw.canvas ?? {}) }
  canvas.width = clampInt(canvas.width, 320, 4096, 1920)
  canvas.height = clampInt(canvas.height, 180, 4096, 1080)
  canvas.fps = clampInt(canvas.fps, 12, 60, 30)
  canvas.duration = Math.max(0.5, Math.min(1800, Number(canvas.duration) || 8))

  const theme = { ...fallback.theme, ...(raw.theme ?? {}) }
  const seen = new Set<string>()
  const budget = { left: MAX_LAYERS }
  const layers = normalizeLayers(Array.isArray(raw.layers) ? raw.layers : [], seen, budget, 0)

  return {
    version: 1,
    meta: {
      title: typeof raw.meta?.title === 'string' ? raw.meta.title.slice(0, 120) : fallback.meta.title,
      brief: typeof raw.meta?.brief === 'string' ? raw.meta.brief.slice(0, 2000) : undefined,
      style: typeof raw.meta?.style === 'string' ? raw.meta.style.slice(0, 1000) : undefined
    },
    canvas,
    theme,
    layers,
    audio: Array.isArray(raw.audio)
      ? raw.audio
          .filter(a => a && typeof a.src === 'string')
          .slice(0, 20)
          .map(a => ({
            id: String(a.id ?? Math.random().toString(36).slice(2, 8)),
            name: String(a.name ?? a.src.split('/').pop() ?? '音频').slice(0, 120),
            src: a.src,
            start: Math.max(0, Number(a.start) || 0),
            dur: a.dur === undefined ? undefined : Math.max(0, Number(a.dur) || 0),
            volume: a.volume === undefined ? 1 : Math.max(0, Math.min(2, Number(a.volume) || 0))
          }))
      : [],
    subtitles: Array.isArray(raw.subtitles)
      ? raw.subtitles
          .filter(s => s && typeof s.text === 'string')
          .slice(0, 500)
          .map(s => ({ id: String(s.id ?? Math.random().toString(36).slice(2, 8)), start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text.slice(0, 500) }))
      : []
  }
}

function normalizeLayers(list: unknown[], seen: Set<string>, budget: { left: number }, depth: number): SceneLayer[] {
  const out: SceneLayer[] = []
  list.forEach((l, i) => {
    if (!l || typeof l !== 'object' || budget.left <= 0) return
    const layer = l as SceneLayer
    let id = typeof layer.id === 'string' && ID_RE.test(layer.id) ? layer.id : `layer_${i + 1}`
    // 重复 id 用确定性后缀修复，别用 Math.random（同一份输入应该得到同一份输出）
    if (seen.has(id)) {
      let n = 2
      while (seen.has(`${id}_${n}`)) n++
      id = `${id}_${n}`
    }
    seen.add(id)
    budget.left -= 1

    const kind = typeof layer.kind === 'string' && KINDS.has(layer.kind) ? layer.kind : undefined
    const kids = Array.isArray(layer.children) && depth < MAX_DEPTH
      ? normalizeLayers(layer.children, seen, budget, depth + 1)
      : []

    const normalized: SceneLayer = {
      id,
      name: typeof layer.name === 'string' && layer.name.trim() ? layer.name.trim().slice(0, 80) : `图层 ${i + 1}`,
      start: typeof layer.start === 'number' ? Math.max(0, layer.start) : undefined,
      end: typeof layer.end === 'number' ? Math.max(0, layer.end) : undefined,
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      w: layer.w === undefined ? undefined : Math.max(0, Number(layer.w) || 0),
      h: layer.h === undefined ? undefined : Math.max(0, Number(layer.h) || 0),
      scale: layer.scale === undefined ? 1 : clampNum(layer.scale, 0.01, 100, 1),
      rotation: layer.rotation === undefined ? 0 : clampNum(layer.rotation, -3600, 3600, 0),
      opacity: layer.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(layer.opacity))),
      blend: layer.blend ?? 'source-over',
      visible: layer.visible !== false,
      locked: layer.locked === true,
      bounds: layer.bounds,
      draw: typeof layer.draw === 'string' ? layer.draw.slice(0, 200_000) : '',
      note: typeof layer.note === 'string' ? layer.note.slice(0, 500) : undefined
    }
    if (kind) normalized.kind = kind
    if (normalized.scale === 1) delete normalized.scale
    if (normalized.rotation === 0) delete normalized.rotation

    if (layer.text && typeof layer.text === 'object') {
      const t = layer.text
      normalized.text = {
        content: typeof t.content === 'string' ? t.content.slice(0, 4000) : '',
        size: clampNum(t.size, 4, 400, 48),
        weight: t.weight === undefined ? undefined : clampNum(t.weight, 100, 900, 600),
        color: typeof t.color === 'string' ? t.color.slice(0, 40) : undefined,
        align: t.align === 'center' || t.align === 'right' ? t.align : 'left',
        lineHeight: t.lineHeight === undefined ? undefined : clampNum(t.lineHeight, 0.8, 3, 1.35),
        maxWidth: t.maxWidth === undefined ? undefined : Math.max(16, Number(t.maxWidth) || 16),
        font: typeof t.font === 'string' ? t.font.slice(0, 200) : undefined,
        background: typeof t.background === 'string' ? t.background.slice(0, 40) : undefined
      }
    }
    if (layer.image && typeof layer.image === 'object' && typeof layer.image.src === 'string') {
      const im = layer.image
      normalized.image = {
        src: im.src.slice(0, 500),
        radius: im.radius === undefined ? undefined : Math.max(0, Number(im.radius) || 0),
        fit: im.fit === 'contain' || im.fit === 'cover' ? im.fit : 'stretch',
        placeholder: typeof im.placeholder === 'string' ? im.placeholder.slice(0, 40) : undefined
      }
    }
    if (layer.shape && typeof layer.shape === 'object') {
      const sh = layer.shape
      normalized.shape = {
        type: typeof sh.type === 'string' && SHAPES.has(sh.type) ? sh.type : 'rect',
        fill: typeof sh.fill === 'string' ? sh.fill.slice(0, 40) : undefined,
        stroke: typeof sh.stroke === 'string' ? sh.stroke.slice(0, 40) : undefined,
        strokeWidth: sh.strokeWidth === undefined ? undefined : Math.max(0, Math.min(80, Number(sh.strokeWidth) || 0)),
        radius: sh.radius === undefined ? undefined : Math.max(0, Number(sh.radius) || 0)
      }
    }
    if (kids.length) normalized.children = kids
    out.push(normalized)
  })
  return out
}

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, n))
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, n))
}

/**
 * 写入前把「被自动修掉 / 被丢掉」的地方挑出来，让 agent 知道自己的 JSON 哪里不对。
 * 真实模型十有八九第一次会写错点什么，静默修正会让它反复犯同一个错。
 */
export function auditSceneInput(input: unknown): string[] {
  const warn: string[] = []
  if (!input || typeof input !== 'object') return ['整个 scene 不是对象']
  const raw = input as Record<string, unknown>
  const layers = Array.isArray(raw.layers) ? raw.layers : null
  if (!layers) {
    warn.push('缺少 layers 数组，场景会是空的')
    return warn
  }
  if (layers.length === 0) warn.push('layers 是空数组')
  if (layers.length > 40) warn.push(`顶层有 ${layers.length} 层，超过 40 层上限，多余的被丢弃`)

  const seen = new Set<string>()
  auditLayers(layers, warn, seen, '', 0)

  const canvas = raw.canvas as Record<string, unknown> | undefined
  if (canvas && typeof canvas === 'object') {
    const w = Number(canvas.width), h = Number(canvas.height)
    // 整个产品（导出、缩略图、选区坐标）都按 1920×1080 设计，别让模型改画布尺寸
    if (Number.isFinite(w) && w !== 1920) {
      warn.push(`画布宽度 ${w} 已强制改成 1920（本产品只用 1920×1080 设计坐标，改尺寸会让所有图层错位）`)
      canvas.width = 1920
    }
    if (Number.isFinite(h) && h !== 1080) {
      warn.push(`画布高度 ${h} 已强制改成 1080（本产品只用 1920×1080 设计坐标）`)
      canvas.height = 1080
    }
  }
  if (raw.subtitles !== undefined && !Array.isArray(raw.subtitles)) warn.push('subtitles 不是数组，已忽略')
  if (raw.audio !== undefined && !Array.isArray(raw.audio)) warn.push('audio 不是数组，已忽略')
  return warn
}

function auditLayers(list: unknown[], warn: string[], seen: Set<string>, prefix: string, depth: number): void {
  list.forEach((l, i) => {
    const at = `${prefix}第 ${i + 1} 层`
    if (!l || typeof l !== 'object') { warn.push(`${at} 不是对象，已跳过`); return }
    const layer = l as Record<string, unknown>
    const name = typeof layer.name === 'string' ? layer.name : `layer_${i + 1}`
    if (typeof layer.id !== 'string' || !ID_RE.test(layer.id)) {
      warn.push(`${at}（${name}）的 id 缺失或不合规（只允许字母数字 _ -，且以字母数字开头），已自动改名`)
    } else if (seen.has(layer.id)) {
      warn.push(`${at}（${name}）的 id "${layer.id}" 与前面重复，已自动改名`)
    } else {
      seen.add(layer.id)
    }

    const kids = Array.isArray(layer.children) ? layer.children : null
    const kind = typeof layer.kind === 'string' && KINDS.has(layer.kind) ? layer.kind : (kids?.length ? 'group' : 'code')
    if (kind === 'group') {
      if (!kids?.length) warn.push(`${at}（${name}）是组合但没有 children，什么都不会显示`)
      else if (depth >= MAX_DEPTH) warn.push(`${at}（${name}）嵌套超过 ${MAX_DEPTH} 层，更深的子元素被丢弃`)
      else auditLayers(kids, warn, seen, `${prefix}${name} > `, depth + 1)
      return
    }
    if (kind === 'text') {
      const text = layer.text as Record<string, unknown> | undefined
      if (!text || typeof text.content !== 'string' || !text.content.trim()) warn.push(`${at}（${name}）是文本但 text.content 为空，什么都看不到`)
      if (!(Number(layer.w) > 0) || !(Number(layer.h) > 0)) warn.push(`${at}（${name}）缺少 w/h，文本无法排版（建议给 w 和 h）`)
      return
    }
    if (kind === 'image') {
      const image = layer.image as Record<string, unknown> | undefined
      if (!image || typeof image.src !== 'string') warn.push(`${at}（${name}）是图片但缺少 image.src`)
      if (!(Number(layer.w) > 0) || !(Number(layer.h) > 0)) warn.push(`${at}（${name}）缺少 w/h，图片尺寸会是 0`)
      return
    }
    if (kind === 'shape') {
      const shape = layer.shape as Record<string, unknown> | undefined
      if (!shape || !SHAPES.has(String(shape.type))) warn.push(`${at}（${name}）是形状但 shape.type 不是 rect/ellipse/line/arrow/triangle`)
      if (!(Number(layer.w) > 0) || !(Number(layer.h) > 0)) warn.push(`${at}（${name}）缺少 w/h，形状尺寸会是 0`)
      return
    }

    if (typeof layer.draw !== 'string') {
      warn.push(`${at}（${name}）没有 draw 字符串，这一层将是空白`)
    } else if (!layer.draw.trim()) {
      warn.push(`${at}（${name}）的 draw 是空字符串，这一层将是空白`)
    } else {
      const d = layer.draw
      if (/^\s*(async\s+)?function\b/.test(d)) warn.push(`${at}（${name}）的 draw 写成了 function 声明，应该只写函数体`)
      if (/^\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(d)) warn.push(`${at}（${name}）的 draw 写成了箭头函数，应该只写函数体`)
      if (/\breturn\b/.test(d)) warn.push(`${at}（${name}）的 draw 里出现了 return，函数体不应 return`)
      if (/\b(window|document|localStorage|fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame|Date\.now|Math\.random)\b/.test(d)) {
        warn.push(`${at}（${name}）用了被禁用的全局（window/document/fetch/定时器/Math.random 等），画面必须只依赖 t`)
      }
      if (/\bthree\s*\./.test(d) && !/\bthree\s*\.\s*render\s*\(/.test(d)) {
        warn.push(`${at}（${name}）用了 three.* 但没有调用 three.render(s)，这一层什么都不会显示`)
      }
    }
    if (layer.start !== undefined && layer.end !== undefined) {
      const s = Number(layer.start), e = Number(layer.end)
      if (Number.isFinite(s) && Number.isFinite(e) && e <= s) warn.push(`${at}（${name}）的 end(${e}) 不大于 start(${s})，这层永远不显示`)
    }
  })
}

export class SceneStore {
  readonly workspace: string
  readonly scenePath: string
  private watcher: FSWatcher | null = null
  private cache: Scene | null = null
  private cacheMtime = 0
  private onExternalChange: ((scene: Scene) => void) | null = null

  constructor(workspace: string, private readonly instructionsSource?: string) {
    this.workspace = workspace
    this.scenePath = join(workspace, SCENE_FILE)
  }

  async init(): Promise<void> {
    await mkdir(this.workspace, { recursive: true })
    await mkdir(join(this.workspace, 'assets'), { recursive: true })
    await mkdir(join(this.workspace, 'previews'), { recursive: true })
    // 把引擎说明写进工作区，agent 每次会话自动读取
    if (this.instructionsSource && existsSync(this.instructionsSource)) {
      const target = join(this.workspace, 'AGENTS.md')
      const source = await readFile(this.instructionsSource, 'utf8')
      const current = existsSync(target) ? await readFile(target, 'utf8') : ''
      if (current !== source) await atomicWrite(target, source)
    }
    if (!existsSync(this.scenePath)) {
      const scene = demoScene()
      await writeSceneFile(this.scenePath, scene)
    }
    this.startWatch()
  }

  private startWatch(): void {
    try {
      this.watcher = watch(this.workspace, { persistent: false }, (_event, filename) => {
        if (filename && filename !== SCENE_FILE) return
        void this.emitExternal()
      })
    } catch { /* 某些文件系统不支持 watch，忽略 */ }
  }

  setExternalChangeHandler(fn: (scene: Scene) => void): void {
    this.onExternalChange = fn
  }

  /** 切草稿时用：停掉旧目录的 watch，别把旧草稿的改动推给新草稿 */
  dispose(): void {
    try { this.watcher?.close() } catch { /* ignore */ }
    this.watcher = null
    this.onExternalChange = null
    this.cache = null
    this.cacheMtime = 0
  }

  private async emitExternal(): Promise<void> {
    try {
      const s = await stat(this.scenePath)
      if (s.mtimeMs === this.cacheMtime) return
      const scene = await this.read()
      this.onExternalChange?.(scene)
    } catch { /* ignore */ }
  }

  invalidate(): void { this.cacheMtime = 0 }

  async read(): Promise<Scene> {
    try {
      const s = await stat(this.scenePath)
      if (this.cache && s.mtimeMs === this.cacheMtime) return this.cache
      const raw = await readFile(this.scenePath, 'utf8')
      const scene = normalizeScene(JSON.parse(raw))
      this.cache = scene
      this.cacheMtime = s.mtimeMs
      return scene
    } catch {
      return emptyScene()
    }
  }

  async write(scene: Scene): Promise<void> {
    const normalized = normalizeScene(scene)
    await writeSceneFile(this.scenePath, normalized)
    const s = await stat(this.scenePath)
    this.cache = normalized
    this.cacheMtime = s.mtimeMs
  }

  async listAssets(): Promise<{ name: string; path: string; size: number }[]> {
    const dir = join(this.workspace, 'assets')
    await mkdir(dir, { recursive: true })
    const out: { name: string; path: string; size: number }[] = []
    for (const f of await readdir(dir)) {
      const full = join(dir, f)
      const st = await stat(full).catch(() => null)
      if (st?.isFile()) out.push({ name: f, path: `assets/${f}`, size: st.size })
    }
    return out
  }
}

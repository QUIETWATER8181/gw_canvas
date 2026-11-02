import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { emptyScene, type Scene, type SceneLayer } from '@shared/scene'
import { demoScene } from '@shared/demo'

const SCENE_FILE = 'scene.json'

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

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
  const layers: SceneLayer[] = []
  for (const [i, l] of (Array.isArray(raw.layers) ? raw.layers : []).entries()) {
    if (!l || typeof l !== 'object') continue
    const layer = l as SceneLayer
    let id = typeof layer.id === 'string' && ID_RE.test(layer.id) ? layer.id : `layer_${i + 1}`
    // 重复 id 用确定性后缀修复，别用 Math.random（同一份输入应该得到同一份输出）
    if (seen.has(id)) {
      let n = 2
      while (seen.has(`${id}_${n}`)) n++
      id = `${id}_${n}`
    }
    seen.add(id)
    layers.push({
      id,
      name: typeof layer.name === 'string' && layer.name.trim() ? layer.name.trim().slice(0, 80) : `图层 ${i + 1}`,
      start: typeof layer.start === 'number' ? Math.max(0, layer.start) : undefined,
      end: typeof layer.end === 'number' ? Math.max(0, layer.end) : undefined,
      x: Number(layer.x) || 0,
      y: Number(layer.y) || 0,
      opacity: layer.opacity === undefined ? 1 : Math.max(0, Math.min(1, Number(layer.opacity))),
      blend: layer.blend ?? 'source-over',
      visible: layer.visible !== false,
      locked: layer.locked === true,
      bounds: layer.bounds,
      draw: typeof layer.draw === 'string' ? layer.draw.slice(0, 200_000) : '',
      note: typeof layer.note === 'string' ? layer.note.slice(0, 500) : undefined
    })
  }

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
    audio: Array.isArray(raw.audio) ? raw.audio.filter(a => a && typeof a.src === 'string').slice(0, 20) : [],
    subtitles: Array.isArray(raw.subtitles)
      ? raw.subtitles
          .filter(s => s && typeof s.text === 'string')
          .slice(0, 500)
          .map(s => ({ id: String(s.id ?? Math.random().toString(36).slice(2, 8)), start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text.slice(0, 500) }))
      : []
  }
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
  if (layers.length > 40) warn.push(`layers 有 ${layers.length} 层，超过 40 层上限，多余的被丢弃`)

  const seen = new Set<string>()
  layers.forEach((l, i) => {
    const at = `第 ${i + 1} 层`
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
    }
    if (layer.start !== undefined && layer.end !== undefined) {
      const s = Number(layer.start), e = Number(layer.end)
      if (Number.isFinite(s) && Number.isFinite(e) && e <= s) warn.push(`${at}（${name}）的 end(${e}) 不大于 start(${s})，这层永远不显示`)
    }
  })

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
      if (current !== source) await writeFile(target, source, 'utf8')
    }
    if (!existsSync(this.scenePath)) {
      const scene = demoScene()
      await writeFile(this.scenePath, JSON.stringify(scene, null, 2), 'utf8')
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
    await writeFile(this.scenePath, JSON.stringify(normalized, null, 2), 'utf8')
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

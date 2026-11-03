import { readFile, mkdir, readdir, stat, rename, rm, cp } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { atomicWrite, atomicWriteSync } from './atomic'
import { demoScene } from '@shared/demo'
import { emptyScene, type Scene } from '@shared/scene'
import type { ChatMessage, DraftSummary } from '@shared/ipc'

/**
 * 草稿（= 一个自包含的工作区）
 *
 * 目录布局（照抄剪映「草稿箱」和达芬奇「项目管理器」的思路：
 * 每个项目自己带素材、预览图、导出，不共享、不互相污染）：
 *
 *   %APPDATA%/gewu-video/
 *   ├── drafts.json              # 只存「上次打开的是哪个」
 *   ├── drafts/
 *   │   ├── d-xxxx/
 *   │   │   ├── draft.json       # 名字 / 时间 / 置顶
 *   │   │   ├── chat.json        # 这个草稿的对话记录
 *   │   │   ├── scene.json
 *   │   │   ├── AGENTS.md
 *   │   │   ├── assets/ previews/ exports/
 *   │   └── d-yyyy/
 *   └── trash/                   # 删除的草稿挪进来（可手工找回）
 *
 * 老版本只有一个 workspace/，首次启动会整体挪成第一个草稿，
 * 所以升级不会丢东西。
 */

export interface DraftMeta {
  version: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  /** 最后一次打开的时间，0 = 从没打开过 */
  openedAt: number
}

const DRAFT_FILE = 'draft.json'
const CHAT_FILE = 'chat.json'
const SCENE_FILE = 'scene.json'
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_CHAT = 240

interface DraftIndex {
  version: 1
  activeId: string | null
}

function nowId(): string {
  // 时间戳 base36 + 2 位随机：目录名短、可排序、不会撞
  return `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`
}

function safeName(input: string): string {
  return input.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export class DraftStore {
  readonly root: string
  readonly draftsDir: string
  private readonly trashDir: string
  private readonly indexFile: string
  private index: DraftIndex = { version: 1, activeId: null }
  /** 每个草稿的对话缓存（切草稿时不丢还没落盘的消息） */
  private chatCache = new Map<string, ChatMessage[]>()
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 当前草稿名字的同步缓存（stateOf / prompt 上下文要同步拿） */
  private activeNameCache = ''
  /** 旧版单工作区目录 */
  private readonly legacyWorkspace: string

  constructor(userDataDir: string) {
    this.root = userDataDir
    this.draftsDir = join(userDataDir, 'drafts')
    this.trashDir = join(userDataDir, 'trash')
    this.indexFile = join(userDataDir, 'drafts.json')
    this.legacyWorkspace = join(userDataDir, 'workspace')
  }

  async init(): Promise<void> {
    await mkdir(this.draftsDir, { recursive: true })
    await mkdir(this.trashDir, { recursive: true })
    await this.loadIndex()
    await this.migrateLegacyWorkspace()
    const ids = await this.ids()
    if (!this.index.activeId || !ids.includes(this.index.activeId)) {
      this.index.activeId = ids[0] ?? (await this.create('我的第一个草稿', 'demo')).id
      await this.saveIndex()
    }
    const meta = await this.readMeta(join(this.draftsDir, this.index.activeId))
    this.activeNameCache = meta?.name ?? '未命名草稿'
    // 被打开过的草稿排前面，但别改 openedAt（只有真正切换才算打开）
  }

  private async loadIndex(): Promise<void> {
    try {
      const raw = await readFile(this.indexFile, 'utf8')
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as DraftIndex
      if (parsed?.version === 1) this.index = { version: 1, activeId: parsed.activeId ?? null }
    } catch { /* 没有索引文件 = 第一次启动 */ }
  }

  private async saveIndex(): Promise<void> {
    await atomicWrite(this.indexFile, JSON.stringify(this.index, null, 2))
  }

  /**
   * 老版本把场景放在 workspace/。整体 rename 成 drafts/<id>/，
   * 同一块盘上是瞬时的，不复制、不丢时间戳。
   */
  private async migrateLegacyWorkspace(): Promise<void> {
    if (!existsSync(this.legacyWorkspace)) return
    if (!existsSync(join(this.legacyWorkspace, SCENE_FILE))) return
    const id = nowId()
    const target = join(this.draftsDir, id)
    try {
      await rename(this.legacyWorkspace, target)
    } catch {
      // 跨盘/被占用时退回复制
      try {
        await cp(this.legacyWorkspace, target, { recursive: true })
        await rm(this.legacyWorkspace, { recursive: true, force: true })
      } catch {
        return // 迁移失败就继续用旧目录，下次启动再试
      }
    }
    const scene = await this.readSceneOf(target)
    const meta: DraftMeta = {
      version: 1,
      id,
      name: safeName(scene?.meta?.title ?? '') || '我的第一个草稿',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: true,
      openedAt: Date.now()
    }
    await this.writeMeta(target, meta)
    this.index.activeId = id
    this.activeNameCache = meta.name
    await this.saveIndex()
  }

  private async readSceneOf(dir: string): Promise<Scene | null> {
    try {
      return JSON.parse(await readFile(join(dir, SCENE_FILE), 'utf8')) as Scene
    } catch {
      return null
    }
  }

  private async writeMeta(dir: string, meta: DraftMeta): Promise<void> {
    await atomicWrite(join(dir, DRAFT_FILE), JSON.stringify(meta, null, 2))
  }

  private async readMeta(dir: string): Promise<DraftMeta | null> {
    try {
      const raw = JSON.parse(await readFile(join(dir, DRAFT_FILE), 'utf8')) as DraftMeta
      if (!raw || typeof raw.id !== 'string') return null
      return {
        version: 1,
        id: raw.id,
        name: safeName(raw.name ?? '') || '未命名草稿',
        createdAt: Number(raw.createdAt) || 0,
        updatedAt: Number(raw.updatedAt) || 0,
        pinned: raw.pinned === true,
        openedAt: Number(raw.openedAt) || 0
      }
    } catch {
      return null
    }
  }

  /** 磁盘上真实存在的草稿 id（忽略非法名和隐藏目录） */
  private async ids(): Promise<string[]> {
    let entries: string[] = []
    try {
      entries = await readdir(this.draftsDir)
    } catch {
      return []
    }
    const out: string[] = []
    for (const name of entries) {
      if (!ID_RE.test(name)) continue
      const st = await stat(join(this.draftsDir, name)).catch(() => null)
      if (st?.isDirectory()) out.push(name)
    }
    return out
  }

  get activeId(): string {
    return this.index.activeId ?? ''
  }

  /** 当前草稿名（同步，给状态栏和 prompt 上下文用） */
  get activeName(): string {
    return this.activeNameCache
  }

  activeDir(): string {
    return join(this.draftsDir, this.activeId)
  }

  scenePath(): string {
    return join(this.activeDir(), SCENE_FILE)
  }

  dirOf(id: string): string | null {
    return ID_RE.test(id) ? join(this.draftsDir, id) : null
  }

  async summaryOf(id: string): Promise<DraftSummary | null> {
    if (!ID_RE.test(id)) return null
    const dir = join(this.draftsDir, id)
    const st = await stat(dir).catch(() => null)
    if (!st?.isDirectory()) return null

    const meta = (await this.readMeta(dir)) ?? {
      version: 1 as const, id, name: '未命名草稿', createdAt: st.birthtimeMs || st.mtimeMs,
      updatedAt: st.mtimeMs, pinned: false, openedAt: 0
    }
    const scene = await this.readSceneOf(dir)
    const sceneMtime = await stat(join(dir, SCENE_FILE)).then(s => s.mtimeMs).catch(() => 0)
    const assets = await readdir(join(dir, 'assets')).catch(() => [] as string[])
    const exports_ = await readdir(join(dir, 'exports')).catch(() => [] as string[])
    const coverSt = await stat(join(dir, 'previews', 'cover.png')).catch(() => null)

    return {
      id,
      name: meta.name,
      title: typeof scene?.meta?.title === 'string' && scene.meta.title.trim() ? scene.meta.title.trim() : meta.name,
      createdAt: meta.createdAt || st.birthtimeMs || st.mtimeMs,
      updatedAt: Math.max(meta.updatedAt, sceneMtime || st.mtimeMs),
      openedAt: meta.openedAt,
      durationSec: Number(scene?.canvas?.duration) || 0,
      layerCount: Array.isArray(scene?.layers) ? scene.layers.length : 0,
      assetCount: assets.filter(f => !f.startsWith('.')).length,
      exportCount: exports_.filter(f => /\.mp4$/i.test(f)).length,
      coverUrl: coverSt ? `gewu://draft/${id}/previews/cover.png?v=${Math.round(coverSt.mtimeMs)}` : null,
      pinned: meta.pinned,
      active: id === this.activeId,
      dir
    }
  }

  /** 置顶在前，其余按「最后修改」倒序 */
  async list(): Promise<DraftSummary[]> {
    const ids = await this.ids()
    const all = (await Promise.all(ids.map(id => this.summaryOf(id)))).filter((x): x is DraftSummary => !!x)
    all.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
    return all
  }

  async create(name?: string, template: 'blank' | 'demo' = 'demo'): Promise<DraftSummary> {
    const id = nowId()
    const dir = join(this.draftsDir, id)
    await mkdir(dir, { recursive: true })
    const clean = safeName(name ?? '') || (await this.nextDefaultName())
    const scene = template === 'demo' ? demoScene() : { ...emptyScene(), meta: { title: clean } }
    scene.meta.title = clean
    await atomicWrite(join(dir, SCENE_FILE), JSON.stringify(scene, null, 2))
    const t = Date.now()
    await this.writeMeta(dir, { version: 1, id, name: clean, createdAt: t, updatedAt: t, pinned: false, openedAt: 0 })
    const summary = await this.summaryOf(id)
    return summary!
  }

  private async nextDefaultName(): Promise<string> {
    const list = await this.list()
    const used = new Set(list.map(d => d.name))
    let i = 1
    while (used.has(`未命名草稿 ${i}`)) i++
    return `未命名草稿 ${i}`
  }

  /** 复制草稿：素材、场景、封面都带上；导出视频不带（太占地方） */
  async duplicate(id: string): Promise<DraftSummary> {
    const srcDir = this.dirOf(id)
    if (!srcDir) throw new Error('草稿 id 不合法')
    if (!existsSync(srcDir)) throw new Error('草稿不存在')
    const newId = nowId()
    const dstDir = join(this.draftsDir, newId)
    await cp(srcDir, dstDir, {
      recursive: true,
      // 导出视频不带（一个 mp4 几十 MB，复制草稿不该等它）
      filter: src => !src.replace(/\\/g, '/').includes('/exports')
    })
    const src = await this.readMeta(srcDir)
    const t = Date.now()
    await this.writeMeta(dstDir, {
      version: 1,
      id: newId,
      name: safeName(`${src?.name ?? '草稿'} 副本`),
      createdAt: t,
      updatedAt: t,
      pinned: false,
      openedAt: 0
    })
    // 副本里的 scene 标题也改一下，否则草稿库里两张卡片看起来一模一样
    const scene = await this.readSceneOf(dstDir)
    if (scene) {
      scene.meta.title = safeName(`${scene.meta.title || src?.name || '草稿'} 副本`)
      await atomicWrite(join(dstDir, SCENE_FILE), JSON.stringify(scene, null, 2))
    }
    return (await this.summaryOf(newId))!
  }

  async rename(id: string, name: string): Promise<void> {
    const dir = this.dirOf(id)
    if (!dir) throw new Error('草稿 id 不合法')
    const meta = await this.readMeta(dir)
    if (!meta) throw new Error('草稿不存在')
    const clean = safeName(name)
    if (!clean) throw new Error('名字不能是空的')
    meta.name = clean
    meta.updatedAt = Date.now()
    await this.writeMeta(dir, meta)
    if (id === this.activeId) this.activeNameCache = clean
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    const dir = this.dirOf(id)
    if (!dir) throw new Error('草稿 id 不合法')
    const meta = await this.readMeta(dir)
    if (!meta) throw new Error('草稿不存在')
    meta.pinned = pinned
    await this.writeMeta(dir, meta)
  }

  /**
   * 删除 = 挪进 trash/，不真删。
   * 误删还能去 %APPDATA%/gewu-video/trash/ 里翻回来。
   */
  async remove(id: string): Promise<void> {
    if (id === this.activeId) throw new Error('不能删除正在打开的草稿，先切到别的草稿')
    const dir = this.dirOf(id)
    if (!dir) throw new Error('草稿 id 不合法')
    if (!existsSync(dir)) throw new Error('草稿不存在')
    await rename(dir, join(this.trashDir, `${id}-${Date.now().toString(36)}`))
  }

  /** 切换当前草稿（只改索引；场景/agent 由调用方负责） */
  async open(id: string): Promise<DraftSummary> {
    const dir = this.dirOf(id)
    if (!dir || !existsSync(dir)) throw new Error('草稿不存在')
    const meta = await this.readMeta(dir)
    if (meta) {
      meta.openedAt = Date.now()
      await this.writeMeta(dir, meta)
      this.activeNameCache = meta.name
    }
    this.index.activeId = id
    await this.saveIndex()
    return (await this.summaryOf(id))!
  }

  // ---------- 每个草稿各自的对话记录 ----------

  /** 同步读一次并缓存：recordChat 是同步接口，不能等 await */
  private loadChat(id: string): ChatMessage[] {
    const cached = this.chatCache.get(id)
    if (cached) return cached
    const dir = this.dirOf(id)
    let messages: ChatMessage[] = []
    if (dir) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, CHAT_FILE), 'utf8')) as { messages?: ChatMessage[] }
        if (Array.isArray(raw?.messages)) messages = raw.messages.filter(m => m && typeof m.text === 'string')
      } catch { /* 没有对话文件 = 新草稿 */ }
    }
    this.chatCache.set(id, messages)
    return messages
  }

  async readChat(id = this.activeId): Promise<ChatMessage[]> {
    if (!id) return []
    return this.loadChat(id)
  }

  /** 收一条对话：同 id 覆盖（流式分片就是这么来的），上限 MAX_CHAT 条 */
  recordChat(msg: ChatMessage): void {
    const id = this.activeId
    if (!id) return
    const list = this.loadChat(id)
    const at = list.findIndex(m => m.id === msg.id)
    if (at >= 0) list[at] = msg
    else list.push(msg)
    if (list.length > MAX_CHAT) list.splice(0, list.length - MAX_CHAT)
    this.scheduleFlush(id)
  }

  async clearChat(): Promise<void> {
    const id = this.activeId
    if (!id) return
    this.chatCache.set(id, [])
    const dir = this.dirOf(id)
    if (!dir) return
    await atomicWrite(join(dir, CHAT_FILE), JSON.stringify({ messages: [] })).catch(() => undefined)
  }

  private scheduleFlush(id: string): void {
    const running = this.flushTimers.get(id)
    if (running) clearTimeout(running)
    this.flushTimers.set(id, setTimeout(() => { this.flushChat(id) }, 800))
  }

  /** 同步写：退出/切草稿时不能等异步 */
  flushChat(id = this.activeId): void {
    const timer = this.flushTimers.get(id)
    if (timer) { clearTimeout(timer); this.flushTimers.delete(id) }
    const list = this.chatCache.get(id)
    const dir = this.dirOf(id)
    if (!list || !dir) return
    try {
      atomicWriteSync(join(dir, CHAT_FILE), JSON.stringify({ messages: list }, null, 1))
    } catch { /* 磁盘满/权限问题不该拖垮对话 */ }
  }

  flushAll(): void {
    for (const id of this.chatCache.keys()) this.flushChat(id)
  }

  /** 给场景文件补一个默认标题（新建空白草稿时用） */
  async ensureSceneTitle(id: string, title: string): Promise<void> {
    const dir = this.dirOf(id)
    if (!dir) return
    const scene = await this.readSceneOf(dir)
    if (!scene || (scene.meta?.title ?? '').trim()) return
    scene.meta = { ...scene.meta, title }
    await atomicWrite(join(dir, SCENE_FILE), JSON.stringify(scene, null, 2))
  }

  /** 草稿目录名（给「在文件夹中显示」用） */
  folderName(id: string): string {
    return basename(this.dirOf(id) ?? id)
  }
}

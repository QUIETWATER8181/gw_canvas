import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { safeStorage, app } from 'electron'
import { atomicWrite, atomicWriteSync } from './atomic'
import type { ModelConnection, ProviderKind } from '@shared/ipc'

interface StoredConnection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  /** base64 加密后的密钥 */
  key?: string
  contextWindow?: number
}

export interface StoredExportSettings {
  /** 固定导出目录；null = 用最近目录 / 系统视频目录 */
  dir: string | null
  /** 每次导出都弹位置选择框 */
  askEveryTime: boolean
  /** 导出完成后在资源管理器里定位 */
  revealAfterExport: boolean
  /** 最近用过的目录，最近的在前 */
  recentDirs: string[]
}

const DEFAULT_EXPORT: StoredExportSettings = {
  dir: null,
  askEveryTime: true,
  revealAfterExport: true,
  recentDirs: []
}

interface ConfigFile {
  version: 1
  connections: StoredConnection[]
  activeConnectionId: string | null
  /**
   * 专门用来「看图」的连接（多模态模型）。
   * null = 跟着 activeConnectionId 走，适合只有一个多模态接口的情况。
   */
  visionConnectionId?: string | null
  lastScenePath?: string
  /** 导出位置偏好 */
  exportSettings?: StoredExportSettings
}

const DEFAULT_CONFIG: ConfigFile = { version: 1, connections: [], activeConnectionId: null }

export class ConfigStore {
  private data: ConfigFile = { ...DEFAULT_CONFIG }

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      if (!existsSync(this.file)) return
      const raw = await readFile(this.file, 'utf8')
      // 记事本/部分编辑器会写 UTF-8 BOM，JSON.parse 见到就抛，配置会静默变空
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as ConfigFile
      if (parsed?.version === 1) this.data = { ...DEFAULT_CONFIG, ...parsed }
    } catch (error) {
      // 别静默吞掉：留一份坏文件副本，下次能查为什么「配置没了」
      try {
        const { copyFile } = await import('node:fs/promises')
        await copyFile(this.file, `${this.file}.bad-${Date.now().toString(36)}`)
      } catch { /* ignore */ }
      console.error('config.json 读不出来，已用空配置启动：' + (error instanceof Error ? error.message : String(error)))
      this.data = { ...DEFAULT_CONFIG }
    }
  }

  /**
   * 保存串行化：同一个文件上并发 writeFile 会互相踩（哪怕各自先写临时文件，
   * rename 的先后也会让「后发起的旧内容」盖掉「先发起的新内容」）。
   * 这里用一个 promise 链保证按调用顺序落盘。
   */
  private saving: Promise<void> = Promise.resolve()

  private save(): Promise<void> {
    this.saving = this.saving
      .then(() => atomicWrite(this.file, JSON.stringify(this.data, null, 2)))
      .catch(error => { console.error('config.json 保存失败：' + (error instanceof Error ? error.message : String(error))) })
    return this.saving
  }

  /** 退出前兜底：把最后一次改动同步落盘，别丢在 promise 链里 */
  flushSync(): void {
    try {
      atomicWriteSync(this.file, JSON.stringify(this.data, null, 2))
    } catch { /* ignore */ }
  }

  private encrypt(plain: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return `enc:${safeStorage.encryptString(plain).toString('base64')}`
      }
    } catch { /* fall through */ }
    return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
  }

  private decrypt(stored: string | undefined): string | null {
    if (!stored) return null
    try {
      if (stored.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      }
      if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    } catch { /* ignore */ }
    return null
  }

  list(): ModelConnection[] {
    return this.data.connections.map(c => ({
      id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, model: c.model,
      hasKey: Boolean(c.key), contextWindow: c.contextWindow
    }))
  }

  getActiveId(): string | null {
    return this.data.activeConnectionId
  }

  setActive(id: string): void {
    if (!this.data.connections.some(c => c.id === id)) throw new Error('连接不存在')
    this.data.activeConnectionId = id
    void this.save()
  }

  upsert(input: { id?: string; name: string; kind: ProviderKind; baseUrl: string; model: string; apiKey?: string }): ModelConnection {
    const baseUrl = input.baseUrl.replace(/\/+$/, '')
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('接口地址必须以 http:// 或 https:// 开头')
    let conn = input.id ? this.data.connections.find(c => c.id === input.id) : undefined
    if (!conn) {
      conn = {
        id: `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: input.name,
        kind: input.kind,
        baseUrl,
        model: input.model
      }
      this.data.connections.push(conn)
    }
    conn.name = input.name
    conn.kind = input.kind
    conn.baseUrl = baseUrl
    conn.model = input.model
    if (input.apiKey) conn.key = this.encrypt(input.apiKey.trim())
    if (!this.data.activeConnectionId) this.data.activeConnectionId = conn.id
    void this.save()
    return { id: conn.id, name: conn.name, kind: conn.kind, baseUrl: conn.baseUrl, model: conn.model, hasKey: Boolean(conn.key) }
  }

  remove(id: string): void {
    this.data.connections = this.data.connections.filter(c => c.id !== id)
    if (this.data.activeConnectionId === id) this.data.activeConnectionId = this.data.connections[0]?.id ?? null
    // 删掉的正好是视觉模型，就退回「跟随当前对话连接」，别留一个悬空 id
    if (this.data.visionConnectionId === id) this.data.visionConnectionId = null
    void this.save()
  }

  getSecret(id: string): string | null {
    const c = this.data.connections.find(x => x.id === id)
    return c ? this.decrypt(c.key) : null
  }

  getActiveConnectionSecret(): { id: string; name: string; kind: ProviderKind; baseUrl: string; model: string; apiKey: string } | null {
    const id = this.data.activeConnectionId
    if (!id) return null
    const c = this.data.connections.find(x => x.id === id)
    if (!c) return null
    const apiKey = this.decrypt(c.key)
    if (!apiKey) return null
    return { id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, model: c.model, apiKey }
  }

  getVisionId(): string | null {
    return this.data.visionConnectionId ?? null
  }

  setVisionId(id: string | null): void {
    if (id && !this.data.connections.some(c => c.id === id)) throw new Error('连接不存在')
    this.data.visionConnectionId = id
    void this.save()
  }

  /** 看图用的连接：指定了就用指定的，没指定就用当前对话连接 */
  getVisionConnectionSecret(): { id: string; name: string; baseUrl: string; model: string; apiKey: string } | null {
    const wanted = this.data.visionConnectionId
    const c = wanted
      ? this.data.connections.find(x => x.id === wanted)
      : this.data.connections.find(x => x.id === this.data.activeConnectionId)
    if (!c) return null
    const apiKey = this.decrypt(c.key)
    if (!apiKey) return null
    return { id: c.id, name: c.name, baseUrl: c.baseUrl, model: c.model, apiKey }
  }

  getLastScenePath(): string | undefined { return this.data.lastScenePath }
  setLastScenePath(p: string): void { this.data.lastScenePath = p; void this.save() }

  // ---------- 导出位置 ----------

  getExportSettings(): StoredExportSettings {
    const s = this.data.exportSettings
    return {
      dir: typeof s?.dir === 'string' && s.dir.trim() ? s.dir.trim() : null,
      askEveryTime: s?.askEveryTime !== false,
      revealAfterExport: s?.revealAfterExport !== false,
      recentDirs: Array.isArray(s?.recentDirs) ? s!.recentDirs.filter(d => typeof d === 'string' && d.trim()).slice(0, 8) : []
    }
  }

  setExportSettings(patch: Partial<StoredExportSettings>): StoredExportSettings {
    const cur = this.getExportSettings()
    const next: StoredExportSettings = {
      dir: patch.dir !== undefined ? (patch.dir && patch.dir.trim() ? patch.dir.trim() : null) : cur.dir,
      askEveryTime: patch.askEveryTime !== undefined ? Boolean(patch.askEveryTime) : cur.askEveryTime,
      revealAfterExport: patch.revealAfterExport !== undefined ? Boolean(patch.revealAfterExport) : cur.revealAfterExport,
      recentDirs: cur.recentDirs
    }
    if (next.dir) next.recentDirs = dedupeDirs([next.dir, ...next.recentDirs])
    this.data.exportSettings = next
    void this.save()
    return next
  }

  /** 记住这次导出/选择用的目录，下次一点就回到这里 */
  rememberExportDir(dir: string): StoredExportSettings {
    const cur = this.getExportSettings()
    const next = { ...cur, recentDirs: dedupeDirs([dir, ...cur.recentDirs]) }
    this.data.exportSettings = next
    void this.save()
    return next
  }
}

function dedupeDirs(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const d = raw.trim().replace(/[\\/]+$/, '')
    if (!d) continue
    const key = d.toLowerCase() // Windows 路径大小写不敏感
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out.slice(0, 8)
}

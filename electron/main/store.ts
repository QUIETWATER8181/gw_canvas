import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { safeStorage, app } from 'electron'
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

interface ConfigFile {
  version: 1
  connections: StoredConnection[]
  activeConnectionId: string | null
  lastScenePath?: string
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
    } catch {
      this.data = { ...DEFAULT_CONFIG }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8')
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

  getLastScenePath(): string | undefined { return this.data.lastScenePath }
  setLastScenePath(p: string): void { this.data.lastScenePath = p; void this.save() }
}

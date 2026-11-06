/**
 * 素材检索（主进程）。
 *
 * 设计边界：
 *  - 只有主进程能联网，agent 和渲染进程都拿不到网络能力；
 *  - 只允许白名单域名，且只下载图片；
 *  - 下载后写进当前草稿的 assets/，同时把来源/作者/许可证记进 assets/credits.json，
 *    方便发布时标注（科普视频用图必须能说清出处）。
 *
 * 数据源：
 *  - Wikimedia Commons：无需 Key，图片/公式/示意图最全，许可证信息完整；
 *  - Openverse：聚合 CC 图片，作为补充。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

export type SearchSource = 'commons' | 'openverse'

export interface SearchResultItem {
  id: string
  title: string
  /** 缩略图（已经缓存到本机，可直接用 gewu://cache/… 显示） */
  thumbUrl: string | null
  /** 原图/大图地址，下载时用 */
  fullUrl: string
  width: number
  height: number
  mime: string
  license: string
  artist: string
  sourceUrl: string
  source: SearchSource
  downloadable: boolean
}

export interface SearchResponse {
  ok: boolean
  query: string
  source: SearchSource
  items: SearchResultItem[]
  error?: string
}

const UA = 'GewuVideo/0.1 (physics education; +https://example.invalid)'
const TIMEOUT = 20_000
const MAX_IMAGE_BYTES = 30 * 1024 * 1024

/** 只有这些主机允许下载，避免被搜索结果引到任意地址 */
const DOWNLOAD_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'live.staticflickr.com',
  'images.pexels.com',
  'cdn.pixabay.com',
  'upload.wikimedia.org'
])

function isDownloadable(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && DOWNLOAD_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

/** 缩略图只要求公网 https，别被搜索结果引到内网地址（SSRF） */
function isPublicHttps(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    return true
  } catch {
    return false
  }
}

/**
 * 图床偶尔连接超时（尤其 IPv6 走不通时），重试一次再放弃。
 * 只重试网络错误和 5xx，4xx 直接返回让上层报清楚。
 */
async function fetchImage(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  let last: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*', ...extraHeaders },
        signal: AbortSignal.timeout(30_000),
        redirect: 'follow'
      })
      if (res.ok || res.status < 500) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (error) {
      last = error
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 700))
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function stripHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function extFromMime(mime: string, url: string): string {
  const m = mime.toLowerCase()
  if (m.includes('svg')) return '.svg'
  if (m.includes('png')) return '.png'
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  if (m.includes('webp')) return '.webp'
  if (m.includes('gif')) return '.gif'
  const ext = extname(new URL(url).pathname).toLowerCase()
  return /^\.(png|jpe?g|webp|gif|svg)$/.test(ext) ? ext : '.png'
}

export class AssetSearch {
  constructor(private readonly cacheDir: string) {}

  async search(query: string, source: SearchSource = 'commons', limit = 16): Promise<SearchResponse> {
    const q = query.trim()
    if (!q) return { ok: false, query, source, items: [], error: '搜索词是空的' }
    try {
      const items = source === 'openverse'
        ? await this.searchOpenverse(q, limit)
        : await this.searchCommons(q, limit)
      return { ok: true, query: q, source, items }
    } catch (error) {
      return { ok: false, query: q, source, items: [], error: explain(error) }
    }
  }

  private async searchCommons(query: string, limit: number): Promise<SearchResultItem[]> {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatversion', '2')
    url.searchParams.set('generator', 'search')
    url.searchParams.set('gsrsearch', query)
    url.searchParams.set('gsrnamespace', '6')
    url.searchParams.set('gsrlimit', String(Math.max(1, Math.min(30, limit))))
    url.searchParams.set('prop', 'imageinfo')
    url.searchParams.set('iiprop', 'url|size|mime|extmetadata')
    url.searchParams.set('iiurlwidth', '640')
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) throw new Error(`Commons 返回 ${res.status}`)
    const json = await res.json() as {
      query?: { pages?: Array<{ pageid: number; title: string; imageinfo?: Array<Record<string, unknown>> }> }
    }
    const pages = json.query?.pages ?? []
    const out: SearchResultItem[] = []
    for (const page of pages) {
      const info = page.imageinfo?.[0]
      if (!info) continue
      const mime = String(info.mime ?? '')
      if (!/^image\//.test(mime) || /svg/i.test(mime) && !info.thumburl) continue
      const thumb = String(info.thumburl ?? info.url ?? '')
      const full = String(info.url ?? thumb)
      const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>
      const id = `commons-${page.pageid}`
      out.push({
        id,
        title: page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        thumbUrl: await this.cacheThumb(thumb, id),
        fullUrl: full,
        width: Number(info.width) || 0,
        height: Number(info.height) || 0,
        mime,
        license: stripHtml(meta.LicenseShortName?.value) || '见来源页',
        artist: stripHtml(meta.Artist?.value) || '未署名',
        sourceUrl: String(info.descriptionurl ?? ''),
        source: 'commons',
        downloadable: isDownloadable(full)
      })
    }
    return out
  }

  private async searchOpenverse(query: string, limit: number): Promise<SearchResultItem[]> {
    const url = new URL('https://api.openverse.org/v1/images/')
    url.searchParams.set('q', query)
    url.searchParams.set('page_size', String(Math.max(1, Math.min(20, limit))))
    url.searchParams.set('license_type', 'all-cc')
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) throw new Error(`Openverse 返回 ${res.status}`)
    const json = await res.json() as {
      results?: Array<{
        id: string; title?: string; thumbnail?: string; url?: string; width?: number; height?: number
        license?: string; creator?: string; foreign_landing_url?: string; filetype?: string
      }>
    }
    const out: SearchResultItem[] = []
    for (const r of json.results ?? []) {
      const full = String(r.url ?? '')
      if (!full) continue
      const id = `ov-${r.id}`
      out.push({
        id,
        title: String(r.title ?? '未命名').slice(0, 120),
        thumbUrl: await this.cacheThumb(String(r.thumbnail ?? full), id),
        fullUrl: full,
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
        mime: `image/${String(r.filetype ?? 'jpeg')}`,
        license: String(r.license ?? 'CC'),
        artist: String(r.creator ?? '未署名').slice(0, 120),
        sourceUrl: String(r.foreign_landing_url ?? ''),
        source: 'openverse',
        downloadable: isDownloadable(full)
      })
    }
    return out
  }

  /** 缩略图缓存到本机，渲染进程通过 gewu://cache/<name> 读取（CSP 里已允许 gewu:） */
  private async cacheThumb(url: string, id: string): Promise<string | null> {
    if (!url || !isPublicHttps(url)) return null
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
    const exts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']
    for (const ext of exts) {
      const name = `${hash}${ext}`
      if (existsSync(join(this.cacheDir, name))) return `gewu://cache/${name}`
    }
    try {
      const res = await fetchImage(url)
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > 6 * 1024 * 1024) return null
      const ext = extFromMime(type, url)
      const name = `${hash}${ext}`
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(join(this.cacheDir, name), buf)
      return `gewu://cache/${name}`
    } catch {
      return null
    }
  }

  /**
   * 下载一张搜索结果到当前草稿 assets/。
   * 返回相对路径（assets/xxx.png）和署名信息，调用方负责写进 scene。
   */
  async download(
    workspace: string,
    item: { fullUrl: string; title?: string; license?: string; artist?: string; sourceUrl?: string; id?: string }
  ): Promise<{ ok: boolean; path?: string; name?: string; bytes?: number; width?: number; height?: number; error?: string; credit?: CreditEntry }> {
    const url = String(item.fullUrl ?? '')
    if (!isDownloadable(url)) return { ok: false, error: '这个来源不允许直接下载（只支持 Wikimedia / 已知 CC 图库）' }
    try {
      const res = await fetchImage(url)
      if (!res.ok) return { ok: false, error: `下载失败：HTTP ${res.status}` }
      // 重定向后仍必须落在白名单主机上
      if (!isDownloadable(res.url)) return { ok: false, error: '下载被重定向到非白名单地址，已拒绝' }
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image/')) return { ok: false, error: `返回的不是图片（${type || '未知类型'}）` }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_IMAGE_BYTES) return { ok: false, error: '图片超过 30MB，换一张小一点的' }
      const assets = join(workspace, 'assets')
      await mkdir(assets, { recursive: true })
      const base = safeBase(item.title || new URL(url).pathname.split('/').pop() || 'asset')
      const ext = extFromMime(type, url)
      const name = await uniqueName(assets, base, ext)
      await writeFile(join(assets, name), buf)
      const credit: CreditEntry = {
        file: `assets/${name}`,
        title: String(item.title ?? '').slice(0, 200),
        author: String(item.artist ?? '未署名').slice(0, 200),
        license: String(item.license ?? '见来源页').slice(0, 100),
        source: String(item.sourceUrl ?? url),
        downloadedAt: new Date().toISOString()
      }
      await appendCredit(workspace, credit)
      return { ok: true, path: `assets/${name}`, name, bytes: buf.length, credit }
    } catch (error) {
      return { ok: false, error: explain(error) }
    }
  }
}

export interface CreditEntry {
  file: string
  title: string
  author: string
  license: string
  source: string
  downloadedAt: string
}

async function appendCredit(workspace: string, entry: CreditEntry): Promise<void> {
  const file = join(workspace, 'assets', 'credits.json')
  let list: CreditEntry[] = []
  try {
    list = JSON.parse(await readFile(file, 'utf8')) as CreditEntry[]
    if (!Array.isArray(list)) list = []
  } catch { /* 第一次下载 */ }
  list = list.filter(x => x.file !== entry.file)
  list.push(entry)
  await writeFile(file, JSON.stringify(list.slice(-200), null, 2), 'utf8')
}

function safeBase(title: string): string {
  const base = title
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 60)
  return base || 'asset'
}

async function uniqueName(dir: string, base: string, ext: string): Promise<string> {
  let name = `${base}${ext}`
  for (let i = 1; i < 200 && existsSync(join(dir, name)); i++) name = `${base}-${i}${ext}`
  return name
}

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const cause = (error as { cause?: { code?: string } })?.cause?.code
  if (message.includes('timeout') || message.includes('aborted')) return '联网超时（20 秒）：检查网络或代理'
  if (cause === 'ENOTFOUND') return '域名解析失败：检查网络'
  if (cause === 'ECONNREFUSED') return '连接被拒绝：检查网络或代理'
  return message
}

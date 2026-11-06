import { useEffect, useRef, useState } from 'react'
import type { AssetSearchItem, AssetSearchSource } from '../shared/ipc'
import type { SceneLayer } from '../shared/scene'
import { nextLayerId } from '../shared/layers'
import { useEditor } from '../state/editor'
import { measureImage } from '../engine/assets'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

/**
 * 联网素材检索（剪映「素材库」的对应物）。
 * 搜索和下载都在主进程做，这里只负责展示和插入画面。
 */
export function AssetSearchPanel({ onToast }: Props) {
  const editor = useEditor()
  const [query, setQuery] = useState('polarization wave')
  const [source, setSource] = useState<AssetSearchSource>('commons')
  const [items, setItems] = useState<AssetSearchItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [credits, setCredits] = useState(0)
  const [searched, setSearched] = useState(false)
  const abortRef = useRef(0)

  useEffect(() => {
    void window.gewu.listCredits().then(list => setCredits(list.length)).catch(() => undefined)
  }, [])

  async function search() {
    const q = query.trim()
    if (!q) return
    const seq = ++abortRef.current
    setBusy(true)
    setError('')
    try {
      const res = await window.gewu.searchAssets({ query: q, source, limit: 16 })
      if (seq !== abortRef.current) return
      if (!res.ok) {
        setItems([])
        setError(res.error ?? '检索失败')
        return
      }
      setItems(res.items)
      setSearched(true)
      if (!res.items.length) setError('没有找到结果。换英文关键词（例如 "Malus law"）通常更全。')
    } catch (e) {
      if (seq === abortRef.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (seq === abortRef.current) setBusy(false)
    }
  }

  async function insert(item: AssetSearchItem) {
    if (downloading) return
    setDownloading(item.id)
    try {
      const res = await window.gewu.downloadAsset(item)
      if (!res.ok || !res.path) throw new Error(res.error ?? '下载失败')
      const scene = editor.state.scene
      const size = await measureImage(res.path)
      let w = size?.width ?? 640
      let h = size?.height ?? 360
      const k = Math.min(1, (scene.canvas.width * 0.55) / w, (scene.canvas.height * 0.55) / h)
      w = Math.round(w * k)
      h = Math.round(h * k)
      const start = Number(editor.state.time.toFixed(2))
      const end = Math.min(scene.canvas.duration, start + 5)
      const layer: SceneLayer = {
        id: nextLayerId(scene, 'img'),
        name: (res.name ?? item.title).replace(/\.[a-z0-9]+$/i, '').slice(0, 40),
        kind: 'image',
        x: Math.round((scene.canvas.width - w) / 2),
        y: Math.round((scene.canvas.height - h) / 2),
        w,
        h,
        image: { src: res.path, fit: 'contain', radius: 10 },
        start,
        end: end > start + 0.2 ? end : scene.canvas.duration,
        enter: { kind: 'fade', dur: 0.45 }
      }
      editor.addLayer(layer)
      void window.gewu.listCredits().then(list => setCredits(list.length)).catch(() => undefined)
      onToast({ text: `已下载并插入「${item.title.slice(0, 24)}」· ${item.license}`, kind: 'ok' })
    } catch (e) {
      onToast({ text: e instanceof Error ? e.message : String(e), kind: 'err' })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="lp-section search-panel">
      <div className="lp-section-head">
        <span>联网找素材</span>
        <span className="tiny muted">Wikimedia · CC 授权</span>
      </div>
      <div className="search-bar">
        <input
          className="input"
          value={query}
          placeholder="物理示意图 / 公式 / 实验照片…"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void search() }}
        />
        <select className="input search-src" value={source} onChange={e => setSource(e.target.value as AssetSearchSource)}>
          <option value="commons">Commons</option>
          <option value="openverse">Openverse</option>
        </select>
        <button className="btn primary sm" disabled={busy || !query.trim()} onClick={() => void search()}>
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>
      <div className="ref-hint">
        搜到的图片会下载进当前草稿的 <code>assets/</code>，并自动记录作者/许可证（{credits} 条署名）。
        发布时记得按许可证标注。
      </div>
      {error && <div className="search-error">{error}</div>}
      <div className="search-grid">
        {items.map(item => (
          <div key={item.id} className="search-card" title={`${item.title}\n${item.license} · ${item.artist}`}>
            <div className="search-thumb">
              {item.thumbUrl
                ? <img src={item.thumbUrl} alt={item.title} loading="lazy" />
                : <span className="search-noimg">无预览</span>}
              <span className="search-badge">{item.license}</span>
            </div>
            <div className="search-meta">
              <span className="search-title" title={item.title}>{item.title}</span>
              <span className="tiny muted">{item.width}×{item.height}</span>
            </div>
            <button
              className="btn sm block"
              disabled={!item.downloadable || downloading === item.id}
              onClick={() => void insert(item)}
              title={item.downloadable ? '下载并插入到播放头' : '这个来源不允许直接下载'}
            >
              {downloading === item.id ? '下载中…' : item.downloadable ? '插入画面' : '仅查看来源'}
            </button>
          </div>
        ))}
      </div>
      {!items.length && !busy && (
        <div className="lp-empty">
          {searched ? '没有结果，换个关键词试试。' : '输入关键词搜索图片。公式/示意图用英文更准，例如 “Malus law”、“electric field lines”。'}
        </div>
      )}
    </div>
  )
}

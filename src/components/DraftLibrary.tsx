import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftSummary } from '../shared/ipc'
import '../styles/drafts.css'

type SortKey = 'updated' | 'created' | 'name'
type FilterKey = 'all' | 'pinned'

const SORT_LABEL: Record<SortKey, string> = {
  updated: '最近修改',
  created: '创建时间',
  name: '名称'
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0.05) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtWhen(ts: number): string {
  if (!ts) return '从未打开'
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  const yesterday = new Date(now.getTime() - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function DraftLibrary() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DraftSummary | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' | 'info' } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const notify = useCallback((text: string, kind: 'ok' | 'err' | 'info' = 'info') => {
    setToast({ text, kind })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await window.gewu.listDrafts()
      setDrafts(list)
      setSelected(prev => (prev && list.some(d => d.id === prev) ? prev : list.find(d => d.active)?.id ?? list[0]?.id ?? null))
    } catch (e) {
      notify(`读不到草稿列表：${e instanceof Error ? e.message : String(e)}`, 'err')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh()
    const off = window.gewu.onDraftsChanged(list => setDrafts(list))
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { off(); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!menuFor) return
    const close = () => setMenuFor(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuFor])

  // 快捷键：Ctrl+F 搜索 / Esc 取消选择 / Enter 打开 / Delete 删除 / Ctrl+N 新建
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void createDraft()
        return
      }
      if (e.key === 'Escape') {
        if (typing) { (el as HTMLInputElement).blur(); return }
        setSelected(null)
        setMenuFor(null)
        return
      }
      if (typing) return
      if (e.key === 'Enter' && selected) { e.preventDefault(); void openDraft(selected) }
      if (e.key === 'Delete' && selected) {
        const d = drafts.find(x => x.id === selected)
        if (d) setConfirmDelete(d)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, drafts])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = drafts.filter(d => (filter === 'pinned' ? d.pinned : true))
    if (q) {
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        fmtWhen(d.updatedAt).includes(q)
      )
    }
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN')
      if (sort === 'created') return b.createdAt - a.createdAt
      return b.updatedAt - a.updatedAt
    })
    return sorted
  }, [drafts, query, filter, sort])

  async function createDraft() {
    setBusy('create')
    try {
      const r = await window.gewu.createDraft({})
      if (!r.ok || !r.draft) throw new Error(r.error ?? '新建失败')
      setDrafts(r.drafts ?? drafts)
      setRenaming({ id: r.draft.id, value: r.draft.name })
      setSelected(r.draft.id)
      notify('已新建草稿，改个名字吧', 'ok')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  async function openDraft(id: string) {
    const target = drafts.find(d => d.id === id)
    if (!target) return
    if (target.active) { notify('这个草稿已经在编辑器里打开了'); return }
    setBusy(id)
    try {
      const r = await window.gewu.openDraft(id)
      if (!r.ok) throw new Error(r.error ?? '打开失败')
      setDrafts(r.drafts ?? drafts)
      notify(`已在编辑器打开「${target.name}」`, 'ok')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  async function commitRename() {
    if (!renaming) return
    const { id, value } = renaming
    setRenaming(null)
    const clean = value.trim()
    const current = drafts.find(d => d.id === id)
    if (!clean || clean === current?.name) return
    try {
      const r = await window.gewu.renameDraft(id, clean)
      if (!r.ok) throw new Error(r.error ?? '改名失败')
      setDrafts(r.drafts ?? drafts)
      notify('已改名', 'ok')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  async function duplicate(id: string) {
    setBusy(id)
    try {
      const r = await window.gewu.duplicateDraft(id)
      if (!r.ok || !r.draft) throw new Error(r.error ?? '复制失败')
      setDrafts(r.drafts ?? drafts)
      setSelected(r.draft.id)
      notify(`已复制为「${r.draft.name}」`, 'ok')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  async function togglePin(d: DraftSummary) {
    try {
      const r = await window.gewu.setDraftPinned(d.id, !d.pinned)
      if (!r.ok) throw new Error(r.error ?? '置顶失败')
      setDrafts(r.drafts ?? drafts)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    }
  }

  async function remove(d: DraftSummary) {
    setConfirmDelete(null)
    setBusy(d.id)
    try {
      const r = await window.gewu.deleteDraft(d.id)
      if (!r.ok) throw new Error(r.error ?? '删除失败')
      setDrafts(r.drafts ?? drafts)
      notify('已移到回收站（trash 目录），需要时可以找回', 'ok')
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'err')
    } finally {
      setBusy(null)
    }
  }

  const totalSec = drafts.reduce((sum, d) => sum + d.durationSec, 0)

  return (
    <div className="dl">
      <header className="dl-bar">
        <div className="dl-brand">
          <span className="dl-brand-mark" aria-hidden>
            <svg viewBox="0 0 32 32" width="18" height="18">
              <circle cx="16" cy="16" r="5" fill="#4fc3d9" />
              <ellipse cx="16" cy="16" rx="13" ry="5.2" fill="none" stroke="#4fc3d9" strokeOpacity="0.5" strokeWidth="1.1" transform="rotate(-24 16 16)" />
              <ellipse cx="16" cy="16" rx="13" ry="5.2" fill="none" stroke="#f2b544" strokeOpacity="0.45" strokeWidth="1.1" transform="rotate(38 16 16)" />
            </svg>
          </span>
          <span className="dl-brand-name">草稿库</span>
          <span className="dl-brand-sub">格物 · 物理科普视频</span>
        </div>

        <div className="dl-search">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索草稿名或标题（Ctrl+F）"
          />
          {query && <button className="dl-search-clear" onClick={() => setQuery('')} title="清空">×</button>}
        </div>

        <div className="dl-bar-actions">
          <select className="dl-sort" value={sort} onChange={e => setSort(e.target.value as SortKey)} title="排序">
            {(Object.keys(SORT_LABEL) as SortKey[]).map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
          <button className="btn primary sm" onClick={() => void createDraft()} disabled={busy === 'create'} title="新建草稿（Ctrl+N）">
            ＋ 新建草稿
          </button>
        </div>
      </header>

      <div className="dl-filters">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          全部 <span>{drafts.length}</span>
        </button>
        <button className={filter === 'pinned' ? 'on' : ''} onClick={() => setFilter('pinned')}>
          置顶 <span>{drafts.filter(d => d.pinned).length}</span>
        </button>
        <span className="spacer" />
        <span className="dl-hint">双击卡片在编辑器打开 · 右键更多操作</span>
      </div>

      <div className="dl-body" onMouseDown={() => setMenuFor(null)}>
        {loading && <div className="dl-empty">正在读取草稿…</div>}
        {!loading && visible.length === 0 && (
          <div className="dl-empty">
            <div className="dl-empty-mark">◍</div>
            <b>{query ? '没有匹配的草稿' : '还没有草稿'}</b>
            <span>{query ? '换个关键词试试' : '点右上角「新建草稿」，或直接告诉 AI 你想做什么'}</span>
            {!query && <button className="btn primary sm" onClick={() => void createDraft()}>＋ 新建草稿</button>}
          </div>
        )}

        {visible.length > 0 && (
          <div className="dl-grid">
            {visible.map(d => {
              const isBusy = busy === d.id
              return (
                <div
                  key={d.id}
                  className={`dl-card ${selected === d.id ? 'sel' : ''} ${d.active ? 'active' : ''}`}
                  onClick={() => setSelected(d.id)}
                  onDoubleClick={() => void openDraft(d.id)}
                  onContextMenu={e => { e.preventDefault(); setSelected(d.id); setMenuFor(d.id) }}
                  title={`${d.name}\n${d.dir}`}
                >
                  <div className="dl-cover">
                    {d.coverUrl
                      ? <img src={d.coverUrl} alt="" draggable={false} />
                      : <div className="dl-cover-blank">
                          <span>{d.name.slice(0, 1) || '草'}</span>
                          <em>还没有预览图</em>
                        </div>}
                    <span className="dl-cover-dur">{fmtDuration(d.durationSec)}</span>
                    {d.active && <span className="dl-cover-flag">编辑中</span>}
                    {d.pinned && <span className="dl-cover-pin" title="已置顶">★</span>}
                    {isBusy && <div className="dl-cover-busy"><span className="spin-dot" /></div>}
                  </div>

                  <div className="dl-info">
                    <div className="dl-name-row">
                      {renaming?.id === d.id ? (
                        <input
                          className="dl-rename"
                          autoFocus
                          value={renaming.value}
                          onChange={e => setRenaming({ id: d.id, value: e.target.value })}
                          onBlur={() => void commitRename()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); void commitRename() }
                            if (e.key === 'Escape') { e.preventDefault(); setRenaming(null) }
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="dl-name" onDoubleClick={e => { e.stopPropagation(); setRenaming({ id: d.id, value: d.name }) }}>
                          {d.name}
                        </span>
                      )}
                      <button
                        className="dl-more"
                        title="更多"
                        onClick={e => { e.stopPropagation(); setMenuFor(menuFor === d.id ? null : d.id) }}
                      >⋯</button>
                    </div>
                    {d.title && d.title !== d.name && <div className="dl-title">{d.title}</div>}
                    <div className="dl-meta">
                      <span>{fmtWhen(d.updatedAt)}</span>
                      <span className="dl-dot">·</span>
                      <span>{d.layerCount} 图层</span>
                      {d.assetCount > 0 && <><span className="dl-dot">·</span><span>{d.assetCount} 素材</span></>}
                      {d.exportCount > 0 && <><span className="dl-dot">·</span><span>{d.exportCount} 成片</span></>}
                    </div>
                  </div>

                  {menuFor === d.id && (
                    <div className="dl-menu" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setMenuFor(null); void openDraft(d.id) }} disabled={d.active}>
                        {d.active ? '已在编辑器打开' : '在编辑器打开'}
                      </button>
                      <button onClick={() => { setMenuFor(null); setRenaming({ id: d.id, value: d.name }) }}>重命名</button>
                      <button onClick={() => { setMenuFor(null); void duplicate(d.id) }}>创建副本</button>
                      <button onClick={() => { setMenuFor(null); void togglePin(d) }}>{d.pinned ? '取消置顶' : '置顶'}</button>
                      <button onClick={() => { setMenuFor(null); void window.gewu.revealDraft(d.id) }}>在文件夹中显示</button>
                      <button className="danger" onClick={() => { setMenuFor(null); setConfirmDelete(d) }} disabled={d.active}>删除草稿</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer className="dl-foot">
        <span>{drafts.length} 个草稿 · 共 {fmtDuration(totalSec)}</span>
        <span className="dl-foot-sep">|</span>
        <span className="mono dl-path" title={drafts[0]?.dir.replace(/[\\/][^\\/]+$/, '') ?? ''}>
          {drafts[0]?.dir.replace(/[\\/][^\\/]+$/, '') ?? ''}
        </span>
        <span className="spacer" />
        <button
          className="link"
          onClick={() => { const d = drafts.find(x => x.active) ?? drafts[0]; if (d) void window.gewu.revealDraft(d.id) }}
          disabled={!drafts.length}
        >打开草稿文件夹</button>
      </footer>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      {confirmDelete && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDelete(null) }}>
          <div className="dl-confirm">
            <h3>删除草稿？</h3>
            <p>
              「{confirmDelete.name}」会连同素材和对话一起挪到回收站目录
              <code className="mono">trash/</code>，不会立刻消失，需要时能手工找回。
            </p>
            <div className="dl-confirm-actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="btn danger" onClick={() => void remove(confirmDelete)}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

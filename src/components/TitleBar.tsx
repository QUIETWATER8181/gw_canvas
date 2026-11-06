import { useEffect, useRef, useState } from 'react'
import type { AppState, DraftSummary } from '../shared/ipc'

interface Props {
  state: AppState
  drafts: DraftSummary[]
  switching: boolean
  onOpenSettings(): void
  onOpenExport(): void
  onOpenLibrary(): void
  onOpenDraft(id: string): void
  onNewDraft(): void
  onNewSession(): void
  onOpenHelp(): void
}

function statusOf(state: AppState): { cls: string; text: string } {
  const { phase, detail } = state.agent
  if (phase === 'running') return { cls: 'busy', text: '思考中' }
  if (phase === 'paused') return { cls: 'busy', text: '已暂停' }
  if (phase === 'starting') return { cls: 'busy', text: '启动中' }
  if (phase === 'error') return { cls: 'err', text: '异常' }
  if (phase === 'ready') return { cls: 'on', text: '就绪' }
  return { cls: '', text: detail ?? '未连接' }
}

function fmtAgo(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function TitleBar({
  state, drafts, switching, onOpenSettings, onOpenExport, onOpenLibrary,
  onOpenDraft, onNewDraft, onNewSession, onOpenHelp
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  // 点标题栏按钮关菜单时，这一次点击只用来关菜单，不能再触发底下的按钮
  // （否则「点 ⋯ 菜单」会变成「打开草稿库窗口」——作者实测踩到过）
  const swallowClick = useRef(false)
  const st = statusOf(state)
  const conn = state.connections.find(c => c.id === state.activeConnectionId)
  const draft = state.draft

  useEffect(() => {
    if (!menuOpen && !draftOpen) return
    const close = () => {
      setMenuOpen(false)
      setDraftOpen(false)
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      // 菜单/下拉内部的点击交给它们自己的 onClick 收尾，别提前卸载
      if (t?.closest?.('.tb-menu, .tb-drafts')) return
      if (t && barRef.current?.contains(t)) {
        swallowClick.current = true
        setTimeout(() => { swallowClick.current = false }, 500)
      }
      close()
    }
    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.stopPropagation()
      e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('click', onClickCapture, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, draftOpen])

  // 草稿切换下拉里最多列 8 个：置顶在前，其余按最近修改
  const recent = [...drafts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  }).slice(0, 8)

  return (
    <header className="titlebar" ref={barRef}>
      <div className="tb-brand">
        <div className="brand-mark">
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
            <defs>
              <radialGradient id="g-core" cx="50%" cy="45%" r="60%">
                <stop offset="0%" stopColor="#bff3ff" />
                <stop offset="55%" stopColor="#4fc3d9" />
                <stop offset="100%" stopColor="#1c6d80" />
              </radialGradient>
            </defs>
            <circle cx="16" cy="16" r="5.2" fill="url(#g-core)" />
            <ellipse cx="16" cy="16" rx="13" ry="5.4" fill="none" stroke="#4fc3d9" strokeOpacity="0.55" strokeWidth="1.1" transform="rotate(-24 16 16)" />
            <ellipse cx="16" cy="16" rx="13" ry="5.4" fill="none" stroke="#f2b544" strokeOpacity="0.5" strokeWidth="1.1" transform="rotate(38 16 16)" />
            <circle cx="27.4" cy="11.2" r="1.5" fill="#f2b544" />
          </svg>
        </div>
        <div className="brand-text">
          <span className="brand-name">格物</span>
          <span className="brand-sub">物理科普视频</span>
        </div>
      </div>

      <div className="tb-center">
        <button
          className={`tb-draft ${draftOpen ? 'open' : ''}`}
          onClick={() => { setDraftOpen(v => !v); setMenuOpen(false) }}
          title="切换草稿（每个草稿有独立的场景、素材和对话）"
        >
          <span className="tb-draft-label">草稿</span>
          <span className="tb-draft-name">{draft?.name ?? '未命名草稿'}</span>
          {switching
            ? <span className="spin-dot" />
            : <svg className="tb-draft-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="m6 9 6 6 6-6" /></svg>}
        </button>
        <span className="tb-sep">/</span>
        <span className="tb-scene-file mono">scene.json</span>

        {draftOpen && (
          <div className="tb-drafts">
            <div className="tb-drafts-head">
              <span>最近草稿</span>
              <span className="tiny muted">{drafts.length} 个</span>
            </div>
            <div className="tb-drafts-list">
              {recent.length === 0 && <div className="tb-drafts-empty">还没有草稿</div>}
              {recent.map(d => (
                <button
                  key={d.id}
                  className={`tb-draft-item ${d.active ? 'on' : ''}`}
                  onClick={() => { setDraftOpen(false); if (!d.active) onOpenDraft(d.id) }}
                  title={d.dir}
                >
                  <span className="tb-di-main">
                    <span className="tb-di-name">{d.pinned ? '★ ' : ''}{d.name}</span>
                    <span className="tb-di-sub">{d.layerCount} 图层 · {fmtAgo(d.updatedAt)}</span>
                  </span>
                  {d.active && <span className="badge accent">当前</span>}
                </button>
              ))}
            </div>
            <div className="tb-drafts-foot">
              <button className="link" onClick={() => { setDraftOpen(false); onNewDraft() }}>＋ 新建草稿</button>
              <button className="link" onClick={() => { setDraftOpen(false); onOpenLibrary() }}>打开草稿库…</button>
            </div>
          </div>
        )}
      </div>

      <div className="tb-right">
        <button className="tb-status" onClick={onOpenSettings} title={state.agent.detail ?? ''}>
          <span className={`dot ${st.cls}`} />
          <span className="tb-status-text">{st.text}</span>
          {conn && <span className="tb-status-model">{conn.model}</span>}
        </button>
        <div className="tb-actions">
          <button className="btn sm" onClick={onOpenLibrary} title="草稿库（独立窗口）">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="7" height="7" rx="1.4" /><rect x="14" y="4" width="7" height="7" rx="1.4" />
              <rect x="3" y="13" width="7" height="7" rx="1.4" /><rect x="14" y="13" width="7" height="7" rx="1.4" />
            </svg>
            草稿库
          </button>
          <button className="btn sm" onClick={onNewSession} title="清空对话并新建 agent 会话（场景不动）">新会话</button>
          <button className="btn sm" onClick={() => { setMenuOpen(v => !v); setDraftOpen(false) }} title="更多">⋯</button>
          <button className="btn primary sm" onClick={onOpenExport}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
            </svg>
            导出
          </button>
        </div>
        {menuOpen && (
          <div className="tb-menu">
            <button onClick={() => { void window.gewu.revealPath(state.scenePath); setMenuOpen(false) }}>打开场景文件夹</button>
            <button onClick={() => { void window.gewu.openFolder(state.workspace); setMenuOpen(false) }}>打开草稿目录</button>
            <button onClick={() => { void window.gewu.openFolder(state.exportSettings.resolvedDir); setMenuOpen(false) }}>打开导出文件夹</button>
            <button onClick={() => { onOpenLibrary(); setMenuOpen(false) }}>草稿库…</button>
            <button onClick={() => { onOpenSettings(); setMenuOpen(false) }}>模型设置…</button>
            <div className="tb-menu-sep" />
            <button onClick={() => { onOpenHelp(); setMenuOpen(false) }}>使用说明（怎么用）…</button>
          </div>
        )}
      </div>
    </header>
  )
}

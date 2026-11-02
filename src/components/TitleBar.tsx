import { useState } from 'react'
import type { AppState } from '../shared/ipc'

interface Props {
  state: AppState
  onOpenSettings(): void
  onExport(): void
  onNewSession(): void
}

function statusOf(state: AppState): { cls: string; text: string } {
  const { phase, detail } = state.agent
  if (phase === 'running') return { cls: 'busy', text: '思考中' }
  if (phase === 'starting') return { cls: 'busy', text: '启动中' }
  if (phase === 'error') return { cls: 'err', text: '异常' }
  if (phase === 'ready') return { cls: 'on', text: '就绪' }
  return { cls: '', text: detail ?? '未连接' }
}

export function TitleBar({ state, onOpenSettings, onExport, onNewSession }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const st = statusOf(state)
  const conn = state.connections.find(c => c.id === state.activeConnectionId)

  return (
    <header className="titlebar">
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
        <div className="tb-scene">
          <span className="tb-scene-title">{state.agent.phase === 'error' ? '连接异常' : '工作台'}</span>
          <span className="tb-sep">/</span>
          <span className="tb-scene-file mono">scene.json</span>
        </div>
      </div>

      <div className="tb-right">
        <button className={`tb-status ${st.cls}`} onClick={onOpenSettings} title={state.agent.detail ?? ''}>
          <span className={`dot ${st.cls}`} />
          <span className="tb-status-text">{st.text}</span>
          {conn && <span className="tb-status-model">{conn.model}</span>}
        </button>
        <div className="tb-actions">
          <button className="btn sm" onClick={onNewSession} title="清空对话并新建 agent 会话">新会话</button>
          <button className="btn sm" onClick={() => setMenuOpen(v => !v)} title="更多">⋯</button>
          <button className="btn primary sm" onClick={onExport}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
            </svg>
            导出
          </button>
        </div>
        {menuOpen && (
          <div className="tb-menu" onMouseLeave={() => setMenuOpen(false)}>
            <button onClick={() => { void window.gewu.revealPath(state.scenePath); setMenuOpen(false) }}>打开场景文件夹</button>
            <button onClick={() => { void window.gewu.revealPath(state.workspace); setMenuOpen(false) }}>打开工作区</button>
            <button onClick={() => { onOpenSettings(); setMenuOpen(false) }}>模型设置</button>
          </div>
        )}
      </div>
    </header>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { AgentStatus, ChatMessage } from '../shared/ipc'
import { useEditor } from '../state/editor'
import { LayerList } from './LayerList'
import { Inspector } from './Inspector'
import { ChatPanel } from './ChatPanel'

interface Props {
  chat: ChatMessage[]
  agent: AgentStatus
  onOpenSettings(): void
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'layers' | 'chat'

export function RightPanel({ chat, agent, onOpenSettings, onToast }: Props) {
  const editor = useEditor()
  const [tab, setTab] = useState<Tab>('chat')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const starting = agent.phase === 'starting'
  const busy = sending || agent.phase === 'running' || starting

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setSending(true)
    try {
      await window.gewu.sendPrompt(text, {
        time: editor.state.time,
        selectedLayerId: editor.state.selectedLayerId ?? undefined
      })
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      onToast({ text: text.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), kind: 'err' })
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const selected = editor.state.scene.layers.find(l => l.id === editor.state.selectedLayerId) ?? null

  return (
    <aside className="right-panel">
      <div className="rp-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          AI 助手
          {busy && <span className="spin-dot" />}
        </button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>
          图层 <span className="rp-count">{editor.state.scene.layers.length}</span>
        </button>
      </div>

      {tab === 'chat' ? (
        <ChatPanel chat={chat} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="rp-layers">
          <LayerList />
          {selected && <Inspector layer={selected} />}
        </div>
      )}

      {agent.phase === 'error' && (
        <div className="rp-alert">
          <div className="rp-alert-text">
            <b>模型连接有问题</b>
            <span>{agent.detail ?? '未知错误'}</span>
          </div>
          <button className="btn sm" onClick={onOpenSettings}>去设置</button>
        </div>
      )}

      <div className="rp-composer">
        <div className="rp-composer-box">
          <textarea
            ref={taRef}
            className="rp-input"
            placeholder={starting ? '正在启动 AI 运行时（首次约 3–5 秒）…' : busy ? 'AI 正在处理…' : '描述你想做的物理画面，或直接说怎么改…'}
            value={draft}
            rows={3}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
          />
          <div className="rp-composer-actions">
            <button className="icon-btn" title="插入参考图" onClick={() => setTab('chat')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-4.5-4.5L9 18" /></svg>
            </button>
            <span className="spacer" />
            {busy ? (
              <button className="btn sm" onClick={() => void window.gewu.cancelPrompt()}>停止</button>
            ) : (
              <button className="btn primary sm" onClick={() => void send()} disabled={!draft.trim()}>
                发送
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            )}
          </div>
        </div>
        <div className="rp-composer-foot">
          <span className="tiny muted">Enter 发送 · Shift+Enter 换行</span>
          <span className="tiny muted">agent 会直接改场景代码</span>
        </div>
      </div>
    </aside>
  )
}

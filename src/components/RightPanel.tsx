import { useEffect, useRef, useState } from 'react'
import type { AgentStatus, ChatMessage } from '../shared/ipc'
import { useEditor } from '../state/editor'
import { countLayers, findLayer } from '../shared/layers'
import { LayerList } from './LayerList'
import { Inspector } from './Inspector'
import { ChatPanel } from './ChatPanel'

interface Props {
  chat: ChatMessage[]
  agent: AgentStatus
  onOpenSettings(): void
  onOpenHelp(): void
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'chat' | 'layers' | 'props'

export function RightPanel({ chat, agent, onOpenSettings, onOpenHelp, onToast }: Props) {
  const editor = useEditor()
  const [tab, setTab] = useState<Tab>('chat')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [progressOpen, setProgressOpen] = useState(() => localStorage.getItem('gewu.progressOpen') !== '0')
  const [elapsed, setElapsed] = useState(0)
  const [usage, setUsage] = useState({ inputTokens: 0, outputTokens: 0, requests: 0 })
  const startedAt = useRef<number | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const starting = agent.phase === 'starting'
  const running = agent.phase === 'running'
  const paused = agent.phase === 'paused'
  const busy = sending || running || starting

  useEffect(() => {
    if (running) {
      if (startedAt.current === null) startedAt.current = Date.now()
    } else if (!paused) {
      startedAt.current = null
      setElapsed(0)
    }
    const timer = setInterval(() => {
      if (startedAt.current !== null && (running || paused)) setElapsed(Math.round((Date.now() - startedAt.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [running, paused])

  useEffect(() => {
    localStorage.setItem('gewu.progressOpen', progressOpen ? '1' : '0')
  }, [progressOpen])

  // token 用量（代理侧统计）：跑的时候每 2.5s 刷一次，方便判断这轮贵不贵
  useEffect(() => {
    let alive = true
    const tick = () => {
      void window.gewu.getUsage().then(u => { if (alive) setUsage(u) }).catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [agent.phase, chat.length])

  async function send() {
    const text = draft.trim()
    if (!text || busy || paused) return
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

  const selected = editor.state.selectedLayerId ? findLayer(editor.state.scene.layers, editor.state.selectedLayerId)?.layer ?? null : null
  const layerCount = countLayers(editor.state.scene.layers)
  const lastAssistant = [...chat].reverse().find(m => m.role === 'assistant')
  const tools = lastAssistant?.tools ?? []
  const doneTools = tools.filter(t => t.status === 'done').length

  const phaseText = starting ? '启动运行时' : running ? '生成中' : paused ? '已暂停' : '就绪'

  return (
    <aside className="right-panel">
      <div className="rp-tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          AI 助手
          {busy && <span className="spin-dot" />}
        </button>
        <button className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>
          图层 <span className="rp-count">{layerCount}</span>
        </button>
        <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')} title="选中元素的属性">
          属性
        </button>
      </div>

      {tab === 'chat' && (
        <div className={`rp-progress ${progressOpen ? '' : 'closed'} ${paused ? 'paused' : ''}`}>
          <button className="rp-progress-head" onClick={() => setProgressOpen(v => !v)} title={progressOpen ? '收起进度' : '展开进度'}>
            <span className={`rp-phase ${running ? 'run' : paused ? 'pause' : ''}`}>
              {running || paused ? <span className="spin-dot" /> : null}
              {phaseText}
            </span>
            {!progressOpen && (
              <span className="rp-progress-brief">
                {elapsed > 0 ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : ''}
                {tools.length ? ` · ${doneTools}/${tools.length} 步` : ''}
              </span>
            )}
            <span className="spacer" />
            <span className="rp-progress-caret">{progressOpen ? '▾' : '▸'}</span>
          </button>
          {progressOpen && (
            <div className="rp-progress-body">
              <div className="rp-progress-stats">
                <span className="mono">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>
                <span className="tiny muted">{tools.length ? `${doneTools}/${tools.length} 个步骤完成` : '等待第一个动作'}</span>
                {usage.requests > 0 && (
                  <span className="tiny muted" title="本会话累计 token（输入/输出）">
                    ↑{formatTokens(usage.inputTokens)} ↓{formatTokens(usage.outputTokens)} tokens
                  </span>
                )}
                {paused && <span className="tiny rp-paused-tip">已停止花 token，可点「继续」</span>}
              </div>
              <div className="rp-steps">
                {tools.length === 0 && <span className="tiny muted">还没有工具调用</span>}
                {tools.slice(-8).map(t => (
                  <span key={t.id} className={`rp-step ${t.status}`}>
                    <i>{t.status === 'done' ? '✓' : t.status === 'error' ? '!' : '·'}</i>
                    {prettyTool(t.title)}
                  </span>
                ))}
              </div>
              {(running || paused) && (
                <div className="rp-progress-actions">
                  {running ? (
                    <button className="btn sm" onClick={() => void window.gewu.pausePrompt()} title="立刻停止当前请求，保留已生成内容，不再消耗 token">
                      暂停生成
                    </button>
                  ) : (
                    <button className="btn sm primary" onClick={() => void window.gewu.resumePrompt()} title="从中断处接着做">
                      继续
                    </button>
                  )}
                  <button className="btn sm" onClick={() => void window.gewu.cancelPrompt()} title="结束这一轮">
                    结束
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'chat' ? (
        <ChatPanel chat={chat} onOpenSettings={onOpenSettings} />
      ) : tab === 'layers' ? (
        <div className="rp-layers">
          <LayerList />
          {selected && <Inspector layer={selected} />}
        </div>
      ) : (
        <div className="rp-layers">
          {selected
            ? <Inspector layer={selected} />
            : <div className="lp-empty">先在图层面板或画布上选中一个元素，这里会显示它的属性。</div>}
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

      {tab === 'chat' && (
        <div className="rp-composer">
          <div className="rp-composer-box">
            <textarea
              ref={taRef}
              className="rp-input"
              placeholder={starting ? '正在启动 AI 运行时（首次约 3–5 秒）…' : paused ? '已暂停。点上面「继续」接着做，或直接结束。' : running ? 'AI 正在处理…可以随时暂停' : '描述你想做的物理画面，或直接说怎么改…'}
              value={draft}
              rows={3}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || paused}
            />
            <div className="rp-composer-actions">
              <button className="icon-btn" title="插入参考图" onClick={() => onToast({ text: '在左侧「媒体 → 参考图」里选图', kind: 'info' })}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-4.5-4.5L9 18" /></svg>
              </button>
              <span className="spacer" />
              {running ? (
                <>
                  <button className="btn sm" onClick={() => void window.gewu.pausePrompt()}>暂停</button>
                  <button className="btn sm" onClick={() => void window.gewu.cancelPrompt()}>停止</button>
                </>
              ) : paused ? (
                <>
                  <button className="btn sm primary" onClick={() => void window.gewu.resumePrompt()}>继续</button>
                  <button className="btn sm" onClick={() => void window.gewu.cancelPrompt()}>结束</button>
                </>
              ) : (
                <button className="btn primary sm" onClick={() => void send()} disabled={!draft.trim() || starting}>
                  发送
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              )}
            </div>
          </div>
          <div className="rp-composer-foot">
            <span className="tiny muted">Enter 发送 · Shift+Enter 换行</span>
            <button className="link tiny" onClick={onOpenHelp} title="手工剪辑怎么用（含「组合」说明）">使用说明</button>
          </div>
        </div>
      )}
    </aside>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function prettyTool(title: string): string {  const map: Record<string, string> = {
    scene_read: '读取场景',
    scene_inspect: '查看场景结构',
    scene_write: '写入场景',
    scene_set_layer: '修改图层',
    scene_batch: '批量修改',
    scene_add_layer: '新增图层',
    scene_delete_layer: '删除图层',
    scene_render_frame: '渲染预览帧',
    check_scene: '检查场景',
    scene_export_video: '导出视频',
    image_inspect: '看明暗',
    image_describe: '让视觉模型看图',
    image_compare: '比对两张图',
    asset_import: '导入素材',
    asset_search: '联网找素材',
    asset_download: '下载素材',
    asset_svg: '生成 SVG',
    sfx_add: '加音效',
    tts_speak: '配音',
    ask_user: '向你提问'
  }
  for (const [k, v] of Object.entries(map)) if (title.includes(k)) return v
  return title
}

import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../shared/ipc'

interface Props {
  chat: ChatMessage[]
  onOpenSettings(): void
}

export function ChatPanel({ chat, onOpenSettings }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat])

  if (chat.length === 0) {
    return (
      <div className="chat-empty">
        <div className="ce-mark">
          <svg viewBox="0 0 48 48" width="40" height="40">
            <circle cx="24" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <ellipse cx="24" cy="24" rx="19" ry="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" transform="rotate(-28 24 24)" />
            <ellipse cx="24" cy="24" rx="19" ry="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.32" transform="rotate(34 24 24)" />
          </svg>
        </div>
        <h3>告诉我要讲什么物理</h3>
        <p>我会把它写成可动画的场景代码，左边实时预览。<br />你可以随时点选图层改参数，或框选一块让我重画。</p>
        <div className="ce-tips">
          <div><b>文生视频</b><span>“讲讲马吕斯定律，12 秒”</span></div>
          <div><b>图生视频</b><span>上传首尾帧，我补中间过程</span></div>
          <div><b>选区修改</b><span>画布上拖一个框，说“改这里”</span></div>
        </div>
        <button className="btn sm" onClick={onOpenSettings}>先检查模型连接</button>
      </div>
    )
  }

  return (
    <div className="chat-scroll">
      {chat.map(msg => (
        <div key={msg.id} className={`msg ${msg.role} ${msg.error ? 'err' : ''}`}>
          {msg.role === 'system' ? (
            <div className="msg-system">{msg.text}</div>
          ) : msg.role === 'user' ? (
            <div className="msg-user">
              <div className="msg-user-text">{msg.text}</div>
            </div>
          ) : (
            <div className="msg-assistant">
              <div className="msg-avatar" aria-hidden>
                <span />
              </div>
              <div className="msg-body">
                {msg.tools?.map(tool => (
                  <div key={tool.id} className={`tool-chip ${tool.status}`}>
                    <span className="tool-icon">
                      {tool.status === 'done' ? '✓' : tool.status === 'error' ? '!' : <span className="spin-dot" />}
                    </span>
                    <span className="tool-title">{prettyTool(tool.title)}</span>
                  </div>
                ))}
                {msg.text ? <Markdown text={msg.text} /> : <div className="msg-typing"><span /><span /><span /></div>}
              </div>
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

function prettyTool(title: string): string {
  const map: Record<string, string> = {
    scene_read: '读取场景',
    scene_inspect: '查看场景结构',
    scene_write: '写入场景',
    scene_set_layer: '修改图层',
    scene_add_layer: '新增图层',
    scene_delete_layer: '删除图层',
    scene_render_frame: '渲染预览帧',
    scene_export_video: '导出视频',
    asset_import: '导入素材',
    ask_user: '向你提问'
  }
  for (const [k, v] of Object.entries(map)) if (title.includes(k)) return v
  return title
}

/** 极简 markdown：代码块、行内代码、加粗 */
function Markdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const fence = /```(\w*)\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = fence.exec(text))) {
    if (m.index > last) parts.push(<Inline key={key++} text={text.slice(last, m.index)} />)
    parts.push(
      <pre key={key++} className="code-block">
        <code>{m[2]}</code>
      </pre>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<Inline key={key++} text={text.slice(last)} />)
  return <div className="msg-text">{parts}</div>
}

function Inline({ text }: { text: string }) {
  const out: React.ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('`')) out.push(<code key={k++} className="inline-code">{tok.slice(1, -1)}</code>)
    else out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

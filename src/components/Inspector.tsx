import { useEffect, useMemo, useRef, useState } from 'react'
import type { SceneLayer } from '../shared/scene'
import { useEditor } from '../state/editor'
import { compileLayer } from '../engine/render'
import { API_REFERENCE } from '../content/api-reference'

interface Props { layer: SceneLayer }

type Tab = 'props' | 'code'

export function Inspector({ layer }: Props) {
  const editor = useEditor()
  const [tab, setTab] = useState<Tab>('props')
  const [code, setCode] = useState(layer.draw)
  const [dirty, setDirty] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setCode(layer.draw)
    setDirty(false)
  }, [layer.id, layer.draw])

  const compiled = useMemo(() => compileLayer({ ...layer, draw: code }), [code, layer])

  function applyCode() {
    editor.updateLayer(layer.id, { draw: code }, { label: '改绘制代码' })
    setDirty(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = taRef.current!
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const next = `${code.slice(0, start)}  ${code.slice(end)}`
      setCode(next)
      setDirty(true)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2 })
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      applyCode()
    }
  }

  return (
    <div className="inspector">
      <div className="insp-tabs">
        <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>属性</button>
        <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
          代码 {dirty && <span className="dot dirty" />}
        </button>
        <div className="spacer" />
        <span className="tiny muted mono">{layer.id}</span>
      </div>

      {tab === 'props' ? (
        <div className="insp-body">
          <div className="field">
            <label>图层名称</label>
            <input className="input" value={layer.name} onChange={e => editor.updateLayer(layer.id, { name: e.target.value }, { label: '改名' })} />
          </div>

          <div className="insp-row">
            <div className="field">
              <label>开始（秒）</label>
              <input
                className="input" type="number" step={0.1} min={0} max={editor.state.scene.canvas.duration}
                value={layer.start ?? 0}
                onChange={e => editor.updateLayer(layer.id, { start: Number(e.target.value) }, { label: '改开始时间' })}
              />
            </div>
            <div className="field">
              <label>结束（秒）</label>
              <input
                className="input" type="number" step={0.1} min={0} max={editor.state.scene.canvas.duration}
                value={layer.end ?? editor.state.scene.canvas.duration}
                onChange={e => editor.updateLayer(layer.id, { end: Number(e.target.value) }, { label: '改结束时间' })}
              />
            </div>
          </div>

          <div className="insp-row">
            <div className="field">
              <label>水平偏移</label>
              <input className="input" type="number" value={layer.x ?? 0} onChange={e => editor.updateLayer(layer.id, { x: Number(e.target.value) }, { label: '移动图层' })} />
            </div>
            <div className="field">
              <label>垂直偏移</label>
              <input className="input" type="number" value={layer.y ?? 0} onChange={e => editor.updateLayer(layer.id, { y: Number(e.target.value) }, { label: '移动图层' })} />
            </div>
          </div>

          <div className="field">
            <label>不透明度 <span className="mono">{Math.round((layer.opacity ?? 1) * 100)}%</span></label>
            <input
              className="range" type="range" min={0} max={1} step={0.01}
              value={layer.opacity ?? 1}
              onChange={e => editor.updateLayer(layer.id, { opacity: Number(e.target.value) }, { label: '改透明度' })}
            />
          </div>

          <div className="field">
            <label>混合模式</label>
            <select
              className="select"
              value={layer.blend ?? 'source-over'}
              onChange={e => editor.updateLayer(layer.id, { blend: e.target.value as SceneLayer['blend'] }, { label: '改混合模式' })}
            >
              <option value="source-over">正常</option>
              <option value="lighter">叠加发光（lighter）</option>
              <option value="screen">滤色（screen）</option>
              <option value="multiply">正片叠底（multiply）</option>
              <option value="overlay">叠加（overlay）</option>
            </select>
          </div>

          <div className="field">
            <label>备注（给 AI 的说明）</label>
            <textarea
              className="textarea" rows={2}
              value={layer.note ?? ''}
              placeholder="这个图层负责什么，方便后续修改时定位"
              onChange={e => editor.updateLayer(layer.id, { note: e.target.value }, { label: '改备注' })}
            />
          </div>

          <div className="insp-actions">
            <button className="btn sm" onClick={() => editor.updateLayer(layer.id, { visible: layer.visible === false }, { label: '切换可见' })}>
              {layer.visible === false ? '显示' : '隐藏'}
            </button>
            <button className="btn sm danger" onClick={() => editor.removeLayer(layer.id)}>删除图层</button>
          </div>
        </div>
      ) : (
        <div className="insp-code">
          <div className="code-toolbar">
            <span className="tiny muted">图层绘制代码 · Ctrl+Enter 应用</span>
            <div className="spacer" />
            {compiled.error && <span className="badge rose">语法错误</span>}
            <button className="btn sm primary" onClick={applyCode} disabled={!dirty}>应用</button>
          </div>
          {compiled.error && <div className="code-error">{compiled.error}</div>}
          <textarea
            ref={taRef}
            className="code-editor"
            value={code}
            spellCheck={false}
            onChange={e => { setCode(e.target.value); setDirty(true) }}
            onKeyDown={onKeyDown}
          />
          <details className="api-ref">
            <summary>可用 API 速查</summary>
            <pre>{API_REFERENCE}</pre>
          </details>
        </div>
      )}
    </div>
  )
}

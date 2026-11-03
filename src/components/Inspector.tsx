import { useEffect, useMemo, useRef, useState } from 'react'
import type { SceneLayer } from '../shared/scene'
import { KIND_LABEL, layerKind } from '../shared/scene'
import { useEditor } from '../state/editor'
import { compileLayer } from '../engine/render'
import { API_REFERENCE } from '../content/api-reference'

interface Props { layer: SceneLayer }

type Tab = 'props' | 'code'

export function Inspector({ layer }: Props) {
  const editor = useEditor()
  const kind = layerKind(layer)
  const [tab, setTab] = useState<Tab>(kind === 'code' ? 'props' : 'props')
  const [code, setCode] = useState(layer.draw ?? '')
  const [dirty, setDirty] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const duration = editor.state.scene.canvas.duration

  useEffect(() => {
    setCode(layer.draw ?? '')
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

  const patch = (p: Partial<SceneLayer>, label: string) => editor.updateLayer(layer.id, p, { label })

  return (
    <div className="inspector">
      <div className="insp-tabs">
        <button className={tab === 'props' ? 'on' : ''} onClick={() => setTab('props')}>属性</button>
        <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
          代码 {dirty && <span className="dot dirty" />}
        </button>
        <div className="spacer" />
        <span className="kind-pill">{KIND_LABEL[kind]}</span>
      </div>

      {tab === 'props' ? (
        <div className="insp-body">
          <div className="field">
            <label>名称</label>
            <input className="input" value={layer.name} onChange={e => patch({ name: e.target.value }, '改名')} />
          </div>

          {kind === 'text' && layer.text && (
            <div className="insp-section">
              <div className="insp-section-title">文字</div>
              <div className="field">
                <label>内容</label>
                <textarea
                  className="textarea" rows={3}
                  value={layer.text.content}
                  onChange={e => patch({ text: { ...layer.text!, content: e.target.value } }, '改文字')}
                />
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>字号</label>
                  <input className="input" type="number" min={4} max={400} value={layer.text.size}
                    onChange={e => patch({ text: { ...layer.text!, size: Number(e.target.value) || 48 } }, '改字号')} />
                </div>
                <div className="field">
                  <label>字重</label>
                  <select className="select" value={String(layer.text.weight ?? 600)}
                    onChange={e => patch({ text: { ...layer.text!, weight: Number(e.target.value) } }, '改字重')}>
                    {[300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>颜色</label>
                  <div className="color-row">
                    <input type="color" value={toHex(layer.text.color ?? '#e8eef2')}
                      onChange={e => patch({ text: { ...layer.text!, color: e.target.value } }, '改颜色')} />
                    <input className="input mono" value={layer.text.color ?? '#e8eef2'}
                      onChange={e => patch({ text: { ...layer.text!, color: e.target.value } }, '改颜色')} />
                  </div>
                </div>
                <div className="field">
                  <label>对齐</label>
                  <select className="select" value={layer.text.align ?? 'left'}
                    onChange={e => patch({ text: { ...layer.text!, align: e.target.value as 'left' | 'center' | 'right' } }, '改对齐')}>
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                </div>
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>行高</label>
                  <input className="input" type="number" step={0.05} min={0.8} max={3} value={layer.text.lineHeight ?? 1.35}
                    onChange={e => patch({ text: { ...layer.text!, lineHeight: Number(e.target.value) || 1.35 } }, '改行高')} />
                </div>
                <div className="field">
                  <label>底色（可选）</label>
                  <input className="input mono" placeholder="无" value={layer.text.background ?? ''}
                    onChange={e => patch({ text: { ...layer.text!, background: e.target.value || undefined } }, '改文字底色')} />
                </div>
              </div>
            </div>
          )}

          {kind === 'shape' && layer.shape && (
            <div className="insp-section">
              <div className="insp-section-title">形状</div>
              <div className="field">
                <label>类型</label>
                <select className="select" value={layer.shape.type}
                  onChange={e => patch({ shape: { ...layer.shape!, type: e.target.value as NonNullable<SceneLayer['shape']>['type'] } }, '改形状')}>
                  <option value="rect">矩形</option>
                  <option value="ellipse">椭圆</option>
                  <option value="triangle">三角形</option>
                  <option value="line">直线</option>
                  <option value="arrow">箭头</option>
                </select>
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>填充</label>
                  <div className="color-row">
                    <input type="color" value={toHex(layer.shape.fill ?? '#4fc3d9')}
                      onChange={e => patch({ shape: { ...layer.shape!, fill: e.target.value } }, '改填充')} />
                    <input className="input mono" value={layer.shape.fill ?? ''}
                      onChange={e => patch({ shape: { ...layer.shape!, fill: e.target.value || undefined } }, '改填充')} />
                  </div>
                </div>
                <div className="field">
                  <label>描边</label>
                  <div className="color-row">
                    <input type="color" value={toHex(layer.shape.stroke ?? '#000000')}
                      onChange={e => patch({ shape: { ...layer.shape!, stroke: e.target.value } }, '改描边')} />
                    <input className="input mono" placeholder="无" value={layer.shape.stroke ?? ''}
                      onChange={e => patch({ shape: { ...layer.shape!, stroke: e.target.value || undefined } }, '改描边')} />
                  </div>
                </div>
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>描边宽度</label>
                  <input className="input" type="number" min={0} max={80} value={layer.shape.strokeWidth ?? 0}
                    onChange={e => patch({ shape: { ...layer.shape!, strokeWidth: Number(e.target.value) || 0 } }, '改描边宽度')} />
                </div>
                <div className="field">
                  <label>圆角</label>
                  <input className="input" type="number" min={0} value={layer.shape.radius ?? 0}
                    onChange={e => patch({ shape: { ...layer.shape!, radius: Number(e.target.value) || 0 } }, '改圆角')} />
                </div>
              </div>
            </div>
          )}

          {kind === 'image' && layer.image && (
            <div className="insp-section">
              <div className="insp-section-title">图片</div>
              <div className="field">
                <label>文件</label>
                <div className="insp-inline">
                  <input className="input mono" value={layer.image.src} readOnly />
                  <button className="btn sm" onClick={async () => {
                    const picked = await window.gewu.pickImage()
                    if (!picked) return
                    const name = await savePickedImage(picked.name, picked.dataUrl)
                    if (name) patch({ image: { ...layer.image!, src: name } }, '换图片')
                  }}>更换</button>
                </div>
              </div>
              <div className="insp-row">
                <div className="field">
                  <label>填充方式</label>
                  <select className="select" value={layer.image.fit ?? 'stretch'}
                    onChange={e => patch({ image: { ...layer.image!, fit: e.target.value as 'stretch' | 'cover' | 'contain' } }, '改图片填充')}>
                    <option value="stretch">拉伸</option>
                    <option value="cover">铺满裁切</option>
                    <option value="contain">完整显示</option>
                  </select>
                </div>
                <div className="field">
                  <label>圆角</label>
                  <input className="input" type="number" min={0} value={layer.image.radius ?? 0}
                    onChange={e => patch({ image: { ...layer.image!, radius: Number(e.target.value) || 0 } }, '改图片圆角')} />
                </div>
              </div>
            </div>
          )}

          {kind === 'group' && (
            <div className="insp-section">
              <div className="insp-section-title">组合 · {(layer.children ?? []).length} 个元素</div>
              <div className="group-list">
                {(layer.children ?? []).map(kid => (
                  <button key={kid.id} className="group-item" onClick={() => editor.select(kid.id)}>
                    <span className="kind-pill tiny-pill">{KIND_LABEL[layerKind(kid)]}</span>
                    <span className="group-item-name">{kid.name}</span>
                  </button>
                ))}
              </div>
              <button className="btn sm" onClick={() => editor.ungroup(layer.id)}>解组（Ctrl+Shift+G）</button>
            </div>
          )}

          <div className="insp-section">
            <div className="insp-section-title">变换</div>
            <div className="insp-row">
              <div className="field">
                <label>X</label>
                <input className="input" type="number" value={Math.round(layer.x ?? 0)}
                  onChange={e => patch({ x: Number(e.target.value) || 0 }, '移动元素')} />
              </div>
              <div className="field">
                <label>Y</label>
                <input className="input" type="number" value={Math.round(layer.y ?? 0)}
                  onChange={e => patch({ y: Number(e.target.value) || 0 }, '移动元素')} />
              </div>
            </div>
            {kind !== 'code' && (
              <div className="insp-row">
                <div className="field">
                  <label>宽</label>
                  <input className="input" type="number" min={1} value={Math.round(layer.w ?? 0)}
                    onChange={e => patch({ w: Number(e.target.value) || 0 }, '改尺寸')} />
                </div>
                <div className="field">
                  <label>高</label>
                  <input className="input" type="number" min={1} value={Math.round(layer.h ?? 0)}
                    onChange={e => patch({ h: Number(e.target.value) || 0 }, '改尺寸')} />
                </div>
              </div>
            )}
            <div className="insp-row">
              <div className="field">
                <label>旋转（°）</label>
                <input className="input" type="number" step={1} value={layer.rotation ?? 0}
                  onChange={e => patch({ rotation: Number(e.target.value) || 0 }, '旋转元素')} />
              </div>
              <div className="field">
                <label>缩放</label>
                <input className="input" type="number" step={0.05} min={0.05} value={layer.scale ?? 1}
                  onChange={e => patch({ scale: Number(e.target.value) || 1 }, '缩放元素')} />
              </div>
            </div>
          </div>

          <div className="insp-section">
            <div className="insp-section-title">时间</div>
            <div className="insp-row">
              <div className="field">
                <label>开始（秒）</label>
                <input className="input" type="number" step={0.1} min={0} max={duration} value={layer.start ?? 0}
                  onChange={e => patch({ start: Number(e.target.value) }, '改开始时间')} />
              </div>
              <div className="field">
                <label>结束（秒）</label>
                <input className="input" type="number" step={0.1} min={0} max={duration} value={layer.end ?? duration}
                  onChange={e => patch({ end: Number(e.target.value) }, '改结束时间')} />
              </div>
            </div>
          </div>

          <div className="insp-section">
            <div className="insp-section-title">外观</div>
            <div className="field">
              <label>不透明度 <span className="mono">{Math.round((layer.opacity ?? 1) * 100)}%</span></label>
              <input className="range" type="range" min={0} max={1} step={0.01} value={layer.opacity ?? 1}
                onChange={e => patch({ opacity: Number(e.target.value) }, '改透明度')} />
            </div>
            <div className="field">
              <label>混合模式</label>
              <select className="select" value={layer.blend ?? 'source-over'}
                onChange={e => patch({ blend: e.target.value as SceneLayer['blend'] }, '改混合模式')}>
                <option value="source-over">正常</option>
                <option value="lighter">叠加发光（lighter）</option>
                <option value="screen">滤色（screen）</option>
                <option value="multiply">正片叠底（multiply）</option>
                <option value="overlay">叠加（overlay）</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>备注（给 AI 的说明）</label>
            <textarea className="textarea" rows={2} value={layer.note ?? ''}
              placeholder="这个元素负责什么，方便后续修改时定位"
              onChange={e => patch({ note: e.target.value }, '改备注')} />
          </div>

          <div className="insp-actions">
            <button className="btn sm" onClick={() => patch({ locked: !layer.locked }, '锁定元素')}>
              {layer.locked ? '解锁' : '锁定'}
            </button>
            <button className="btn sm" onClick={() => patch({ visible: layer.visible === false }, '显示/隐藏元素')}>
              {layer.visible === false ? '显示' : '隐藏'}
            </button>
            <button className="btn sm" onClick={() => editor.duplicate([layer.id])}>复制</button>
            <button className="btn sm danger" onClick={() => editor.removeLayer(layer.id)}>删除</button>
          </div>

          {kind === 'code' && (
            <div className="insp-split">
              <div className="insp-split-title">这个元素画死在代码里</div>
              <div className="tiny muted">
                拆成文字 / 形状 / 组合之后，就能在画布上单独拖动、改字、改色。
              </div>
              <button
                className="btn sm"
                onClick={() => {
                  void window.gewu.sendPrompt(
                    `把元素「${layer.name}」（id=${layer.id}）拆成可以单独编辑的元素组合：先调 scene_restructure 看拆分指引，` +
                    `再用 scene_set_layer 或 scene_write 重写这个元素——能写成 text / image / shape 的都用 typed 元素，` +
                    `只有动画部分留在 code 里，外层用 kind:"group" 收成一个组合。拆完用 scene_render_frame 渲染 ${editor.state.time.toFixed(1)}s 对比，画面应与现在一致。`,
                    { time: editor.state.time, selectedLayerId: layer.id }
                  )
                }}
              >
                让 AI 拆成组合
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="insp-code">
          <div className="code-toolbar">
            <span className="tiny muted">绘制代码 · Ctrl+Enter 应用</span>
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

async function savePickedImage(name: string, dataUrl: string): Promise<string | null> {
  const base64 = dataUrl.split(',')[1]
  if (!base64) return null
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0))
  const safe = name.replace(/[^\w.\-]+/g, '_')
  const res = await window.gewu.writeAsset(safe, bytes)
  if (!res.ok) return null
  return safe
}

function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return '#e8eef2'
}

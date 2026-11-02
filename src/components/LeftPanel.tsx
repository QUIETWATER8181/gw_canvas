import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import { QUICK_STARTS } from '../content/quickstarts'
import { keyframePrompt, referencePrompt } from '../content/prompts'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'start' | 'assets' | 'images'

interface PickedImage { name: string; dataUrl: string; path: string }

export function LeftPanel({ onToast }: Props) {
  const [tab, setTab] = useState<Tab>('start')
  const [refImages, setRefImages] = useState<PickedImage[]>([])
  const [first, setFirst] = useState<PickedImage | null>(null)
  const [last, setLast] = useState<PickedImage | null>(null)
  const [kfDuration, setKfDuration] = useState(6)
  const [kfNote, setKfNote] = useState('')
  const [assets, setAssets] = useState<{ name: string; path: string; size: number }[]>([])
  const editor = useEditor()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshAssets()
  }, [])

  async function refreshAssets() {
    try {
      setAssets(await window.gewu.listAssets())
    } catch {
      setAssets([])
    }
  }

  async function pickImage(slot?: 'first' | 'last') {
    const img = await window.gewu.pickImage()
    if (!img) return
    if (slot === 'first') setFirst(img)
    else if (slot === 'last') setLast(img)
    else {
      setRefImages(prev => [...prev, img])
      onToast({ text: `已加入参考图 ${img.name}`, kind: 'ok' })
    }
  }

  function sendPrompt(text: string) {
    void window.gewu.sendPrompt(text).catch(e => onToast({ text: String(e), kind: 'err' }))
  }

  function useRefImage(img: { name: string; path: string }) {
    sendPrompt(referencePrompt(img.name, img.path))
  }

  function buildKeyframe() {
    if (!first || !last) {
      onToast({ text: '首帧和尾帧都要选', kind: 'err' })
      return
    }
    sendPrompt(keyframePrompt({
      firstPath: first.path,
      lastPath: last.path,
      duration: kfDuration,
      note: kfNote,
      width: editor.state.scene.canvas.width,
      height: editor.state.scene.canvas.height
    }))
  }

  return (
    <aside className="left-panel">
      <div className="lp-tabs">
        <button className={tab === 'start' ? 'on' : ''} onClick={() => setTab('start')}>开始</button>
        <button className={tab === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>素材</button>
        <button className={tab === 'images' ? 'on' : ''} onClick={() => setTab('images')}>
          图生视频{first && last ? ' ●' : ''}
        </button>
      </div>

      <div className="lp-body">
        {tab === 'start' && (
          <>
            <div className="lp-section">
              <div className="lp-section-head">
                <span>快速开始</span>
                <span className="tiny muted">点一下，agent 直接开工</span>
              </div>
              <div className="qs-list">
                {QUICK_STARTS.map(q => (
                  <button key={q.id} className="qs-item" onClick={() => sendPrompt(q.prompt)}>
                    <span className="qs-glyph" aria-hidden>{q.glyph}</span>
                    <span className="qs-text">
                      <span className="qs-title">{q.title}</span>
                      <span className="qs-sub">{q.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-section">
              <div className="lp-section-head"><span>制作流程</span></div>
              <ol className="flow-list">
                <li><b>说清现象</b><span>讲哪个物理效应、给谁看、多长</span></li>
                <li><b>agent 写场景代码</b><span>每层一段绘制代码，可读可改</span></li>
                <li><b>画布上精修</b><span>选中图层改属性，或框选让 AI 重画</span></li>
                <li><b>导出</b><span>mp4，带配音与字幕</span></li>
              </ol>
            </div>
          </>
        )}

        {tab === 'assets' && (
          <div className="lp-section">
            <div className="lp-section-head">
              <span>工作区素材</span>
              <button className="btn sm" onClick={() => void window.gewu.importAsset().then(() => { void refreshAssets(); onToast({ text: '已导入', kind: 'ok' }) }).catch(e => onToast({ text: String(e), kind: 'err' }))}>
                导入
              </button>
            </div>
            {assets.length === 0 && <div className="lp-empty">还没有素材。导入图片或视频后，agent 可以用 <code>asset()</code> 引用。</div>}
            <div className="asset-grid">
              {assets.map(a => (
                <div key={a.path} className="asset-card">
                  <div className="asset-thumb" style={{ backgroundImage: /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name) ? `url("gewu://workspace/${a.path}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                  <div className="asset-name" title={a.name}>{a.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'images' && (
          <>
            <div className="lp-section">
              <div className="lp-section-head">
                <span>首尾帧补间</span>
                <span className="tiny muted">两张图 → 一段动画</span>
              </div>
              <div className="kf-slots">
                <button className={`kf-slot ${first ? 'filled' : ''}`} onClick={() => void pickImage('first')}>
                  {first
                    ? <><img src={first.dataUrl} alt={first.name} /><span className="kf-tag">首帧</span></>
                    : <><span className="kf-plus">＋</span><span className="kf-label">首帧</span></>}
                </button>
                <div className="kf-arrow" aria-hidden>→</div>
                <button className={`kf-slot ${last ? 'filled' : ''}`} onClick={() => void pickImage('last')}>
                  {last
                    ? <><img src={last.dataUrl} alt={last.name} /><span className="kf-tag">尾帧</span></>
                    : <><span className="kf-plus">＋</span><span className="kf-label">尾帧</span></>}
                </button>
              </div>
              <div className="kf-row">
                <label className="kf-field">
                  <span>时长</span>
                  <input
                    type="number" min={1} max={60} step={1}
                    value={kfDuration}
                    onChange={e => setKfDuration(Number(e.target.value))}
                  />
                  <span className="tiny muted">秒</span>
                </label>
                {(first || last) && (
                  <button className="link" onClick={() => { setFirst(null); setLast(null) }}>清空</button>
                )}
              </div>
              <input
                className="kf-note"
                placeholder="补充要求（可选）：镜头怎么动、要不要加标注…"
                value={kfNote}
                onChange={e => setKfNote(e.target.value)}
              />
              <button className="btn primary block" disabled={!first || !last} onClick={buildKeyframe}>
                补出中间过程
              </button>
              <div className="ref-hint">
                agent 会先「看」这两张图、算出主体位移，再决定是代码重建还是底图过渡。
              </div>
            </div>

            <div className="lp-section">
              <div className="lp-section-head">
                <span>单张参考图</span>
                <button className="btn sm" onClick={() => void pickImage()}>选择</button>
              </div>
              <div className="ref-hint">给一张风格或构图参考，agent 用代码还原，不一定要把原图放进画面。</div>
              <div className="ref-grid">
                {refImages.map(img => (
                  <div key={img.path} className="ref-card">
                    <img src={img.dataUrl} alt={img.name} />
                    <div className="ref-meta">
                      <span className="ref-name" title={img.name}>{img.name}</span>
                      <button className="btn sm primary" onClick={() => useRefImage(img)}>用它生成</button>
                    </div>
                  </div>
                ))}
              </div>
              {refImages.length === 0 && (
                <button className="ref-drop" onClick={() => void pickImage()}>
                  <span>＋</span>
                  <span>选择一张参考图</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" hidden />
          </>
        )}
      </div>

      <div className="lp-foot">
        <span className="tiny muted">场景文件</span>
        <button className="link" onClick={() => void window.gewu.revealPath(editor.state.scene.meta.title ? 'scene.json' : 'scene.json')}>scene.json</button>
      </div>
    </aside>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import { QUICK_STARTS } from '../content/quickstarts'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'start' | 'assets' | 'images'

export function LeftPanel({ onToast }: Props) {
  const [tab, setTab] = useState<Tab>('start')
  const [refImages, setRefImages] = useState<{ name: string; dataUrl: string; path: string }[]>([])
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

  async function pickImage() {
    const img = await window.gewu.pickImage()
    if (!img) return
    setRefImages(prev => [...prev, { name: img.name, dataUrl: img.dataUrl, path: img.path }])
    onToast({ text: `已加入参考图 ${img.name}`, kind: 'ok' })
  }

  function sendPrompt(text: string) {
    void window.gewu.sendPrompt(text).catch(e => onToast({ text: String(e), kind: 'err' }))
  }

  function useRefImage(img: { name: string; path: string }) {
    sendPrompt(
      `以我提供的参考图「${img.name}」（本地路径：${img.path}）为准，把它导入工作区并用代码还原成可动画的场景。\n` +
      `要求：\n1. 先用 asset_import 把图导入 assets/，再用 ctx.drawImage(asset('assets/xxx'), ...) 作为底图或元素。\n` +
      `2. 保持参考图的构图与配色，但把需要动的部分（箭头、光路、波形、粒子）拆成独立图层，用代码做动画。\n` +
      `3. 先给出一版 6–10 秒的场景，渲染一帧自检后告诉我效果。`
    )
  }

  return (
    <aside className="left-panel">
      <div className="lp-tabs">
        <button className={tab === 'start' ? 'on' : ''} onClick={() => setTab('start')}>开始</button>
        <button className={tab === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>素材</button>
        <button className={tab === 'images' ? 'on' : ''} onClick={() => setTab('images')}>参考图{refImages.length ? ` ${refImages.length}` : ''}</button>
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
          <div className="lp-section">
            <div className="lp-section-head">
              <span>参考图 / 首尾帧</span>
              <button className="btn sm" onClick={() => void pickImage()}>选择</button>
            </div>
            <div className="ref-hint">用于图生视频：上传首帧、尾帧或风格参考，agent 会用代码补出中间过程。</div>
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
            <input ref={fileRef} type="file" hidden />
          </div>
        )}
      </div>

      <div className="lp-foot">
        <span className="tiny muted">场景文件</span>
        <button className="link" onClick={() => void window.gewu.revealPath(editor.state.scene.meta.title ? 'scene.json' : 'scene.json')}>scene.json</button>
      </div>
    </aside>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import { QUICK_STARTS } from '../content/quickstarts'
import { keyframePrompt, referencePrompt } from '../content/prompts'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'start' | 'assets' | 'subs' | 'images'

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

  const isAudio = (name: string) => /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|webm)$/i.test(name)

  function addAudio(a: { name: string; path: string }) {
    const id = `vo_${Date.now().toString(36)}`
    const start = Number(editor.state.time.toFixed(2))
    editor.updateScene(
      s => ({ ...s, audio: [...s.audio, { id, name: a.name, src: a.path, start, volume: 1 }] }),
      { label: '加入音轨' }
    )
    onToast({ text: `已加到音轨，起点 ${start}s`, kind: 'ok' })
  }

  function patchAudio(id: string, patch: { start?: number; volume?: number }) {
    editor.updateScene(
      s => ({ ...s, audio: s.audio.map(t => (t.id === id ? { ...t, ...patch } : t)) }),
      { label: '调整音轨' }
    )
  }

  function removeAudio(id: string) {
    editor.updateScene(s => ({ ...s, audio: s.audio.filter(t => t.id !== id) }), { label: '删除音轨' })
  }

  function addSubtitle() {
    const start = Number(editor.state.time.toFixed(2))
    const end = Math.min(editor.state.scene.canvas.duration, start + 2.5)
    const id = `s_${Date.now().toString(36)}`
    editor.updateScene(
      s => ({ ...s, subtitles: [...s.subtitles, { id, start, end, text: '' }] }),
      { label: '新增字幕' }
    )
  }

  function patchSubtitle(id: string, patch: { start?: number; end?: number; text?: string }) {
    editor.updateScene(
      s => ({
        ...s,
        subtitles: s.subtitles.map(x => {
          if (x.id !== id) return x
          const next = { ...x, ...patch }
          // 起点不能超过终点
          if (next.end <= next.start) next.end = Math.min(s.canvas.duration, next.start + 0.5)
          return next
        })
      }),
      { label: '编辑字幕' }
    )
  }

  function removeSubtitle(id: string) {
    editor.updateScene(s => ({ ...s, subtitles: s.subtitles.filter(x => x.id !== id) }), { label: '删除字幕' })
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
        <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>
          字幕{editor.state.scene.subtitles.length ? ` ${editor.state.scene.subtitles.length}` : ''}
        </button>
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
          <>
            <div className="lp-section">
              <div className="lp-section-head">
                <span>工作区素材</span>
                <button className="btn sm" onClick={() => void window.gewu.importAsset().then(() => { void refreshAssets(); onToast({ text: '已导入', kind: 'ok' }) }).catch(e => onToast({ text: String(e), kind: 'err' }))}>
                  导入
                </button>
              </div>
              {assets.length === 0 && <div className="lp-empty">还没有素材。导入图片或音频后，agent 可以用 <code>asset()</code> 引用。</div>}
              <div className="asset-grid">
                {assets.map(a => (
                  <div key={a.path} className="asset-card">
                    <div className="asset-thumb" style={{ backgroundImage: /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name) ? `url("gewu://workspace/${a.path}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    <div className="asset-name" title={a.name}>{a.name}</div>
                    {isAudio(a.name) && (
                      <button className="asset-add" onClick={() => addAudio(a)} title="加到音轨（从播放头开始）">＋音轨</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="lp-section">
              <div className="lp-section-head">
                <span>音轨</span>
                <span className="tiny muted">导出时混进 mp4</span>
              </div>
              {editor.state.scene.audio.length === 0 && (
                <div className="lp-empty">还没有音轨。给素材点「＋音轨」加一条，或让 agent 调 <code>asset_import</code> 后自己写进场景。</div>
              )}
              <div className="track-list">
                {editor.state.scene.audio.map(t => (
                  <div key={t.id} className="track-row">
                    <div className="track-top">
                      <span className="track-name" title={t.src}>{t.name}</span>
                      <button className="link" onClick={() => removeAudio(t.id)}>删除</button>
                    </div>
                    <div className="track-ctl">
                      <label className="track-field">
                        <span>起点</span>
                        <input
                          type="number" min={0} step={0.1} value={t.start}
                          onChange={e => patchAudio(t.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                        />
                        <span className="tiny muted">s</span>
                      </label>
                      <label className="track-field grow">
                        <span>音量</span>
                        <input
                          type="range" min={0} max={1} step={0.01}
                          value={t.volume ?? 1}
                          onChange={e => patchAudio(t.id, { volume: Number(e.target.value) })}
                        />
                        <span className="tiny muted">{Math.round((t.volume ?? 1) * 100)}%</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'subs' && (
          <div className="lp-section">
            <div className="lp-section-head">
              <span>字幕</span>
              <button className="btn sm" onClick={addSubtitle}>＋ 从播放头加一条</button>
            </div>
            <div className="ref-hint">
              字幕直接画在画面底部，导出时一起烧进 mp4。点一条会跳到它的开始时刻。
            </div>
            {editor.state.scene.subtitles.length === 0 && (
              <div className="lp-empty">还没有字幕。把播放头停在要说话的位置，点上面的按钮。</div>
            )}
            <div className="sub-list">
              {editor.state.scene.subtitles.map(s => (
                <div key={s.id} className={`sub-row ${editor.state.time >= s.start && editor.state.time <= s.end ? 'on' : ''}`}>
                  <div className="sub-top">
                    <input
                      className="sub-text"
                      placeholder="字幕内容…"
                      value={s.text}
                      onChange={e => patchSubtitle(s.id, { text: e.target.value })}
                      onFocus={() => editor.setTime(s.start)}
                    />
                    <button className="link" onClick={() => removeSubtitle(s.id)}>删除</button>
                  </div>
                  <div className="sub-time">
                    <label className="track-field">
                      <span>起</span>
                      <input
                        type="number" min={0} step={0.1} value={s.start}
                        onChange={e => patchSubtitle(s.id, { start: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                    <button className="link" onClick={() => editor.setTime(s.start)}>跳到</button>
                    <label className="track-field">
                      <span>止</span>
                      <input
                        type="number" min={0} step={0.1} value={s.end}
                        onChange={e => patchSubtitle(s.id, { end: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </label>
                    <span className="tiny muted">{(s.end - s.start).toFixed(1)}s</span>
                  </div>
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

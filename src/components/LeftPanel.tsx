import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../state/editor'
import type { SceneLayer, ShapeType } from '../shared/scene'
import { nextLayerId } from '../shared/layers'
import { QUICK_STARTS } from '../content/quickstarts'
import { keyframePrompt, referencePrompt } from '../content/prompts'
import { DRAG_MIME } from './Timeline'
import { measureImage } from '../engine/assets'
import { AssetSearchPanel } from './AssetSearchPanel'
import { SfxPanel } from './SfxPanel'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

type Tab = 'start' | 'assets' | 'search' | 'audio' | 'subs' | 'images'

const RAIL: { id: Tab; label: string; title: string; icon: string }[] = [
  { id: 'start', label: '开始', title: '快速开始与制作流程', icon: '<path d="M12 3l2.6 5.6L21 9.6l-4.6 4.3L17.8 21 12 17.6 6.2 21l1.4-7.1L3 9.6l6.4-1z"/>' },
  { id: 'assets', label: '媒体', title: '工作区素材与手动添加', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="m21 15-4.5-4.5L9 18"/>' },
  { id: 'search', label: '搜索', title: '联网找图片/公式素材', icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/>' },
  { id: 'audio', label: '音频', title: '音效库、音轨与配音', icon: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>' },
  { id: 'subs', label: '字幕', title: '字幕与离线配音', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 14h5M14 14h3M7 10h10"/>' },
  { id: 'images', label: '图生', title: '首尾帧补间与参考图', icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>' }
]

interface PickedImage { name: string; dataUrl: string; path: string }

export function LeftPanel({ onToast }: Props) {
  const [tab, setTab] = useState<Tab>('start')
  const [refImages, setRefImages] = useState<PickedImage[]>([])
  const [first, setFirst] = useState<PickedImage | null>(null)
  const [last, setLast] = useState<PickedImage | null>(null)
  const [kfDuration, setKfDuration] = useState(6)
  const [kfNote, setKfNote] = useState('')
  const [assets, setAssets] = useState<{ name: string; path: string; size: number }[]>([])
  const [ttsVoices, setTtsVoices] = useState<{ name: string; culture: string }[]>([])
  const [ttsVoice, setTtsVoice] = useState('')
  const [ttsRate, setTtsRate] = useState(0)
  const [ttsBusy, setTtsBusy] = useState(false)
  const editor = useEditor()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshAssets()
    // 只取一次音色；失败就让用户用系统默认
    void window.gewu.ttsVoices().then(r => {
      if (!r.ok) return
      setTtsVoices(r.voices)
      const zh = r.voices.find(v => v.culture.toLowerCase().startsWith('zh'))
      setTtsVoice(zh?.name ?? r.voices[0]?.name ?? '')
    }).catch(() => undefined)
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

  /** 手动加一个文本元素（放在画面中心偏上） */
  function addTextLayer() {
    const scene = editor.state.scene
    const W = scene.canvas.width
    const H = scene.canvas.height
    const id = nextLayerId(scene, 'text')
    const layer: SceneLayer = {
      id,
      name: '文字',
      kind: 'text',
      x: Math.round(W * 0.15),
      y: Math.round(H * 0.4),
      w: Math.round(W * 0.7),
      h: 120,
      text: { content: '双击编辑文字', size: 72, weight: 700, color: scene.theme.fg, align: 'center', lineHeight: 1.35 },
      start: 0,
      end: scene.canvas.duration
    }
    editor.addLayer(layer)
    onToast({ text: '已添加文字，双击画面上的文字可直接编辑', kind: 'ok' })
  }

  /** 手动加一个形状元素 */
  function addShapeLayer(type: ShapeType) {
    const scene = editor.state.scene
    const W = scene.canvas.width
    const H = scene.canvas.height
    const id = nextLayerId(scene, type)
    const w = type === 'line' || type === 'arrow' ? 360 : 320
    const h = type === 'line' || type === 'arrow' ? 120 : 220
    const layer: SceneLayer = {
      id,
      name: type === 'rect' ? '矩形' : type === 'ellipse' ? '椭圆' : type === 'arrow' ? '箭头' : type === 'line' ? '直线' : '三角形',
      kind: 'shape',
      x: Math.round((W - w) / 2),
      y: Math.round((H - h) / 2),
      w,
      h,
      shape: { type, fill: type === 'line' || type === 'arrow' ? undefined : scene.theme.accent, stroke: scene.theme.accent, strokeWidth: 4, radius: type === 'rect' ? 12 : 0 },
      start: 0,
      end: scene.canvas.duration
    }
    editor.addLayer(layer)
    onToast({ text: '已添加形状，可在右侧属性里改颜色', kind: 'ok' })
  }

  async function addImageFromPicker() {
    const picked = await window.gewu.pickImage()
    if (!picked) return
    const base64 = picked.dataUrl.split(',')[1]
    if (!base64) return
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0))
    const safe = picked.name.replace(/[^\w.\-]+/g, '_')
    // 存进 assets/（不是 previews/），返回的 path 直接写进 image.src
    const res = await window.gewu.saveAsset(safe, bytes)
    if (!res.ok || !res.path) { onToast({ text: res.error ?? '保存图片失败', kind: 'err' }); return }
    await refreshAssets()
    const scene = editor.state.scene
    const size = await measureImage(res.path)
    let w = size?.width ?? 640
    let h = size?.height ?? 360
    const k = Math.min(1, (scene.canvas.width * 0.6) / w, (scene.canvas.height * 0.6) / h)
    w = Math.round(w * k)
    h = Math.round(h * k)
    const start = Number(editor.state.time.toFixed(2))
    const layer: SceneLayer = {
      id: nextLayerId(scene, 'img'),
      name: safe.replace(/\.[^.]+$/, ''),
      kind: 'image',
      x: Math.round((scene.canvas.width - w) / 2),
      y: Math.round((scene.canvas.height - h) / 2),
      w, h,
      image: { src: res.path, fit: 'stretch' },
      start,
      end: Math.min(scene.canvas.duration, start + 5) > start + 0.2 ? Math.min(scene.canvas.duration, start + 5) : scene.canvas.duration,
      enter: { kind: 'fade', dur: 0.4 }
    }
    editor.addLayer(layer)
    onToast({ text: '已添加图片', kind: 'ok' })
  }

  function patchAudio(id: string, patch: { start?: number; volume?: number }) {    editor.updateScene(
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

  /** 把一条字幕念出来，结果作为音轨挂到它的开始时刻 */
  async function dubOne(sub: { id: string; text: string; start: number; end: number }): Promise<boolean> {
    if (!sub.text.trim()) return false
    const res = await window.gewu.tts({ text: sub.text, name: `tts-${sub.id}`, voice: ttsVoice || undefined, rate: ttsRate })
    if (!res.ok || !res.path) {
      onToast({ text: res.error ?? '配音失败', kind: 'err' })
      return false
    }
    const dur = res.durationSec ?? 0
    editor.updateScene(s => {
      const track = { id: `vo-${sub.id}`, name: sub.text.slice(0, 14), src: res.path!, start: sub.start, volume: 1 }
      const exists = s.audio.some(t => t.id === track.id)
      // 语音比字幕长就把字幕拉长到念完为止（只延长，不缩短）
      const subtitles = dur > 0 && sub.start + dur > sub.end
        ? s.subtitles.map(x => (x.id === sub.id ? { ...x, end: Math.round((sub.start + dur) * 10) / 10 } : x))
        : s.subtitles
      return {
        ...s,
        subtitles,
        audio: exists ? s.audio.map(t => (t.id === track.id ? track : t)) : [...s.audio, track]
      }
    }, { label: '生成配音' })
    return true
  }

  async function dubAll() {
    const list = editor.state.scene.subtitles.filter(s => s.text.trim())
    if (!list.length) {
      onToast({ text: '字幕都是空的，先写点内容', kind: 'err' })
      return
    }
    setTtsBusy(true)
    let done = 0
    try {
      for (const s of list) {
        if (await dubOne(s)) done++
      }
      onToast({ text: done === list.length ? `已生成 ${done} 条配音` : `生成了 ${done}/${list.length} 条配音`, kind: done ? 'ok' : 'err' })
    } finally {
      setTtsBusy(false)
      void refreshAssets()
    }
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
      <nav className="lp-rail">
        {RAIL.map(item => (
          <button
            key={item.id}
            className={`lp-rail-btn ${tab === item.id ? 'on' : ''}`}
            onClick={() => setTab(item.id)}
            title={item.title}
          >
            <svg className="lp-rail-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: item.icon }} />
            <span>{item.label}</span>
            {item.id === 'subs' && editor.state.scene.subtitles.length > 0 && (
              <i className="lp-rail-badge">{editor.state.scene.subtitles.length}</i>
            )}
            {item.id === 'audio' && editor.state.scene.audio.length > 0 && (
              <i className="lp-rail-badge">{editor.state.scene.audio.length}</i>
            )}
          </button>
        ))}
      </nav>

      <div className="lp-main">
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
                  <div
                    key={a.path}
                    className="asset-card"
                    draggable
                    onDragStart={e => {
                      const kind = /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(a.name)
                        ? 'image'
                        : /\.(mp4|mov|webm|mkv)$/i.test(a.name)
                          ? 'video'
                          : /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a.name)
                            ? 'audio'
                            : 'other'
                      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ name: a.path, kind }))
                      e.dataTransfer.setData('text/plain', a.path)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    title="拖到画面或时间轴轨道上"
                  >
                    <div className="asset-thumb" style={{ backgroundImage: /\.(png|jpe?g|webp|gif|svg)$/i.test(a.name) ? `url("gewu://workspace/${a.path}")` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    <div className="asset-name" title={a.name}>{a.name}</div>
                    {isAudio(a.name) && (
                      <button className="asset-add" onClick={() => addAudio(a)} title="加到音轨（从播放头开始）">＋音轨</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="lp-tip">把素材拖到画面上 = 按原始比例摆到该位置；拖到时间轴轨道 = 从落点时间开始。</div>
            </div>

            <div className="lp-section">
              <div className="lp-section-head">
                <span>手动添加</span>
                <span className="tiny muted">不依赖 AI</span>
              </div>
              <div className="add-grid">
                <button className="btn sm" onClick={() => addTextLayer()}>＋ 文字</button>
                <button className="btn sm" onClick={() => addShapeLayer('rect')}>＋ 矩形</button>
                <button className="btn sm" onClick={() => addShapeLayer('ellipse')}>＋ 椭圆</button>
                <button className="btn sm" onClick={() => addShapeLayer('arrow')}>＋ 箭头</button>
                <button className="btn sm" onClick={() => addShapeLayer('line')}>＋ 直线</button>
                <button className="btn sm" onClick={() => void addImageFromPicker()}>＋ 图片</button>
              </div>
            </div>
          </>
        )}

        {tab === 'search' && <AssetSearchPanel onToast={onToast} />}

        {tab === 'audio' && (
          <>
            <SfxPanel onToast={onToast} />

            <div className="lp-section">
              <div className="lp-section-head">
                <span>音轨</span>
                <span className="tiny muted">导出时混进 mp4</span>
              </div>
              {editor.state.scene.audio.length === 0 && (
                <div className="lp-empty">还没有音轨。点上面的音效「＋」，或给媒体素材点「＋音轨」。</div>
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
            <div className="tts-bar">
              <button
                className="btn sm"
                onClick={() => void dubAll()}
                disabled={ttsBusy || !editor.state.scene.subtitles.some(s => s.text.trim())}
                title="用系统自带的中文语音把每条字幕念一遍，自动挂到对应时刻"
              >
                {ttsBusy ? '正在合成…' : '用字幕生成配音'}
              </button>
              {ttsVoices.length > 1 && (
                <select className="tts-voice" value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}>
                  {ttsVoices.map(v => (
                    <option key={v.name} value={v.name}>{v.name.replace('Microsoft ', '').replace(' Desktop', '')} · {v.culture}</option>
                  ))}
                </select>
              )}
              {ttsVoices.length === 1 && <span className="tiny muted">{ttsVoices[0].name.replace('Microsoft ', '').replace(' Desktop', '')}</span>}
              <select
                className="tts-rate"
                value={ttsRate}
                onChange={e => setTtsRate(Number(e.target.value))}
                title="语速：字幕条数多、总时长紧的时候调快一点"
              >
                <option value={-3}>0.8×</option>
                <option value={0}>1.0×</option>
                <option value={3}>1.3×</option>
                <option value={6}>1.6×</option>
              </select>
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
                    <button
                      className="link"
                      disabled={ttsBusy || !s.text.trim()}
                      onClick={() => { setTtsBusy(true); void dubOne(s).finally(() => { setTtsBusy(false); void refreshAssets() }) }}
                      title="念这一条"
                    >
                      🔊 配音
                    </button>
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
      </div>

      <div className="lp-foot">
        <span className="tiny muted">场景文件</span>
        <button className="link" onClick={() => void window.gewu.revealPath(editor.state.scene.meta.title ? 'scene.json' : 'scene.json')}>scene.json</button>
      </div>
    </aside>
  )
}

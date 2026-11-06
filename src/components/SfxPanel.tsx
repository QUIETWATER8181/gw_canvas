import { useEffect, useRef, useState } from 'react'
import { renderSfxWav, SFX_PRESETS, type SfxPreset } from '../shared/sfx'
import type { SceneAudio } from '../shared/scene'
import { layerKind } from '../shared/scene'
import { flatten } from '../shared/layers'
import { useEditor } from '../state/editor'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

const KIND_TO_SFX: Record<string, string> = {
  group: 'whoosh',
  text: 'pop',
  image: 'swoosh',
  shape: 'tick',
  code: 'whoosh'
}

/**
 * 音效库：全部现场合成（shared/sfx.ts），不需要联网、没有版权问题。
 * 「按图层入场铺音效」是一个默认配置方案：组合/代码→呼啸，文字→弹出，图片→轻扫，形状→滴答。
 * 用户还能逐条调音量和时间轴位置。
 */
export function SfxPanel({ onToast }: Props) {
  const editor = useEditor()
  const [busy, setBusy] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

  useEffect(() => () => {
    void audioRef.current?.close().catch(() => undefined)
    audioRef.current = null
  }, [])

  function ensureCtx(): AudioContext {
    if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new AudioContext()
    return audioRef.current
  }

  async function preview(preset: SfxPreset) {
    try {
      const { bytes } = renderSfxWav(preset.id)
      const ctx = ensureCtx()
      await ctx.resume()
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.value = 0.9
      src.connect(gain).connect(ctx.destination)
      src.start()
      setPlayingId(preset.id)
      src.onended = () => setPlayingId(id => (id === preset.id ? null : id))
    } catch (e) {
      onToast({ text: `试听失败：${e instanceof Error ? e.message : String(e)}`, kind: 'err' })
    }
  }

  async function addAtPlayhead(preset: SfxPreset) {
    if (busy) return
    setBusy(true)
    try {
      const at = Number(editor.state.time.toFixed(2))
      const track = await makeTrack(preset, at, 0.8)
      if (!track) throw new Error('写入音效文件失败')
      editor.updateScene(s => ({
        ...s,
        audio: [...s.audio.filter(a => a.id !== track.id), track]
      }), { label: '加音效' })
      onToast({ text: `已加入「${preset.label}」@ ${at.toFixed(2)}s`, kind: 'ok' })
    } catch (e) {
      onToast({ text: e instanceof Error ? e.message : String(e), kind: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function makeTrack(preset: SfxPreset, at: number, volume: number): Promise<SceneAudio | null> {
    const { bytes, duration } = renderSfxWav(preset.id)
    const saved = await window.gewu.saveAsset(`sfx-${preset.id}.wav`, bytes)
    if (!saved.ok || !saved.path) return null
    return {
      id: `sfx_${preset.id}_${Math.round(at * 100)}`,
      name: `${preset.label}（音效）`,
      src: saved.path,
      start: Math.max(0, at),
      dur: duration,
      volume,
      kind: 'sfx',
      fadeIn: Math.min(0.01, duration / 4),
      fadeOut: Math.min(0.06, duration / 3)
    }
  }

  /** 默认配置方案：给每个顶层图层的入场点配一条音效 */
  async function autoPlace() {
    if (busy) return
    setBusy(true)
    try {
      const scene = editor.state.scene
      const targets = flatten(scene.layers)
        .filter(f => f.depth === 0 && (f.layer.start ?? 0) > 0.01 && f.layer.visible !== false)
        .sort((a, b) => (a.layer.start ?? 0) - (b.layer.start ?? 0))
        .slice(0, 12)
      if (!targets.length) {
        onToast({ text: '没有找到「从中间开始」的顶层图层；先把素材拖到时间轴中段，或手动加音效', kind: 'info' })
        return
      }
      const tracks: SceneAudio[] = []
      for (const f of targets) {
        const preset = SFX_PRESETS.find(p => p.id === (KIND_TO_SFX[layerKind(f.layer)] ?? 'whoosh')) ?? SFX_PRESETS[0]
        const track = await makeTrack(preset, Number((f.layer.start ?? 0).toFixed(2)), 0.6)
        if (track) {
          // 同一时刻、同一预设可能撞 id，用图层 id 区分
          track.id = `sfx_${preset.id}_${f.layer.id}`
          tracks.push(track)
        }
      }
      editor.updateScene(s => {
        const ids = new Set(tracks.map(t => t.id))
        return { ...s, audio: [...s.audio.filter(a => !ids.has(a.id)), ...tracks] }
      }, { label: '按入场铺音效' })
      onToast({ text: `已给 ${tracks.length} 个入场点配上音效`, kind: 'ok' })
    } catch (e) {
      onToast({ text: e instanceof Error ? e.message : String(e), kind: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lp-section sfx-panel">
      <div className="lp-section-head">
        <span>音效库</span>
        <span className="tiny muted">现场合成 · 无版权</span>
      </div>
      <div className="sfx-actions">
        <button className="btn sm" disabled={busy} onClick={() => void autoPlace()} title="给每个顶层图层的入场点自动配一条音效">
          {busy ? '处理中…' : '按图层入场铺音效'}
        </button>
        <span className="tiny muted">音量默认 0.6–0.8，别盖过旁白</span>
      </div>
      {(['transition', 'ui', 'impact', 'music'] as const).map(cat => (
        <div key={cat} className="sfx-group">
          <div className="sfx-cat">{cat === 'transition' ? '转场' : cat === 'ui' ? '界面/元素' : cat === 'impact' ? '撞击' : '提示音'}</div>
          <div className="sfx-grid">
            {SFX_PRESETS.filter(p => p.category === cat).map(preset => (
              <div key={preset.id} className={`sfx-card ${playingId === preset.id ? 'playing' : ''}`}>
                <button className="sfx-play" onClick={() => void preview(preset)} title={`试听 ${preset.label}`}>
                  {playingId === preset.id ? '■' : '▶'}
                </button>
                <div className="sfx-info">
                  <span className="sfx-name">{preset.label}</span>
                  <span className="sfx-desc" title={preset.desc}>{preset.desc}</span>
                </div>
                <button className="sfx-add" disabled={busy} onClick={() => void addAtPlayhead(preset)} title="加到播放头位置">
                  ＋
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="ref-hint">
        音效会作为音轨出现在时间轴上，导出时混进 mp4。想跟画面节点对齐，就把音轨拖到对应图层的入场/退场时刻。
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { ExportFormat, ExportSettings } from '../shared/ipc'
import type { Scene } from '../shared/scene'

export interface ExportStartInput {
  dir: string
  name: string
  from?: number
  to?: number
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  quality?: 'high' | 'balanced' | 'small'
  reveal: boolean
  overwrite: boolean
}

interface Props {
  open: boolean
  scene: Scene
  draftName: string
  onClose(): void
  onStart(input: ExportStartInput): void
}

/** 渲染进程没有 path 模块，这里只处理 Windows 两种分隔符 */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

function splitPath(full: string): { dir: string; name: string } {
  const at = Math.max(full.lastIndexOf('\\'), full.lastIndexOf('/'))
  if (at < 0) return { dir: '', name: full }
  return { dir: full.slice(0, at), name: full.slice(at + 1) }
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const RESOLUTIONS: Record<ExportFormat['resolution'], { label: string; w?: number; h?: number }> = {
  source: { label: '跟随场景' },
  '4k': { label: '4K · 3840×2160', w: 3840, h: 2160 },
  '2k': { label: '2K · 2560×1440', w: 2560, h: 1440 },
  '1080p': { label: '1080p · 1920×1080', w: 1920, h: 1080 },
  '720p': { label: '720p · 1280×720', w: 1280, h: 720 },
  '480p': { label: '480p · 854×480', w: 854, h: 480 }
}
const DEFAULT_FORMAT: ExportFormat = { resolution: 'source', fps: 30, quality: 'balanced' }

function loadFormat(fps: number): ExportFormat {
  try {
    const raw = localStorage.getItem('gewu.exportFormat')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExportFormat>
      const resolution = parsed.resolution && parsed.resolution in RESOLUTIONS ? parsed.resolution : 'source'
      const nextFps = [24, 25, 30, 50, 60, 120, 150].includes(Number(parsed.fps)) ? Number(parsed.fps) : fps
      const quality = parsed.quality === 'high' || parsed.quality === 'small' || parsed.quality === 'custom'
        ? parsed.quality
        : 'balanced'
      return {
        resolution,
        fps: nextFps,
        quality,
        bitrateMbps: Number(parsed.bitrateMbps) > 0 ? Number(parsed.bitrateMbps) : undefined
      }
    }
  } catch { /* 坏数据就当没存过 */ }
  return { ...DEFAULT_FORMAT, fps }
}

/**
 * 导出对话框。
 * 和剪映/PR 一样：位置、文件名、范围都在这里一次定好，不用先点系统保存框再回来。
 * 记住上次的目录，也支持「以后都放这儿」。
 */
export function ExportDialog({ open, scene, draftName, onClose, onStart }: Props) {
  const [settings, setSettings] = useState<ExportSettings | null>(null)
  const [dir, setDir] = useState('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'all' | 'range'>('all')
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [reveal, setReveal] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fmt, setFmt] = useState<ExportFormat>(() => loadFormat(scene.canvas.fps))

  const duration = scene.canvas.duration
  const title = (scene.meta.title || draftName || 'physics-video').trim()
  const outW = RESOLUTIONS[fmt.resolution].w ?? scene.canvas.width
  const outH = RESOLUTIONS[fmt.resolution].h ?? scene.canvas.height
  const estBitrate = Math.min(120_000_000, fmt.quality === 'custom'
    ? Math.max(0.3, Number(fmt.bitrateMbps) || 8) * 1_000_000
    : Math.round(outW * outH * fmt.fps * (fmt.quality === 'high' ? 0.2 : fmt.quality === 'small' ? 0.06 : 0.12)))
  const estMB = (estBitrate * duration) / 8 / 1_000_000
  const heavy = outW * outH * fmt.fps > 1920 * 1080 * 60

  useEffect(() => {
    if (!open) return
    let alive = true
    setError('')
    setScope('all')
    setFrom(0)
    setTo(duration)
    setFmt(loadFormat(scene.canvas.fps))
    void (async () => {
      try {
        const s = await window.gewu.getExportSettings()
        if (!alive) return
        setSettings(s)
        if (s.forcedPath) {
          const split = splitPath(s.forcedPath)
          setDir(split.dir)
          setName(split.name)
        } else {
          setDir(s.resolvedDir)
          setName(`${title}.mp4`)
        }
        setReveal(s.revealAfterExport)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  async function pickFolder() {
    setBusy(true)
    try {
      const r = await window.gewu.chooseExportFolder({ defaultPath: dir })
      if (r.ok && r.dir) {
        setDir(r.dir)
        const s = await window.gewu.getExportSettings()
        setSettings(s)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function rememberHere() {
    try {
      const s = await window.gewu.setExportSettings({ dir })
      setSettings(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function useRecent(recent: string) {
    setDir(recent)
  }

  function start() {
    if (!dir.trim()) { setError('先选一个保存位置'); return }
    if (!name.trim()) { setError('文件名不能为空'); return }
    const range = scope === 'range'
      ? { from: Math.max(0, Math.min(duration, from)), to: Math.max(0, Math.min(duration, to)) }
      : {}
    if (scope === 'range' && (range.to ?? 0) - (range.from ?? 0) < 0.1) {
      setError('结束时间要比开始时间晚')
      return
    }
    localStorage.setItem('gewu.exportFormat', JSON.stringify(fmt))
    onStart({
      dir: dir.trim(),
      name: name.trim(),
      ...range,
      width: outW,
      height: outH,
      fps: fmt.fps,
      ...(fmt.quality === 'custom'
        ? { bitrate: Math.round(estBitrate) }
        : { quality: fmt.quality }),
      reveal,
      overwrite: Boolean(settings?.forcedPath)
    })
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal xdlg">
        <div className="modal-head">
          <div>
            <h2>导出视频</h2>
            <p className="tiny muted">位置和文件名都在这里定。导完可以直接打开所在文件夹。</p>
          </div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="xdlg-body">
          <div className="xdlg-field">
            <label>文件名</label>
            <div className="xdlg-name-row">
              <input
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') start() }}
                placeholder="physics-video.mp4"
              />
              <span className="xdlg-ext">MP4</span>
            </div>
          </div>

          <div className="xdlg-field">
            <div className="xdlg-label-row">
              <label>保存位置</label>
              <div className="xdlg-label-actions">
                <button className="link" onClick={() => void window.gewu.openFolder(dir)} disabled={!dir}>打开</button>
                <button className="link" onClick={() => void rememberHere()} disabled={!dir}>以后都放这里</button>
              </div>
            </div>
            <div className="xdlg-path">
              <span className="mono" title={dir}>{dir || '（还没选）'}</span>
              <button className="btn sm" onClick={() => void pickFolder()} disabled={busy}>
                {busy ? '选择中…' : '选择文件夹…'}
              </button>
            </div>
            <div className="xdlg-fullpath mono" title={joinPath(dir, name)}>{joinPath(dir, name)}</div>

            {settings && settings.recentDirs.length > 0 && (
              <div className="xdlg-recent">
                <span className="tiny muted">最近用过</span>
                {settings.recentDirs.slice(0, 5).map(d => (
                  <button
                    key={d}
                    className={`xdlg-chip ${d === dir ? 'on' : ''}`}
                    title={d}
                    onClick={() => void useRecent(d)}
                  >
                    {d.split(/[\\/]/).filter(Boolean).pop() ?? d}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="xdlg-field">
            <div className="xdlg-label-row">
              <label>导出范围</label>
              <span className="tiny muted">全片 {fmtDuration(duration)} · {scene.canvas.fps}fps · {scene.canvas.width}×{scene.canvas.height}</span>
            </div>
            <div className="xdlg-scope">
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>整段</button>
              <button className={scope === 'range' ? 'on' : ''} onClick={() => setScope('range')}>只导一段</button>
              {scope === 'range' && (
                <div className="xdlg-range">
                  <label>起 <input className="input" type="number" min={0} max={duration} step={0.1} value={from} onChange={e => setFrom(Number(e.target.value) || 0)} /></label>
                  <label>止 <input className="input" type="number" min={0} max={duration} step={0.1} value={to} onChange={e => setTo(Number(e.target.value) || 0)} /></label>
                  <span className="tiny muted">秒</span>
                </div>
              )}
            </div>
          </div>

          <div className="xdlg-field">
            <div className="xdlg-label-row">
              <label>画质与帧率</label>
              <span className="tiny muted">输出 {outW}×{outH} · {fmt.fps}fps · 约 {estMB.toFixed(1)}MB</span>
            </div>
            <div className="xdlg-format">
              <label>
                <span>清晰度</span>
                <select className="input" value={fmt.resolution} onChange={e => setFmt(f => ({ ...f, resolution: e.target.value as ExportFormat['resolution'] }))}>
                  {Object.entries(RESOLUTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </label>
              <label>
                <span>帧率</span>
                <select className="input" value={fmt.fps} onChange={e => setFmt(f => ({ ...f, fps: Number(e.target.value) }))}>
                  {[24, 25, 30, 50, 60, 120, 150].map(v => <option key={v} value={v}>{v} fps</option>)}
                </select>
              </label>
              <label>
                <span>码率</span>
                <select className="input" value={fmt.quality} onChange={e => setFmt(f => ({ ...f, quality: e.target.value as ExportFormat['quality'] }))}>
                  <option value="high">高（文件大）</option>
                  <option value="balanced">均衡</option>
                  <option value="small">小（省空间）</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
              {fmt.quality === 'custom' && (
                <label>
                  <span>Mbps</span>
                  <input
                    className="input"
                    type="number"
                    min={0.3}
                    max={120}
                    step={0.5}
                    value={fmt.bitrateMbps ?? 8}
                    onChange={e => setFmt(f => ({ ...f, bitrateMbps: Number(e.target.value) || 8 }))}
                  />
                </label>
              )}
            </div>
            <div className="ref-hint">
              清晰度只影响输出文件；场景仍按 1920×1080 设计坐标渲染，AI 写的坐标不会漂移。
              码率越高画面越干净，但文件也越大；文字多的科普片建议用「均衡」以上。
            </div>
            {heavy && (
              <div className="xdlg-warn">
                4K / 150fps 对显卡和编码器压力很大：4K 建议 ≤60fps，150fps 建议 ≤1080p。
                编码器不支持这个组合时会直接报错；可以缩短导出片段，或降一档再试。
              </div>
            )}
          </div>

          <label className="xdlg-check">
            <input type="checkbox" checked={reveal} onChange={e => setReveal(e.target.checked)} />
            <span>导出完成后在文件夹中显示</span>
          </label>

          <div className="xdlg-note">
            导出位置会记在设置里（设置 → 导出与保存）。agent 自己导出的成片也放到同一个目录，
            没设置过才落在当前草稿的 <code>exports/</code>。
          </div>

          {error && <div className="test-result err">{error}</div>}

          <div className="xdlg-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <span className="spacer" />
            <button className="btn primary xdlg-export" onClick={start}>开始导出</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 音效合成器（纯函数，主进程和渲染进程都能用）。
 *
 * 为什么不直接下载一堆 mp3？
 *  - 授权干净：全部现场合成，不涉及第三方素材许可；
 *  - 离线可用：不依赖网络，导出时直接混进 mp4；
 *  - 可调：时长/音高/亮度都是参数，AI 可以让音效跟着画面节奏变。
 *
 * 声音设计参考了 sfxr / jsfxr 的经典做法（噪声 + 扫频 + 包络），
 * 但这里是按物理科普视频的常见节点重新配的一套。
 */

export type SfxCategory = 'transition' | 'ui' | 'impact' | 'music'

export interface SfxPreset {
  id: string
  label: string
  category: SfxCategory
  /** 建议时长（秒） */
  duration: number
  desc: string
}

export const SFX_PRESETS: SfxPreset[] = [
  { id: 'whoosh', label: '呼啸', category: 'transition', duration: 0.55, desc: '画面/元素快速进场，空气扫过' },
  { id: 'swoosh', label: '轻扫', category: 'transition', duration: 0.35, desc: '比呼啸更短更轻，适合小元素' },
  { id: 'riser', label: '上升音', category: 'transition', duration: 1.8, desc: '悬念/蓄力，接下一个镜头' },
  { id: 'transition', label: '转场', category: 'transition', duration: 0.5, desc: '柔和的场景切换底噪' },
  { id: 'pop', label: '弹出', category: 'ui', duration: 0.14, desc: '标签、数据点出现' },
  { id: 'click', label: '点击', category: 'ui', duration: 0.06, desc: '按钮/选项' },
  { id: 'tick', label: '滴答', category: 'ui', duration: 0.04, desc: '计时、刻度、逐项出现' },
  { id: 'typing', label: '打字', category: 'ui', duration: 0.6, desc: '文字逐字出现' },
  { id: 'ding', label: '叮', category: 'music', duration: 1.2, desc: '结论、正确答案、重点' },
  { id: 'success', label: '完成', category: 'music', duration: 1.0, desc: '推导完成、章节收尾' },
  { id: 'error', label: '错误', category: 'music', duration: 0.6, desc: '否定、错误假设' },
  { id: 'impact', label: '撞击', category: 'impact', duration: 0.7, desc: '碰撞、爆炸、强调' }
]

export const SFX_BY_ID: Record<string, SfxPreset> = Object.fromEntries(SFX_PRESETS.map(p => [p.id, p]))

const RATE = 48000

/** 确定性噪声（同一个音效每次生成完全一样，导出可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

/** 指数衰减包络：attack 秒起音，之后按 tau 衰减 */
function envAD(t: number, attack: number, tau: number): number {
  if (t < 0) return 0
  if (t < attack) return t / attack
  return Math.exp(-(t - attack) / tau)
}

/** 正弦扫频：f0 → f1（指数插值），返回相位积分后的采样 */
function sweep(t: number, dur: number, f0: number, f1: number): number {
  const k = clamp01(t / Math.max(0.001, dur))
  // 相位 = ∫ 2π f dt，f 指数变化
  const ratio = Math.pow(f1 / f0, k)
  const phase = 2 * Math.PI * f0 * dur * ((ratio - 1) / Math.log(f1 / f0 || 1))
  return Math.sin(phase)
}

/** 简单带通噪声（两级一阶滤波，够用且稳定） */
function makeBandNoise(seed: number) {
  const rnd = mulberry32(seed)
  let lp = 0
  let bp = 0
  return (cutoff: number, q: number): number => {
    const f = 2 * Math.sin((Math.PI * Math.min(0.45, cutoff / RATE)) / Math.max(0.5, q))
    const n = rnd() * 2 - 1
    lp += f * (n - lp)
    const hp = n - lp - q * bp
    bp += f * hp
    return bp
  }
}

function presetSamples(id: string): { data: Float32Array; duration: number } {
  const preset = SFX_BY_ID[id] ?? SFX_BY_ID.whoosh
  const dur = preset.duration
  const n = Math.max(1, Math.round(dur * RATE))
  const out = new Float32Array(n)
  const noise = makeBandNoise(0x9e3779b9 ^ hash(id))

  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const k = t / dur
    let s = 0
    switch (preset.id) {
      case 'whoosh': {
        const cutoff = 220 + 2400 * Math.pow(Math.sin(Math.PI * clamp01(k)), 1.4)
        const body = noise(cutoff, 1.6) * Math.sin(Math.PI * clamp01(k)) ** 1.5
        s = body * 0.85 + Math.sin(2 * Math.PI * (180 + 60 * k) * t) * 0.08 * (1 - k)
        break
      }
      case 'swoosh': {
        const cutoff = 500 + 3200 * Math.pow(Math.sin(Math.PI * clamp01(k)), 2)
        s = noise(cutoff, 1.2) * Math.sin(Math.PI * clamp01(k)) ** 2 * 0.8
        break
      }
      case 'riser': {
        const f = 180 * Math.pow(9, k)
        const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * (3 + 10 * k) * t)
        s = (Math.sin(2 * Math.PI * f * t) * 0.35 + noise(300 + 5000 * k, 0.9) * 0.4) * Math.pow(k, 1.4) * trem
        break
      }
      case 'transition': {
        const cutoff = 300 + 1400 * Math.sin(Math.PI * clamp01(k))
        s = noise(cutoff, 1.0) * Math.sin(Math.PI * clamp01(k)) * 0.5 + Math.sin(2 * Math.PI * 90 * t) * 0.05
        break
      }
      case 'pop': {
        const f = 420 * Math.pow(0.35, clamp01(k))
        s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.035) * 0.8
        break
      }
      case 'click': {
        s = (noise(6000, 0.7) * 0.5 + Math.sin(2 * Math.PI * 2400 * t) * 0.3) * Math.exp(-t / 0.006)
        break
      }
      case 'tick': {
        s = noise(8000, 0.6) * Math.exp(-t / 0.004) * 0.6
        break
      }
      case 'typing': {
        // 5 个短促按键
        const step = 0.11
        const idx = Math.floor(t / step)
        const local = t - idx * step
        const on = idx < 5 ? Math.exp(-local / 0.012) : 0
        s = (noise(3000 + idx * 400, 0.7) * 0.4 + Math.sin(2 * Math.PI * 900 * local) * 0.1) * on
        break
      }
      case 'ding': {
        s = (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1320 * t) * 0.22 + Math.sin(2 * Math.PI * 1760 * t) * 0.1) * envAD(t, 0.004, 0.32)
        break
      }
      case 'success': {
        // C5-E5-G5-C6 琶音
        const notes = [523.25, 659.25, 783.99, 1046.5]
        const step = 0.16
        const idx = Math.min(3, Math.floor(t / step))
        const local = t - idx * step
        s = (Math.sin(2 * Math.PI * notes[idx] * local) * 0.4 + Math.sin(2 * Math.PI * notes[idx] * 2 * local) * 0.08) * envAD(local, 0.006, 0.22)
        break
      }
      case 'error': {
        const f = t < 0.22 ? 330 : 220
        const local = t < 0.22 ? t : t - 0.22
        s = (Math.sin(2 * Math.PI * f * local) * 0.32 + Math.sin(2 * Math.PI * f * 1.5 * local) * 0.12) * envAD(local, 0.005, 0.13)
        break
      }
      case 'impact': {
        const f = 70 * Math.pow(0.6, clamp01(k))
        s = (Math.sin(2 * Math.PI * f * t) * 0.7 + noise(1200, 0.8) * 0.35) * Math.exp(-t / 0.16)
        break
      }
      default:
        s = Math.sin(2 * Math.PI * 440 * t) * envAD(t, 0.01, 0.2)
    }
    // 软削波，避免爆音
    out[i] = Math.tanh(s * 1.2) * 0.85
  }
  return { data: out, duration: dur }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 生成 16-bit PCM 单声道 WAV 字节 */
export function renderSfxWav(id: string): { bytes: Uint8Array; duration: number } {
  const { data, duration } = presetSamples(id)
  return { bytes: encodeWav(data), duration }
}

export function encodeWav(samples: Float32Array, sampleRate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const writeStr = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let at = 44
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    at += 2
  }
  return bytes
}

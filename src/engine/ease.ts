import type { EaseFns, UtilFns } from './types'

export const ease: EaseFns = {
  linear: x => x,
  inQuad: x => x * x,
  outQuad: x => 1 - (1 - x) * (1 - x),
  inOutQuad: x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: x => x * x * x,
  outCubic: x => 1 - Math.pow(1 - x, 3),
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outBack: x => {
    const c1 = 1.70158, c3 = c1 + 1
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
  },
  outElastic: x => {
    const c4 = (2 * Math.PI) / 3
    return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
  },
  span(t, a, b) {
    if (b <= a) return t >= b ? 1 : 0
    return Math.max(0, Math.min(1, (t - a) / (b - a)))
  },
  pulse(t, a, b) {
    if (t <= a || t >= b) return 0
    const x = (t - a) / (b - a)
    return Math.sin(x * Math.PI)
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))

export const util: UtilFns = {
  clamp,
  lerp: (a, b, x) => a + (b - a) * x,
  map: (x, a, b, c, d) => c + ((x - a) / (b - a || 1)) * (d - c),
  deg: r => (r * 180) / Math.PI,
  rad: d => (d * Math.PI) / 180,
  rand(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
    return x - Math.floor(x)
  },
  wave: (t, freq, phase = 0) => Math.sin(2 * Math.PI * (freq * t + phase)),
  damped: (t, amp, omega, lambda, phase = 0) => amp * Math.exp(-lambda * t) * Math.cos(omega * t + phase),
  time(sec) {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
}

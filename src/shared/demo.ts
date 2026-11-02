import { emptyScene, type Scene } from './scene'

/**
 * 首次启动时写入的示例场景：偏振光与马吕斯定律。
 * 同时作为引擎自检用例——覆盖 g.text / g.math / g.glow / g.path / g.axes /
 * g.chip / g.with / g.arrow / 渐变光斑，以及逐帧确定性动画。
 */
export function demoScene(): Scene {
  const s = emptyScene('偏振光与马吕斯定律')
  s.canvas = { width: 1920, height: 1080, fps: 30, duration: 12 }
  s.meta.brief = '线偏振光通过转动的检偏器，透射光强按 I = I₀cos²θ 变化。'
  s.meta.style = '深色背景、青蓝主色、金色强调，矢量细线，3Blue1Brown 风格'
  s.layers = [
    {
      id: 'bg',
      name: '背景网格',
      note: '低调网格 + 顶部压暗，给画面一点纵深',
      draw: [
        `g.grid(120, 'rgba(27,38,50,0.5)')`,
        `const grd = ctx.createLinearGradient(0, 0, 0, height)`,
        `grd.addColorStop(0, 'rgba(13,17,23,0.0)')`,
        `grd.addColorStop(0.55, 'rgba(13,17,23,0.45)')`,
        `grd.addColorStop(1, 'rgba(13,17,23,0.9)')`,
        `ctx.save()`,
        `ctx.fillStyle = grd`,
        `ctx.fillRect(0, 0, width, height)`,
        `ctx.restore()`
      ].join('\n')
    },
    {
      id: 'title',
      name: '标题',
      start: 0,
      end: 12,
      draw: [
        `const a = ease.outCubic(ease.span(t, 0, 0.7))`,
        `g.text('偏振光与马吕斯定律', 120, 120, { size: 56, weight: 700, color: theme.fg, alpha: a })`,
        `g.text('一束光穿过两片偏振片，光强如何随夹角变化', 122, 172, { size: 26, color: theme.muted, alpha: a })`
      ].join('\n')
    },
    {
      id: 'bench',
      name: '光轴与器件',
      start: 0,
      end: 12,
      note: '水平光轴 + 光源底座',
      draw: [
        `const y0 = 470`,
        `g.line(110, y0, 1830, y0, { stroke: 'rgba(125,139,150,0.22)', width: 1.5, dash: [10, 12] })`,
        `g.circle(150, y0, 16, { fill: theme.accent2, alpha: 0.9 })`,
        `g.chip('光源', 150, y0 + 66, { size: 22, color: theme.muted, bg: 'rgba(255,255,255,0.05)', align: 'center' })`
      ].join('\n')
    },
    {
      id: 'source',
      name: '自然光',
      start: 0,
      end: 3.6,
      note: '两个正交偏振方向叠加，表示非偏振光',
      draw: [
        `const y0 = 470, x0 = 175, x1 = 700, amp = 42, ph = -t * 5`,
        `const a = 1 - ease.inOutQuad(ease.span(t, 2.9, 3.6)) * 0.85`,
        `const p1 = [], p2 = []`,
        `for (let x = x0; x <= x1; x += 5) {`,
        `  const k = (x - x0) * 0.03`,
        `  p1.push({ x, y: y0 - Math.sin(k + ph) * amp })`,
        `  p2.push({ x, y: y0 - Math.sin(k + ph + 1.7) * amp * 0.42 })`,
        `}`,
        `g.glow(p1, theme.accent, 2.4)`,
        `g.path(p2, { stroke: theme.accent2, width: 2.2, alpha: 0.8 * a })`,
        `g.text('自然光', x0, y0 - 118, { size: 26, color: theme.muted })`
      ].join('\n')
    },
    {
      id: 'polarizer',
      name: '起偏器',
      start: 0,
      end: 12,
      note: '固定竖直透光轴',
      draw: [
        `const x = 760, y0 = 470`,
        `const a = ease.outCubic(ease.span(t, 0.3, 1.1))`,
        `ctx.save(); ctx.globalAlpha = a`,
        `g.rect(x - 10, y0 - 152, 20, 304, { fill: 'rgba(79,195,217,0.14)', stroke: theme.accent, width: 2 })`,
        `g.arrow(x, y0 + 122, x, y0 - 122, { stroke: theme.accent, width: 3, head: 14 })`,
        `g.arrow(x, y0 - 122, x, y0 + 122, { stroke: theme.accent, width: 3, head: 14 })`,
        `g.chip('起偏器', x, y0 - 200, { size: 22, color: theme.accent, bg: 'rgba(79,195,217,0.12)', align: 'center' })`,
        `ctx.restore()`
      ].join('\n')
    },
    {
      id: 'light-pol',
      name: '线偏振光',
      start: 1.2,
      end: 12,
      note: '只剩竖直方向振动',
      draw: [
        `const y0 = 470, x0 = 782, x1 = 1258, amp = 42, ph = -t * 5`,
        `const a = ease.outCubic(ease.span(t, 1.2, 1.9))`,
        `ctx.save(); ctx.globalAlpha = a`,
        `const pts = []`,
        `for (let x = x0; x <= x1; x += 5) pts.push({ x, y: y0 - Math.sin((x - x0) * 0.03 + ph) * amp })`,
        `g.glow(pts, theme.accent, 2.6)`,
        `g.text('线偏振光', (x0 + x1) / 2, y0 - 118, { size: 24, color: theme.accent, align: 'center' })`,
        `ctx.restore()`
      ].join('\n')
    },
    {
      id: 'analyzer',
      name: '检偏器（转动）',
      start: 2.6,
      end: 12,
      note: '透光轴从 0° 转到 90°',
      draw: [
        `const x = 1280, y0 = 470`,
        `const th = 90 * ease.inOutCubic(ease.span(t, 3, 8))`,
        `const a = ease.outCubic(ease.span(t, 2.6, 3.2))`,
        `ctx.save(); ctx.globalAlpha = a`,
        `g.with({ x, y: y0, rotate: util.rad(th) }, () => {`,
        `  g.rect(-9, -152, 18, 304, { fill: 'rgba(242,181,68,0.14)', stroke: theme.accent2, width: 2 })`,
        `  g.arrow(0, 122, 0, -122, { stroke: theme.accent2, width: 3, head: 14 })`,
        `  g.arrow(0, -122, 0, 122, { stroke: theme.accent2, width: 3, head: 14 })`,
        `})`,
        `g.chip('检偏器 θ = ' + Math.round(th) + '°', x, y0 - 200, { size: 22, color: theme.accent2, bg: 'rgba(242,181,68,0.12)', align: 'center' })`,
        `ctx.restore()`
      ].join('\n')
    },
    {
      id: 'light-out',
      name: '透射光',
      start: 3,
      end: 12,
      note: '振幅 = cosθ，光强 = cos²θ',
      draw: [
        `const y0 = 470, x0 = 1302, x1 = 1742, ph = -t * 5`,
        `const th = 90 * ease.inOutCubic(ease.span(t, 3, 8))`,
        `const amp = 42 * Math.abs(Math.cos(util.rad(th)))`,
        `if (amp > 0.8) {`,
        `  const pts = []`,
        `  for (let x = x0; x <= x1; x += 5) pts.push({ x, y: y0 - Math.sin((x - x0) * 0.03 + ph) * amp })`,
        `  g.glow(pts, theme.accent2, 2.6)`,
        `}`
      ].join('\n')
    },
    {
      id: 'spot',
      name: '屏幕光斑',
      start: 3,
      end: 12,
      note: '亮度直接等于 I/I₀',
      draw: [
        `const x = 1782, y0 = 470`,
        `const th = 90 * ease.inOutCubic(ease.span(t, 3, 8))`,
        `const I = Math.pow(Math.cos(util.rad(th)), 2)`,
        `g.rect(x, y0 - 172, 14, 344, { fill: 'rgba(232,238,242,0.06)', stroke: 'rgba(232,238,242,0.2)', width: 1.5 })`,
        `if (I > 0.004) {`,
        `  ctx.save()`,
        `  ctx.globalAlpha = Math.min(1, 0.25 + I)`,
        `  const grd = ctx.createRadialGradient(x, y0, 2, x, y0, 130)`,
        `  grd.addColorStop(0, 'rgba(255,236,190,0.95)')`,
        `  grd.addColorStop(0.3, 'rgba(242,181,68,0.35)')`,
        `  grd.addColorStop(1, 'rgba(242,181,68,0)')`,
        `  ctx.fillStyle = grd`,
        `  ctx.beginPath(); ctx.arc(x, y0, 130, 0, Math.PI * 2); ctx.fill()`,
        `  ctx.restore()`,
        `}`,
        `g.text('屏幕', x, y0 + 214, { size: 24, color: theme.muted, align: 'center' })`
      ].join('\n')
    },
    {
      id: 'graph',
      name: 'I–θ 曲线',
      start: 6.4,
      end: 12,
      note: 'cos²θ 曲线与当前工作点',
      draw: [
        `const ax = 220, ay = 700, aw = 620, ah = 268`,
        `const a = ease.outCubic(ease.span(t, 6.4, 7.1))`,
        `ctx.save(); ctx.globalAlpha = a`,
        `const sx = v => ax + (v / 90) * aw`,
        `const sy = v => ay + ah - v * ah`,
        `g.axes({ x: ax, y: ay, w: aw, h: ah, xRange: [0, 90], yRange: [0, 1], xLabel: 'θ', yLabel: 'I / I₀', ticks: 6, grid: true, labelSize: 22 })`,
        `const pts = []`,
        `for (let d = 0; d <= 90; d += 1.5) pts.push({ x: sx(d), y: sy(Math.pow(Math.cos(util.rad(d)), 2)) })`,
        `g.path(pts, { stroke: theme.accent, width: 3 })`,
        `const th = 90 * ease.inOutCubic(ease.span(t, 3, 8))`,
        `const I = Math.pow(Math.cos(util.rad(th)), 2)`,
        `g.line(sx(th), sy(0), sx(th), sy(I), { stroke: theme.accent2, width: 1.5, dash: [6, 6], alpha: 0.85 })`,
        `g.line(sx(0), sy(I), sx(th), sy(I), { stroke: theme.accent2, width: 1.5, dash: [6, 6], alpha: 0.85 })`,
        `g.circle(sx(th), sy(I), 8, { fill: theme.accent2 })`,
        `g.text('θ / °', ax + aw, sy(0) + 34, { size: 22, color: theme.muted, align: 'right' })`,
        `ctx.restore()`
      ].join('\n')
    },
    {
      id: 'formula',
      name: '公式与数值',
      start: 0.6,
      end: 12,
      note: '马吕斯定律与实时读数',
      draw: [
        `const a = ease.outCubic(ease.span(t, 0.6, 1.4))`,
        `const th = 90 * ease.inOutCubic(ease.span(t, 3, 8))`,
        `const I = Math.pow(Math.cos(util.rad(th)), 2)`,
        `ctx.save(); ctx.globalAlpha = a`,
        `g.math('I = I_0\\\\cos^2\\\\theta', 1470, 760, { size: 60, color: theme.fg })`,
        `g.text('θ = ' + Math.round(th) + '°', 1470, 872, { size: 34, color: theme.accent2, align: 'center' })`,
        `g.text('I / I₀ = ' + I.toFixed(2), 1470, 932, { size: 34, color: theme.accent, align: 'center' })`,
        `g.text('θ = 45° 时 I = I₀ / 2', 1470, 1000, { size: 24, color: theme.muted, align: 'center' })`,
        `ctx.restore()`
      ].join('\n')
    }
  ]
  return s
}

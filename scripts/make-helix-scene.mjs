// 生成「带电粒子在匀强磁场中的螺旋运动」3D 场景，写入工作区 scene.json
// 用法：node _make-helix.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const workspace = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'gewu-video', 'workspace')

const theme = {
  bg: '#0d1117', fg: '#e8eef2', muted: '#7d8b96',
  accent: '#4fc3d9', accent2: '#f2b544', accent3: '#e06c75', grid: '#1b2632'
}

const helixDraw = [
  'const R = 0.9, w = 1.6, vy = 0.2, y0 = -1.2, ph = -Math.PI / 2',
  'const at = (tt) => [R * Math.cos(w * tt + ph), y0 + vy * tt, R * Math.sin(w * tt + ph)]',
  'const s = three.scene({ pos: [5.2, 3.3, 6.4], look: [0, 0.05, 0], fov: 40 })',
  'for (const pos of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {',
  '  three.arrow(s, [pos[0], -1.0, pos[1]], [pos[0], 1.0, pos[1]], { color: "#26485a" })',
  '}',
  'three.label(s, [1.5, 1.2, 1.5], "B", { color: theme.accent, size: 0.3 })',
  'if (t > 0.06) {',
  '  const pts = []',
  '  const steps = 180',
  '  for (let i = 0; i <= steps; i++) pts.push(at(t * i / steps))',
  '  three.tube(s, pts, 0.022, { color: theme.accent2 })',
  '}',
  'const p0 = at(t)',
  'const p1 = at(t + 0.02)',
  'const k = 0.22',
  'three.arrow(s, p0, [p0[0] + (p1[0] - p0[0]) / 0.02 * k, p0[1] + (p1[1] - p0[1]) / 0.02 * k, p0[2] + (p1[2] - p0[2]) / 0.02 * k], { color: theme.accent3 })',
  'three.sphere(s, p0, 0.085, { color: theme.accent2 })',
  'three.axes(s, { size: 1.2 })',
  'three.render(s)'
].join('\n')

const scene = {
  version: 1,
  meta: {
    title: '带电粒子在匀强磁场中的螺旋运动',
    brief: '速度垂直磁场分量绕 B 转圈，平行分量匀速前进，合成螺旋线。',
    style: '深色底 + 3D 立体光路，青蓝磁场、金色轨迹、红色速度矢量'
  },
  canvas: { width: 1920, height: 1080, fps: 30, duration: 12 },
  theme,
  layers: [
    {
      id: 'bg',
      name: '背景',
      start: 0,
      end: 12,
      note: '深色渐变打底',
      draw: [
        'const grd = ctx.createLinearGradient(0, 0, 0, height)',
        'grd.addColorStop(0, "#111a24")',
        'grd.addColorStop(1, "#080b10")',
        'ctx.fillStyle = grd',
        'ctx.fillRect(0, 0, width, height)'
      ].join('\n')
    },
    {
      id: 'helix3d',
      name: '3D 螺旋轨迹',
      start: 0,
      end: 12,
      y: 80,
      note: 'three.js：磁场箭头 + 螺旋管 + 粒子 + 速度矢量 + 坐标轴',
      draw: helixDraw
    },
    {
      id: 'title',
      name: '标题',
      start: 0,
      end: 12,
      note: '左上角标题与一句话解释',
      draw: [
        'const a = ease.outCubic(ease.span(t, 0.4, 1.2))',
        'ctx.globalAlpha = a',
        'g.text("带电粒子在匀强磁场中的螺旋运动", 110, 120, { size: 50, weight: 700, color: theme.fg })',
        'g.text("垂直分量绕 B 转圈，平行分量匀速前进", 112, 172, { size: 24, color: theme.muted })',
        'ctx.globalAlpha = 1'
      ].join('\n')
    },
    {
      id: 'formula',
      name: '公式',
      start: 0,
      end: 12,
      note: '回旋半径与螺距',
      draw: [
        'const a = ease.outCubic(ease.span(t, 1.0, 1.8))',
        'ctx.globalAlpha = a',
        'g.math("r = \\\\frac{m v_\\\\perp}{qB}", 1500, 840, { size: 46, color: theme.fg })',
        'g.math("h = v_\\\\parallel \\\\frac{2\\\\pi m}{qB}", 1500, 950, { size: 42, color: theme.accent })',
        'ctx.globalAlpha = 1'
      ].join('\n')
    },
    {
      id: 'readout',
      name: '实时读数',
      start: 0,
      end: 12,
      note: '已完成的圈数',
      draw: [
        'const turns = (1.6 * t) / (2 * Math.PI)',
        'const a = ease.outCubic(ease.span(t, 0.8, 1.6))',
        'ctx.globalAlpha = a',
        'g.chip("已转 " + turns.toFixed(2) + " 圈", 110, 980, { size: 24, color: theme.accent2, bg: "rgba(242,181,68,0.10)" })',
        'ctx.globalAlpha = 1'
      ].join('\n')
    }
  ],
  audio: [],
  subtitles: []
}

mkdirSync(workspace, { recursive: true })
const out = join(workspace, 'scene.json')
writeFileSync(out, JSON.stringify(scene, null, 2), 'utf8')
console.log('[helix] wrote', out, JSON.stringify(scene).length, 'bytes')

import type {
  ArrowOpts, AxesOpts, Ctx2D, DrawKit, FillStroke, StrokeOpts, TextOpts, Vec
} from './types'
import type { SceneTheme } from '../shared/scene'
import { drawMath } from './math'
import { imageFor } from './assets'

const UI_FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif'
const MATH_FONT = '"Cambria Math", "Latin Modern Math", "Times New Roman", serif'

export interface KitOptions {
  width: number
  height: number
  theme: SceneTheme
  ctx: Ctx2D
}

export function createDrawKit(o: KitOptions): DrawKit {
  const { ctx, theme } = o
  const W = o.width
  const H = o.height

  const applyFillStroke = (opts: FillStroke = {}) => {
    ctx.save()
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha
    if (opts.shadow) { ctx.shadowColor = opts.shadow; ctx.shadowBlur = opts.shadowBlur ?? 18 }
    if (opts.dash) ctx.setLineDash(opts.dash)
    ctx.lineWidth = opts.width ?? 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (opts.fill) { ctx.fillStyle = opts.fill; ctx.fill() }
    if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.stroke() }
    ctx.restore()
  }

  const strokeOnly = (opts: StrokeOpts = {}) => {
    ctx.save()
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha
    if (opts.shadow) { ctx.shadowColor = opts.shadow; ctx.shadowBlur = opts.shadowBlur ?? 18 }
    if (opts.dash) ctx.setLineDash(opts.dash)
    ctx.lineWidth = opts.width ?? 3
    ctx.lineCap = opts.cap ?? 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = opts.stroke ?? theme.fg
    ctx.stroke()
    ctx.restore()
  }

  const kit: DrawKit = {
    clear(color) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = 1
      ctx.fillStyle = color ?? theme.bg
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.restore()
    },

    roundRect(x, y, w, h, r) {
      const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + w, y, x + w, y + h, rr)
      ctx.arcTo(x + w, y + h, x, y + h, rr)
      ctx.arcTo(x, y + h, x, y, rr)
      ctx.arcTo(x, y, x + w, y, rr)
      ctx.closePath()
    },

    rect(x, y, w, h, opts = {}) {
      ctx.beginPath()
      if (opts.width && opts.width > 0) kit.roundRect(x, y, w, h, Math.min(12, Math.abs(w) / 8))
      else ctx.rect(x, y, w, h)
      applyFillStroke(opts)
    },

    circle(x, y, r, opts = {}) {
      ctx.beginPath()
      ctx.arc(x, y, Math.abs(r), 0, Math.PI * 2)
      applyFillStroke(opts)
    },

    line(x1, y1, x2, y2, opts = {}) {
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      strokeOnly(opts)
    },

    arrow(x1, y1, x2, y2, opts = {}) {
      const head = opts.head ?? Math.max(10, (opts.width ?? 3) * 4)
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const bx = x2 - Math.cos(ang) * head * 0.85
      const by = y2 - Math.sin(ang) * head * 0.85
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(bx, by)
      strokeOnly(opts)
      ctx.save()
      if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha
      if (opts.shadow) { ctx.shadowColor = opts.shadow; ctx.shadowBlur = opts.shadowBlur ?? 18 }
      ctx.fillStyle = opts.fill ?? opts.stroke ?? theme.fg
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - Math.cos(ang - 0.42) * head, y2 - Math.sin(ang - 0.42) * head)
      ctx.lineTo(x2 - Math.cos(ang + 0.42) * head, y2 - Math.sin(ang + 0.42) * head)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    },

    dim(x1, y1, x2, y2, label, opts = {}) {
      const off = opts.offset ?? 0
      const nx = -(y2 - y1)
      const ny = x2 - x1
      const len = Math.hypot(nx, ny) || 1
      const ox = (nx / len) * off
      const oy = (ny / len) * off
      kit.arrow(x1 + ox, y1 + oy, x2 + ox, y2 + oy, { width: 2, ...opts })
      kit.arrow(x2 + ox, y2 + oy, x1 + ox, y1 + oy, { width: 2, ...opts })
      if (label) {
        kit.text(label, (x1 + x2) / 2 + ox, (y1 + y2) / 2 + oy, {
          size: opts.width ? opts.width * 7 : 22,
          color: opts.stroke ?? theme.muted,
          align: 'center',
          baseline: 'middle'
        })
      }
    },

    path(points, opts = {}) {
      if (!points.length) return
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
      if (opts.close) ctx.closePath()
      applyFillStroke({ fill: opts.fill, stroke: opts.stroke ?? theme.fg, width: opts.width, dash: opts.dash, alpha: opts.alpha, shadow: opts.shadow, shadowBlur: opts.shadowBlur })
    },

    plot(fn, x0, x1, opts = {}) {
      const step = opts.step ?? 2
      const pts: Vec[] = []
      for (let x = x0; x <= x1; x += step) pts.push({ x, y: fn(x) })
      kit.path(pts, opts)
    },

    text(s, x, y, opts = {}) {
      const size = opts.size ?? 32
      ctx.save()
      ctx.globalAlpha *= opts.alpha ?? 1
      ctx.fillStyle = opts.color ?? theme.fg
      const weight = opts.weight ?? 400
      ctx.font = `${weight} ${size}px ${opts.font ?? UI_FONT}`
      ctx.textAlign = opts.align ?? 'left'
      ctx.textBaseline = opts.baseline ?? 'alphabetic'
      if (opts.letterSpacing && 'letterSpacing' in ctx) {
        ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${opts.letterSpacing}px`
      }
      if (opts.maxWidth) ctx.fillText(s, x, y, opts.maxWidth)
      else ctx.fillText(s, x, y)
      ctx.restore()
    },

    math(tex, x, y, opts = {}) {
      ctx.save()
      ctx.globalAlpha *= opts.alpha ?? 1
      drawMath(ctx, tex, x, y, {
        size: opts.size ?? 40,
        color: opts.color ?? theme.fg,
        font: MATH_FONT,
        italicFont: MATH_FONT
      }, opts.align ?? 'center')
      ctx.restore()
    },

    chip(s, x, y, opts = {}) {
      const size = opts.size ?? 26
      ctx.save()
      ctx.font = `${opts.weight ?? 500} ${size}px ${opts.font ?? UI_FONT}`
      const w = ctx.measureText(s).width
      const pad = opts.pad ?? 14
      const h = size * 1.9
      const align = opts.align ?? 'left'
      const bx = align === 'center' ? x - w / 2 - pad : align === 'right' ? x - w - pad * 2 : x
      ctx.fillStyle = opts.bg ?? 'rgba(255,255,255,0.07)'
      kit.roundRect(bx, y - h / 2, w + pad * 2, h, h / 2)
      ctx.fill()
      ctx.fillStyle = opts.color ?? theme.fg
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(s, bx + pad, y + 1)
      ctx.restore()
    },

    axes(a: AxesOpts) {
      const [x0, x1] = a.xRange ?? [0, 1]
      const [y0, y1] = a.yRange ?? [0, 1]
      const color = a.color ?? theme.muted
      const sx = (v: number) => a.x + ((v - x0) / (x1 - x0)) * a.w
      const sy = (v: number) => a.y + a.h - ((v - y0) / (y1 - y0)) * a.h
      if (a.grid) {
        const n = a.ticks ?? 5
        ctx.save()
        ctx.strokeStyle = theme.grid
        ctx.lineWidth = 1
        for (let i = 0; i <= n; i++) {
          const vx = sx(x0 + ((x1 - x0) * i) / n)
          const vy = sy(y0 + ((y1 - y0) * i) / n)
          ctx.beginPath(); ctx.moveTo(vx, a.y); ctx.lineTo(vx, a.y + a.h); ctx.stroke()
          ctx.beginPath(); ctx.moveTo(a.x, vy); ctx.lineTo(a.x + a.w, vy); ctx.stroke()
        }
        ctx.restore()
      }
      const zeroY = sy(Math.max(y0, Math.min(y1, 0)))
      const zeroX = sx(Math.max(x0, Math.min(x1, 0)))
      kit.arrow(a.x, zeroY, a.x + a.w, zeroY, { width: 2, stroke: color, head: 12 })
      kit.arrow(zeroX, a.y + a.h, zeroX, a.y, { width: 2, stroke: color, head: 12 })
      if (a.xLabel) kit.text(a.xLabel, a.x + a.w, zeroY + 30, { size: a.labelSize ?? 24, color, align: 'right' })
      if (a.yLabel) kit.text(a.yLabel, zeroX - 14, a.y + 6, { size: a.labelSize ?? 24, color, align: 'right' })
      if (a.ticks) {
        const n = a.ticks
        for (let i = 0; i <= n; i++) {
          const vx = sx(x0 + ((x1 - x0) * i) / n)
          kit.line(vx, zeroY - 5, vx, zeroY + 5, { stroke: color, width: 1.5 })
          const vy = sy(y0 + ((y1 - y0) * i) / n)
          kit.line(zeroX - 5, vy, zeroX + 5, vy, { stroke: color, width: 1.5 })
        }
      }
    },

    vector(x, y, dx, dy, opts = {}) {
      kit.arrow(x, y, x + dx, y + dy, opts)
      if (opts.label) {
        const nx = -dy, ny = dx
        const len = Math.hypot(nx, ny) || 1
        kit.text(opts.label, x + dx + (nx / len) * 22, y + dy + (ny / len) * 22, {
          size: 24, color: opts.stroke ?? theme.fg, align: 'center', baseline: 'middle'
        })
      }
    },

    dots(points, r, color) {
      ctx.save()
      ctx.fillStyle = color
      for (const p of points) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill() }
      ctx.restore()
    },

    grid(step = 80, color) {
      ctx.save()
      ctx.strokeStyle = color ?? theme.grid
      ctx.lineWidth = 1
      for (let x = 0; x <= W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
      for (let y = 0; y <= H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
      ctx.restore()
    },

    glow(points, color, width = 3) {
      if (points.length < 2) return
      ctx.save()
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      for (const [w, a] of [[width * 7, 0.06], [width * 3.4, 0.14], [width, 1]] as const) {
        ctx.globalAlpha = a
        ctx.lineWidth = w
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
        ctx.stroke()
      }
      ctx.restore()
    },

    sineWave(x0, x1, y0, amp, cycles, phase, opts = {}) {
      const pts: Vec[] = []
      const n = Math.max(40, Math.round((x1 - x0) / 2))
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n
        const th = ((x - x0) / (x1 - x0)) * Math.PI * 2 * cycles + phase
        pts.push({ x, y: y0 - Math.sin(th) * amp })
      }
      kit.path(pts, opts)
    },

    save() { ctx.save() },
    restore() { ctx.restore() },

    clip(x, y, w, h, fn) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      try { fn() } finally { ctx.restore() }
    },

    with(transform, fn) {
      ctx.save()
      if (transform.x || transform.y) ctx.translate(transform.x ?? 0, transform.y ?? 0)
      if (transform.rotate) ctx.rotate(transform.rotate)
      if (transform.scale) ctx.scale(transform.scale, transform.scale)
      try { fn() } finally { ctx.restore() }
    },

    image(name, x, y, w, h, opts = {}) {
      const entry = imageFor(name)
      if (!entry) {
        // 没加载好就画一个虚线占位，别让整帧空白得莫名其妙
        const pw = w ?? 240
        const ph = h ?? 160
        ctx.save()
        ctx.globalAlpha = 0.5
        ctx.setLineDash([8, 6])
        ctx.strokeStyle = theme.muted
        ctx.lineWidth = 2
        ctx.strokeRect(x - pw / 2, y - ph / 2, pw, ph)
        ctx.restore()
        return
      }
      const iw = entry.width
      const ih = entry.height
      ctx.save()
      if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha
      if (opts.grayscale) ctx.filter = `grayscale(${Math.round(opts.grayscale * 100)}%)`

      const dw = w ?? iw
      const dh = h ?? ih
      const dx = x - dw / 2
      const dy = y - dh / 2

      const doDraw = () => {
        if (opts.fit === 'cover') {
          // 按比例铺满，超出部分裁掉
          const s = Math.max(dw / iw, dh / ih)
          const cw = iw * s
          const ch = ih * s
          ctx.beginPath()
          ctx.rect(dx, dy, dw, dh)
          ctx.clip()
          ctx.drawImage(entry.el, x - cw / 2, y - ch / 2, cw, ch)
        } else if (opts.fit === 'contain') {
          const s = Math.min(dw / iw, dh / ih)
          ctx.drawImage(entry.el, x - (iw * s) / 2, y - (ih * s) / 2, iw * s, ih * s)
        } else {
          ctx.drawImage(entry.el, dx, dy, dw, dh)
        }
      }

      if (opts.radius) {
        const r = Math.min(opts.radius, dw / 2, dh / 2)
        ctx.beginPath()
        ctx.moveTo(dx + r, dy)
        ctx.arcTo(dx + dw, dy, dx + dw, dy + dh, r)
        ctx.arcTo(dx + dw, dy + dh, dx, dy + dh, r)
        ctx.arcTo(dx, dy + dh, dx, dy, r)
        ctx.arcTo(dx, dy, dx + dw, dy, r)
        ctx.closePath()
        ctx.clip()
      }
      doDraw()
      ctx.restore()
    }
  }
  return kit
}

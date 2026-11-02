import type { Ctx2D } from './types'

/**
 * 轻量 TeX 子集渲染器：不依赖任何外部库，直接把常见数学记号画到 canvas 上。
 * 支持：上下标、\frac、\sqrt、\vec/\hat/\bar、希腊字母、常用运算符、
 * \text{}、\left( \right)、\sum \int \cdot \times \pm \approx 等。
 * 目标是「3b1b 风格公式」够用，不是完整 LaTeX。
 */

type Node =
  | { k: 'sym'; ch: string; italic?: boolean }
  | { k: 'txt'; text: string; roman?: boolean }
  | { k: 'sup'; child: Node[] }
  | { k: 'sub'; child: Node[] }
  | { k: 'frac'; num: Node[]; den: Node[] }
  | { k: 'sqrt'; child: Node[] }
  | { k: 'accent'; kind: 'vec' | 'hat' | 'bar' | 'dot'; child: Node[] }
  | { k: 'group'; child: Node[] }

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
  chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ',
  Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
}

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', geq: '≥', neq: '≠',
  approx: '≈', equiv: '≡', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  leftrightarrows: '⇆', uparrow: '↑', downarrow: '↓', sum: '∑', int: '∫', oint: '∮',
  prod: '∏', angle: '∠', perp: '⊥', parallel: '∥', degree: '°', prime: '′',
  in: '∈', notin: '∉', subset: '⊂', cup: '∪', cap: '∩', forall: '∀', exists: '∃',
  ldots: '…', cdots: '⋯', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', therefore: '∴',
  langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', Vert: '‖',
  setminus: '∖', ast: '∗', star: '⋆', bullet: '•', circ: '∘'
}

const SPACES: Record<string, number> = { ',': 0.17, ':': 0.22, ';': 0.28, '!': -0.17, ' ': 0.25, quad: 1, qquad: 2 }

interface Token { t: 'ch' | 'cmd' | 'group' | 'sup' | 'sub'; v: string; child?: Token[] }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  const readGroup = (): Token[] => {
    // 调用时 src[i] === '{'
    let depth = 0
    const start = i + 1
    for (; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue }
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { const body = src.slice(start, i); i++; return tokenize(body) } }
    }
    return tokenize(src.slice(start))
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      i++
      let name = ''
      if (/[a-zA-Z]/.test(src[i] ?? '')) { while (i < src.length && /[a-zA-Z]/.test(src[i])) name += src[i++] }
      else { name = src[i++] ?? '' }
      out.push({ t: 'cmd', v: name })
      continue
    }
    if (c === '{') { out.push({ t: 'group', v: '', child: readGroup() }); continue }
    if (c === '^' || c === '_') {
      i++
      let child: Token[]
      if (src[i] === '{') child = readGroup()
      else if (src[i] === '\\') { const s = i; i++; let n = ''; while (i < src.length && /[a-zA-Z]/.test(src[i])) n += src[i++]; child = [{ t: 'cmd', v: n }]; void s }
      else child = [{ t: 'ch', v: src[i++] ?? '' }]
      out.push({ t: c === '^' ? 'sup' : 'sub', v: '', child })
      continue
    }
    if (c === '&') { i++; continue }
    out.push({ t: 'ch', v: c })
    i++
  }
  return out
}

function parse(tokens: Token[]): Node[] {
  const nodes: Node[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (tk.t === 'ch') {
      if (tk.v === ' ') { nodes.push({ k: 'sym', ch: ' ' }); continue }
      nodes.push({ k: 'sym', ch: tk.v, italic: /[a-zA-Z]/.test(tk.v) })
    } else if (tk.t === 'group') {
      nodes.push({ k: 'group', child: parse(tk.child ?? []) })
    } else if (tk.t === 'sup' || tk.t === 'sub') {
      const child = parse(tk.child ?? [])
      nodes.push(tk.t === 'sup' ? { k: 'sup', child } : { k: 'sub', child })
    } else {
      const name = tk.v
      if (GREEK[name]) { nodes.push({ k: 'sym', ch: GREEK[name], italic: name[0] === name[0].toLowerCase() }); continue }
      if (SYMBOLS[name]) { nodes.push({ k: 'sym', ch: SYMBOLS[name] }); continue }
      if (SPACES[name] !== undefined) { nodes.push({ k: 'sym', ch: '\u2009'.repeat(Math.max(0, Math.round(SPACES[name] * 2))) }); continue }
      if (name === 'frac') {
        const a = tokens[++i]; const b = tokens[++i]
        const num = a?.t === 'group' ? parse(a.child ?? []) : a ? parse([a]) : []
        const den = b?.t === 'group' ? parse(b.child ?? []) : b ? parse([b]) : []
        nodes.push({ k: 'frac', num, den })
        continue
      }
      if (name === 'sqrt') {
        const a = tokens[++i]
        nodes.push({ k: 'sqrt', child: a?.t === 'group' ? parse(a.child ?? []) : a ? parse([a]) : [] })
        continue
      }
      if (name === 'vec' || name === 'hat' || name === 'bar' || name === 'dot') {
        const a = tokens[++i]
        nodes.push({ k: 'accent', kind: name, child: a?.t === 'group' ? parse(a.child ?? []) : a ? parse([a]) : [] })
        continue
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
        const a = tokens[++i]
        const raw = a?.t === 'group' ? (a.child ?? []).map(x => x.v || (x.child ?? []).map(y => y.v).join('')).join('') : ''
        nodes.push({ k: 'txt', text: raw, roman: true })
        continue
      }
      if (name === 'left' || name === 'right') { continue }
      if (name === 'begin' || name === 'end') {
        const a = tokens[++i]
        const env = a?.t === 'group' ? (a.child ?? []).map(x => x.v).join('') : ''
        if (env === 'cases' || env === 'matrix' || env === 'pmatrix' || env === 'aligned') continue
        continue
      }
      if (name === 'mathbf' || name === 'boldsymbol' || name === 'mathit') {
        const a = tokens[++i]
        const child = a?.t === 'group' ? parse(a.child ?? []) : []
        nodes.push({ k: 'group', child })
        continue
      }
      if (name === 'displaystyle' || name === 'limits' || name === 'nolimits') continue
      // 未知命令：把名字当正体文字画出来，避免公式整段消失
      nodes.push({ k: 'txt', text: name, roman: true })
    }
  }
  return nodes
}

export interface MathStyle {
  size: number
  color: string
  font: string
  italicFont: string
}

interface Metrics { w: number; asc: number; desc: number; axis: number }

const AXIS_RATIO = 0.26

function measure(ctx: Ctx2D, nodes: Node[], st: MathStyle): Metrics {
  let w = 0
  let asc = 0
  let desc = 0
  const axis = st.size * AXIS_RATIO
  for (const n of nodes) {
    if (n.k === 'sym') {
      ctx.font = symFont(n, st)
      const m = ctx.measureText(n.ch)
      w += m.width
      asc = Math.max(asc, m.actualBoundingBoxAscent || st.size * 0.72)
      desc = Math.max(desc, m.actualBoundingBoxDescent || st.size * 0.22)
    } else if (n.k === 'txt') {
      ctx.font = `${st.size}px ${st.font}`
      const m = ctx.measureText(n.text)
      w += m.width
      asc = Math.max(asc, m.actualBoundingBoxAscent || st.size * 0.72)
      desc = Math.max(desc, m.actualBoundingBoxDescent || st.size * 0.22)
    } else if (n.k === 'group') {
      const m = measure(ctx, n.child, st)
      w += m.w; asc = Math.max(asc, m.asc); desc = Math.max(desc, m.desc)
    } else if (n.k === 'sup') {
      const m = measure(ctx, n.child, { ...st, size: st.size * 0.68 })
      w += m.w
      asc = Math.max(asc, st.size * 0.52 + m.asc * 0.72)
      desc = Math.max(desc, m.desc)
    } else if (n.k === 'sub') {
      const m = measure(ctx, n.child, { ...st, size: st.size * 0.68 })
      w += m.w
      asc = Math.max(asc, m.asc)
      desc = Math.max(desc, st.size * 0.28 + m.desc * 0.72)
    } else if (n.k === 'frac') {
      const a = measure(ctx, n.num, { ...st, size: st.size * 0.78 })
      const b = measure(ctx, n.den, { ...st, size: st.size * 0.78 })
      w += Math.max(a.w, b.w) + st.size * 0.16
      asc = Math.max(asc, a.asc + st.size * 0.34)
      desc = Math.max(desc, b.desc + st.size * 0.34)
    } else if (n.k === 'sqrt') {
      const a = measure(ctx, n.child, st)
      w += a.w + st.size * 0.5
      asc = Math.max(asc, a.asc + st.size * 0.08)
      desc = Math.max(desc, a.desc)
    } else if (n.k === 'accent') {
      const a = measure(ctx, n.child, st)
      w += a.w
      asc = Math.max(asc, a.asc + st.size * 0.16)
      desc = Math.max(desc, a.desc)
    }
  }
  return { w, asc: asc || st.size * 0.72, desc: desc || st.size * 0.22, axis }
}

function symFont(n: { italic?: boolean }, st: MathStyle) {
  return n.italic ? `italic ${st.size}px ${st.italicFont}` : `${st.size}px ${st.font}`
}

function drawNodes(ctx: Ctx2D, nodes: Node[], x: number, y: number, st: MathStyle): number {
  // y 为基线
  let cx = x
  const axis = st.size * AXIS_RATIO
  for (const n of nodes) {
    if (n.k === 'sym') {
      ctx.font = symFont(n, st)
      ctx.fillStyle = st.color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(n.ch, cx, y)
      cx += ctx.measureText(n.ch).width
    } else if (n.k === 'txt') {
      ctx.font = `${st.size}px ${st.font}`
      ctx.fillStyle = st.color
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(n.text, cx, y)
      cx += ctx.measureText(n.text).width
    } else if (n.k === 'group') {
      cx = drawNodes(ctx, n.child, cx, y, st)
    } else if (n.k === 'sup') {
      const m = measure(ctx, n.child, { ...st, size: st.size * 0.68 })
      cx = drawNodes(ctx, n.child, cx, y - st.size * 0.46, { ...st, size: st.size * 0.68 })
      void m
    } else if (n.k === 'sub') {
      cx = drawNodes(ctx, n.child, cx, y + st.size * 0.24, { ...st, size: st.size * 0.68 })
    } else if (n.k === 'frac') {
      const sub = { ...st, size: st.size * 0.78 }
      const a = measure(ctx, n.num, sub)
      const b = measure(ctx, n.den, sub)
      const w = Math.max(a.w, b.w) + st.size * 0.16
      const barY = y - axis - st.size * 0.1
      ctx.strokeStyle = st.color
      ctx.lineWidth = Math.max(1, st.size * 0.045)
      ctx.beginPath()
      ctx.moveTo(cx + st.size * 0.04, barY)
      ctx.lineTo(cx + w - st.size * 0.04, barY)
      ctx.stroke()
      drawNodes(ctx, n.num, cx + (w - a.w) / 2, barY - st.size * 0.12, sub)
      drawNodes(ctx, n.den, cx + (w - b.w) / 2, barY + st.size * 0.34 + b.asc * 0.1, sub)
      cx += w
    } else if (n.k === 'sqrt') {
      const a = measure(ctx, n.child, st)
      const pad = st.size * 0.14
      const top = y - a.asc - st.size * 0.06
      const bottom = y + a.desc * 0.6
      ctx.strokeStyle = st.color
      ctx.lineWidth = Math.max(1, st.size * 0.05)
      ctx.beginPath()
      ctx.moveTo(cx + st.size * 0.06, y - a.asc * 0.35)
      ctx.lineTo(cx + st.size * 0.2, y - a.asc * 0.1)
      ctx.lineTo(cx + st.size * 0.34, bottom)
      ctx.lineTo(cx + st.size * 0.52, top)
      ctx.lineTo(cx + st.size * 0.52 + a.w + pad, top)
      ctx.stroke()
      drawNodes(ctx, n.child, cx + st.size * 0.56, y, st)
      cx += st.size * 0.56 + a.w + pad
    } else if (n.k === 'accent') {
      const a = measure(ctx, n.child, st)
      const inner = drawNodes(ctx, n.child, cx, y, st)
      ctx.strokeStyle = st.color
      ctx.lineWidth = Math.max(1, st.size * 0.045)
      const topY = y - a.asc - st.size * 0.04
      if (n.kind === 'vec') {
        const w = inner - cx
        ctx.beginPath()
        ctx.moveTo(cx + w * 0.12, topY + st.size * 0.02)
        ctx.lineTo(cx + w * 0.88, topY + st.size * 0.02)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(cx + w * 0.88, topY + st.size * 0.02)
        ctx.lineTo(cx + w * 0.76, topY - st.size * 0.04)
        ctx.moveTo(cx + w * 0.88, topY + st.size * 0.02)
        ctx.lineTo(cx + w * 0.76, topY + st.size * 0.08)
        ctx.stroke()
      } else if (n.kind === 'bar') {
        ctx.beginPath()
        ctx.moveTo(cx + st.size * 0.04, topY + st.size * 0.04)
        ctx.lineTo(inner - st.size * 0.04, topY + st.size * 0.04)
        ctx.stroke()
      } else if (n.kind === 'hat') {
        ctx.beginPath()
        ctx.moveTo(cx + st.size * 0.1, topY + st.size * 0.1)
        ctx.lineTo((cx + inner) / 2, topY - st.size * 0.02)
        ctx.lineTo(inner - st.size * 0.1, topY + st.size * 0.1)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc((cx + inner) / 2, topY + st.size * 0.02, st.size * 0.045, 0, Math.PI * 2)
        ctx.fillStyle = st.color
        ctx.fill()
      }
      cx = inner
    }
  }
  return cx
}

/** 把 TeX 子集渲染到 (x,y)。align 控制水平对齐，y 是垂直中心。 */
export function drawMath(
  ctx: Ctx2D,
  tex: string,
  x: number,
  y: number,
  style: MathStyle,
  align: 'center' | 'left' | 'right' = 'center'
): void {
  const nodes = parse(tokenize(tex))
  const m = measure(ctx, nodes, style)
  let startX = x
  if (align === 'center') startX = x - m.w / 2
  else if (align === 'right') startX = x - m.w
  const baseline = y + (m.asc - m.desc) / 2
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  drawNodes(ctx, nodes, startX, baseline, style)
  ctx.restore()
}

/** 供 UI 预览用：返回公式尺寸 */
export function measureMath(ctx: Ctx2D, tex: string, style: MathStyle): { w: number; h: number } {
  const m = measure(ctx, parse(tokenize(tex)), style)
  return { w: m.w, h: m.asc + m.desc }
}

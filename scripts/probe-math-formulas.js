/**
 * 聚焦探针：6 条扩展公式逐条是否画出（统计非背景像素与主色）
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const d = () => window.__gewuDebug
  async function waitFor(fn, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  const formulas = [
    '\\sqrt[3]{x^2 + y^2}',
    '\\overline{x} + \\underline{y} + \\tilde{z} + \\ddot{\\theta}',
    '\\iint_S \\vec{E}\\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}',
    '\\mathbb{R}^n \\to \\mathbb{C}',
    '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
    '\\left( \\frac{a}{b} \\right)^2 \\approx 1'
  ]
  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')))
    await wait(500)
    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: false, duration: 2 },
      layers: formulas.map((tex, i) => ({
        id: `f${i}`, name: `公式${i}`, kind: 'code', start: 0, end: 2,
        draw: `g.math(${JSON.stringify(tex)}, 960, ${140 + i * 150}, { size: 56, color: '#ffffff', align: 'center' })`
      })),
      audio: [],
      subtitles: []
    }), { label: 'probe-formulas' })
    d().editor.setTime(1)
    await wait(1000)
    const canvas = q('.stage-canvas')
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    const hist = new Map()
    const bands = [0, 0, 0, 0, 0, 0]
    const scaleY = canvas.height / 1080
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4
        const r = data[i], g = data[i + 1], b = data[i + 2]
        const v = (r + g + b) / 3
        if (v > 60) {
          lit++
          const key = `${r},${g},${b}`
          hist.set(key, (hist.get(key) ?? 0) + 1)
          for (let k = 0; k < 6; k++) {
            const cy = (140 + k * 150) * scaleY
            if (Math.abs(y - cy) < 55 * scaleY) bands[k]++
          }
        }
      }
    }
    out.lit = lit
    out.bands = bands
    out.bandsAllDrawn = bands.every(n => n > 20)
    out.top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    out.size = { w: canvas.width, h: canvas.height }
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

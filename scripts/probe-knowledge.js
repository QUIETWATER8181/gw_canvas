/**
 * 探针：知识库检索 + 扩展后的 g.math 公式渲染
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
  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')))
    await wait(600)

    // ---- 知识库 ----
    for (const [name, query, topic] of [
      ['physics', '马吕斯定律', 'physics'],
      ['math', '导数 切线', 'math'],
      ['storyboard', '对照实验 分镜', 'storyboard']
    ]) {
      const r = await window.gewu.knowledgeSearch({ query, topic, limit: 2 })
      out[name] = {
        ok: r.ok,
        hits: r.hits?.length ?? 0,
        titles: (r.hits ?? []).map(h => h.title),
        hasBody: Boolean(r.hits?.[0]?.body && r.hits[0].body.length > 80),
        preview: r.hits?.[0]?.body?.slice(0, 80) ?? null
      }
    }
    const miss = await window.gewu.knowledgeSearch({ query: 'zzzz不存在的词', limit: 2 })
    out.miss = { ok: miss.ok, catalog: Boolean(miss.catalog && miss.catalog.length > 20) }

    // ---- 公式：每种颜色一层，缺色说明该公式抛错/没画出来 ----
    const formulas = [
      ['\\sqrt[3]{x^2 + y^2}', '#ff3333'],
      ['\\overline{x} + \\underline{y} + \\tilde{z} + \\ddot{\\theta}', '#33ff33'],
      ['\\iint_S \\vec{E}\\cdot d\\vec{A} = \\frac{Q}{\\varepsilon_0}', '#3388ff'],
      ['\\mathbb{R}^n \\to \\mathbb{C}', '#ffff33'],
      ['\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', '#ff33ff'],
      ['\\left( \\frac{a}{b} \\right)^2 \\approx 1', '#33ffff']
    ]
    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: false, duration: 2 },
      layers: formulas.map(([tex, color], i) => ({
        id: `math-${i}`,
        name: `公式${i}`,
        kind: 'code',
        start: 0,
        end: 2,
        draw: `g.math(${JSON.stringify(tex)}, 960, ${140 + i * 150}, { size: 56, color: '${color}', align: 'center' })`
      })),
      audio: [],
      subtitles: []
    }), { label: 'probe-math' })
    d().editor.setTime(1)
    await wait(900)

    const canvas = q('.stage-canvas')
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const counts = {}
    for (const [, color] of formulas) counts[color] = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (r > 90 && g > 90 && b > 90) {
        if (r > 150 && g < 120 && b < 120) counts['#ff3333']++
        else if (g > 150 && r < 120 && b < 120) counts['#33ff33']++
        else if (b > 150 && r < 120 && g < 160) counts['#3388ff']++
        else if (r > 150 && g > 150 && b < 120) counts['#ffff33']++
        else if (r > 150 && b > 150 && g < 120) counts['#ff33ff']++
        else if (g > 150 && b > 150 && r < 120) counts['#33ffff']++
      }
    }
    out.mathCounts = counts
    out.mathAllDrawn = Object.values(counts).every(n => n > 20)
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

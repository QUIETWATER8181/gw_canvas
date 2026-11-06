(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = sel => document.querySelector(sel)
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), w: Math.round(b.width) } }
  async function waitFor(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(150) } return false }
  ;(async () => {
    await waitFor(() => Boolean(q('.wb-top')))
    await wait(800)
    const top = q('.wb-top')
    const measure = () => ({
      left: r(q('.left-panel')), rail: r(q('.lp-rail')), main: r(q('.lp-main')), body: r(q('.lp-body')),
      bodyScroll: q('.lp-body') ? { sw: q('.lp-body').scrollWidth, cw: q('.lp-body').clientWidth } : null,
      bodyStyle: (() => { const s = getComputedStyle(q('.lp-body')); return { width: s.width, padding: s.padding, boxSizing: s.boxSizing } })(),
      mainStyle: (() => { const s = getComputedStyle(q('.lp-main')); return { width: s.width, flex: s.flex, minWidth: s.minWidth } })(),
      railStyle: (() => { const s = getComputedStyle(q('.lp-rail')); return { width: s.width, flex: s.flex, minWidth: s.minWidth } })()
    })
    const at340 = measure()
    top.style.gridTemplateColumns = '240px 6px minmax(0,1fr) 6px 400px'
    await wait(500)
    const at240 = measure()
    resolve(JSON.stringify({ at340, at240 }, null, 2))
  })().catch(e => resolve(JSON.stringify({ fatal: String(e && e.stack || e) }, null, 2)))
}))()

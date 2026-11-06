/**
 * 聚焦探针：时间轴右柄裁剪为什么没改 end
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const d = () => window.__gewuDebug
  const layerEnd = () => (d()?.editor.state.scene.layers || []).find(l => l.name === '独立标题')?.end
  const mid = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
  async function waitFor(fn, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  ;(async () => {
    await waitFor(() => Boolean(d() && q('.tl-bar')))
    await wait(800)
    const bar = qa('.tl-bar').find(b => b.textContent.includes('独立标题'))
    const h = bar?.querySelector('.tl-handle.r')
    out.barRect = bar ? bar.getBoundingClientRect().toJSON() : null
    out.handleRect = h ? h.getBoundingClientRect().toJSON() : null
    out.endBefore = layerEnd()
    const c = mid(h)
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 0, buttons: 1 }))
    await wait(220)
    out.bubble0 = q('.tl-bubble')?.textContent || null
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: c.x - 60, clientY: c.y, buttons: 1 }))
    await wait(220)
    out.endMid1 = layerEnd()
    out.bubble1 = q('.tl-bubble')?.textContent || null
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: c.x - 120, clientY: c.y, buttons: 1 }))
    await wait(220)
    out.endMid2 = layerEnd()
    out.bubble2 = q('.tl-bubble')?.textContent || null
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: c.x - 120, clientY: c.y }))
    await wait(300)
    out.endAfterUp = layerEnd()
    out.canUndo = d().editor.canUndo
    await wait(1400)
    const disk = await window.gewu.readScene()
    out.endDisk = (disk.layers || []).find(l => l.name === '独立标题')?.end
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

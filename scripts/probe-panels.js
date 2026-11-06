/**
 * 探针：左右栏拖拽 + 左栏窄宽度下内容不横向溢出
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const overflow = el => el ? { scrollW: el.scrollWidth, clientW: el.clientWidth, bad: el.scrollWidth > el.clientWidth + 1 } : null
  const pointer = (type, el, x, y) => el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1
  }))
  async function waitFor(fn, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  async function drag(el, dx) {
    const r = rect(el)
    const x = r.x + r.w / 2
    const y = r.y + Math.min(120, r.h / 2)
    pointer('pointerdown', el, x, y)
    await wait(180)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + dx / 2, clientY: y, pointerId: 1, buttons: 1 }))
    await wait(120)
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + dx, clientY: y, pointerId: 1, buttons: 1 }))
    await wait(120)
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + dx, clientY: y, pointerId: 1 }))
    await wait(450)
  }
  ;(async () => {
    await waitFor(() => Boolean(q('.panel-resizer') && q('.left-panel')))
    await wait(800)
    out.initial = {
      left: rect(q('.left-panel'))?.w,
      stage: rect(q('.stage'))?.w,
      right: rect(q('.right-panel'))?.w,
      savedLeft: localStorage.getItem('gewu.leftW'),
      savedRight: localStorage.getItem('gewu.rightW')
    }
    const resizers = qa('.panel-resizer')
    await drag(resizers[0], 80)
    out.afterLeftDrag = { left: rect(q('.left-panel'))?.w, stage: rect(q('.stage'))?.w, saved: localStorage.getItem('gewu.leftW') }
    await drag(resizers[1], -60)
    out.afterRightDrag = { right: rect(q('.right-panel'))?.w, stage: rect(q('.stage'))?.w, saved: localStorage.getItem('gewu.rightW') }

    // 双击复位
    const dbl = el => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    dbl(resizers[0]); dbl(resizers[1])
    await wait(350)
    out.afterReset = { left: rect(q('.left-panel'))?.w, right: rect(q('.right-panel'))?.w }

    // 拖到最窄，检查各 tab 内容是否横向溢出
    await drag(resizers[0], -400)
    out.narrowLeft = rect(q('.left-panel'))?.w
    out.tabs = {}
    for (const [name, tabText, sels] of [
      ['media', '媒体', ['.asset-grid', '.add-grid', '.track-ctl']],
      ['audio', '音频', ['.sfx-grid', '.track-ctl']],
      ['subs', '字幕', ['.tts-bar', '.sub-time']],
      ['search', '搜索', ['.search-grid', '.search-bar']]
    ]) {
      qa('.lp-rail-btn').find(b => b.textContent.includes(tabText))?.click()
      await wait(350)
      out.tabs[name] = {
        body: overflow(q('.lp-body')),
        els: Object.fromEntries(sels.map(sel => [sel, overflow(q(sel))]))
      }
    }
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

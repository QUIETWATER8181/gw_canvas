/**
 * 探针：编辑器布局体检（无溢出、时间轴多轨可滚动、面板分区不裁切）
 * 前置：powershell -NoProfile -File scripts\reset-probe-scene.ps1
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }
  }
  const inside = (el, pad = 1) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.left >= -pad && r.top >= -pad && r.right <= innerWidth + pad && r.bottom <= innerHeight + pad
  }
  const out = {}
  try {
    await wait(3500)
    out.viewport = { w: innerWidth, h: innerHeight }
    out.docOverflow = { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight }

    out.shell = {
      stage: rect(q('.stage')),
      stageCanvas: rect(q('.stage-canvas')),
      timeline: rect(q('.timeline')),
      left: rect(q('.left-panel')),
      right: rect(q('.right-panel'))
    }
    out.timelineInside = inside(q('.timeline'))
    out.canvasInsideStage = (() => {
      const c = q('.stage-canvas')?.getBoundingClientRect()
      const s = q('.stage-body')?.getBoundingClientRect()
      if (!c || !s) return null
      return c.left >= s.left - 1 && c.top >= s.top - 1 && c.right <= s.right + 1 && c.bottom <= s.bottom + 1
    })()
    out.aspect = (() => {
      const c = q('.stage-canvas')?.getBoundingClientRect()
      return c ? Number((c.width / c.height).toFixed(3)) : null
    })()

    const scroll = q('.tl-scroll')
    out.tlScroll = scroll ? { clientH: scroll.clientHeight, scrollH: scroll.scrollHeight, clientW: scroll.clientWidth, scrollW: scroll.scrollWidth } : null
    out.rows = qa('.tl-track').length
    out.nameCol = rect(q('.tl-track-name'))
    out.corner = rect(q('.tl-corner'))
    out.rowHeight = rect(qa('.tl-track')[0])?.h
    out.headSticky = (() => {
      const h = q('.tl-head')
      return h ? getComputedStyle(h).position : null
    })()
    out.nameSticky = (() => {
      const n = q('.tl-track-name')
      return n ? getComputedStyle(n).position : null
    })()
    out.nameColAligned = (() => {
      const n = rect(q('.tl-track-name'))
      const c = rect(q('.tl-corner'))
      return n && c ? n.w === c.w : null
    })()

    // 纵向滚动到底，确认最后一行（字幕）能完整看到
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight
      await wait(250)
      const rows = qa('.tl-track')
      const last = rows[rows.length - 1]
      const lr = rect(last)
      out.lastRowVisible = lr ? lr.bottom <= (rect(scroll)?.bottom ?? innerHeight) + 1 && lr.bottom > (rect(scroll)?.top ?? 0) : null
      out.lastRow = lr
      scroll.scrollTop = 0
    }

    // 属性面板
    qa('.rp-tabs button').find(b => b.textContent.includes('图层'))?.click()
    await wait(400)
    qa('.tl-track-name').find(el => el.textContent.includes('卡片标题'))?.click()
    await wait(400)
    const body = q('.insp-body')
    out.inspBody = body ? { clientH: body.clientHeight, scrollH: body.scrollHeight, scrollable: body.scrollHeight > body.clientHeight + 2 } : null
    out.inspSections = qa('.insp-section-title').map(el => el.textContent.trim())
    out.inspOverflowX = body ? body.scrollWidth - body.clientWidth : null
    out.selBox = rect(q('.sel-box'))
    out.selBoxInsideCanvas = (() => {
      const b = q('.sel-box')?.getBoundingClientRect()
      const c = q('.stage-canvas')?.getBoundingClientRect()
      if (!b || !c) return null
      return b.left >= c.left - 2 && b.top >= c.top - 30 && b.right <= c.right + 2 && b.bottom <= c.bottom + 2
    })()

    // 左侧素材库
    qa('.lp-tabs button').find(b => b.textContent.trim().startsWith('素材'))?.click()
    await wait(400)
    out.addGrid = rect(q('.add-grid'))
    out.addButtons = qa('.add-grid button').length
    out.addGridOverflow = (() => {
      const g = q('.add-grid')
      return g ? g.scrollWidth - g.clientWidth : null
    })()

    out.ok = out.docOverflow.x === 0 && out.docOverflow.y === 0 && out.timelineInside && out.canvasInsideStage && out.nameColAligned && out.lastRowVisible && out.inspOverflowX === 0
    return JSON.stringify(out, null, 1)
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.stack) || err), out }, null, 1)
  }
})()

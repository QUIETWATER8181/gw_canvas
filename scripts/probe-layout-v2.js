/**
 * 探针：剪映式布局（全宽时间轴 / 左侧图标栏 / 右栏三 tab / 导出画质）
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const rect = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }
  }
  const within = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
  }
  async function waitFor(fn, ms = 10000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }

  ;(async () => {
    await waitFor(() => Boolean(q('.wb-top')), 20000)
    await wait(1200)
    out.viewport = { w: innerWidth, h: innerHeight }
    out.pageOverflow = {
      x: document.documentElement.scrollWidth - innerWidth,
      y: document.documentElement.scrollHeight - innerHeight
    }
    out.workbench = rect(q('.workbench'))
    out.wbTop = rect(q('.wb-top'))
    out.timeline = rect(q('.timeline'))
    out.timelineFullWidth = out.timeline ? Math.abs(out.timeline.w - innerWidth) <= 2 : null
    out.timelineBelowTop = out.wbTop && out.timeline ? out.timeline.y >= out.wbTop.bottom - 2 : null
    out.stage = rect(q('.stage'))
    out.canvas = rect(q('.stage-canvas'))
    out.canvasRatio = out.canvas ? +(out.canvas.w / out.canvas.h).toFixed(3) : null
    out.rail = rect(q('.lp-rail'))
    out.railButtons = qa('.lp-rail-btn').length
    out.railActive = q('.lp-rail-btn.on')?.textContent?.trim()
    out.rightTabs = qa('.rp-tabs button').map(b => b.textContent.trim())
    out.progress = rect(q('.rp-progress'))
    out.progressHead = q('.rp-progress-head')?.textContent?.trim()

    // 时间轴：自动时长 + 折叠
    out.tlAuto = qa('.tl-auto').map(b => b.textContent.trim())
    out.tlCollapse = Boolean(q('.tl-collapse'))
    q('.tl-collapse')?.click()
    await wait(250)
    out.collapsedH = rect(q('.timeline'))?.h
    out.collapsedScrollHidden = q('.tl-scroll') ? getComputedStyle(q('.tl-scroll')).display : null
    q('.tl-collapse')?.click()
    await wait(250)
    out.expandedH = rect(q('.timeline'))?.h

    // 搜索 tab
    qa('.lp-rail-btn').find(b => b.textContent.includes('搜索'))?.click()
    await wait(300)
    out.searchPanel = Boolean(q('.search-panel'))
    out.searchInput = Boolean(q('.search-bar input'))
    out.searchGrid = Boolean(q('.search-grid'))

    // 音频 tab → 音效库
    qa('.lp-rail-btn').find(b => b.textContent.includes('音频'))?.click()
    await wait(300)
    out.sfxCards = qa('.sfx-card').length
    out.sfxAutoBtn = qa('.sfx-actions .btn').map(b => b.textContent.trim())

    // 导出对话框画质
    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')), 6000)
    out.exportDialog = Boolean(q('.xdlg'))
    out.formatSelects = qa('.xdlg-format select').length
    out.formatLabels = qa('.xdlg-format label span').map(s => s.textContent.trim())
    out.dialogInside = within(q('.xdlg'))
    out.dialogScroll = (() => {
      const el = q('.xdlg-body')
      return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight, clipped: el.scrollHeight > el.clientHeight + 2 } : null
    })()

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

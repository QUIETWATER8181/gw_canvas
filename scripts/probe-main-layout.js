/**
 * 探针：主窗口新 UI 的布局体检（导出对话框 + 标题栏草稿下拉）
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
  const within = el => {
    const r = el.getBoundingClientRect()
    return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
  }
  async function waitFor(fn, ms = 8000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }

  ;(async () => {
    await waitFor(() => Boolean(q('.tb-status')), 20000)
    await wait(1200)
    out.viewport = { w: innerWidth, h: innerHeight, overflowX: document.documentElement.scrollWidth - innerWidth }
    out.titlebar = rect(q('.titlebar'))
    out.draftButton = rect(q('.tb-draft'))
    out.draftButtonInside = within(q('.tb-draft'))
    out.draftName = q('.tb-draft-name')?.textContent

    // ---- 草稿下拉 ----
    q('.tb-draft')?.click()
    await waitFor(() => Boolean(q('.tb-drafts')))
    out.dropdown = rect(q('.tb-drafts'))
    out.dropdownInside = q('.tb-drafts') ? within(q('.tb-drafts')) : null
    out.dropdownItems = qa('.tb-draft-item').length
    out.dropdownListScroll = (() => {
      const el = q('.tb-drafts-list')
      return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight } : null
    })()
    q('.tb-draft')?.click()
    await wait(200)

    // ---- 导出对话框 ----
    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')))
    out.dialog = rect(q('.xdlg'))
    out.dialogInside = q('.xdlg') ? within(q('.xdlg')) : null
    out.dialogBody = rect(q('.xdlg-body'))
    out.dialogBodyScroll = (() => {
      const el = q('.xdlg-body')
      return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight, clipped: el.scrollHeight > el.clientHeight + 2 } : null
    })()
    out.pathBox = rect(q('.xdlg-path > span'))
    out.pathOverflow = (() => {
      const el = q('.xdlg-path > span')
      return el ? { scrollW: el.scrollWidth, clientW: el.clientWidth } : null
    })()
    out.nameInput = rect(q('.xdlg-name-row input'))
    out.scopeButtons = qa('.xdlg-scope > button').map(b => ({ text: b.textContent.trim(), rect: rect(b) }))
    out.actions = rect(q('.xdlg-actions'))
    out.exportBtn = rect(q('.xdlg-export'))
    out.actionsInside = q('.xdlg-actions') ? within(q('.xdlg-actions')) : null
    out.recentChips = qa('.xdlg-chip').length

    // 切到「只导一段」，范围输入框不应把对话框撑宽
    qa('.xdlg-scope > button').find(b => b.textContent.includes('只导一段'))?.click()
    await wait(250)
    out.rangeInputs = qa('.xdlg-range .input').map(i => rect(i))
    out.dialogAfterRange = rect(q('.xdlg'))
    out.dialogStillInside = q('.xdlg') ? within(q('.xdlg')) : null
    out.bodyScrollAfterRange = (() => {
      const el = q('.xdlg-body')
      return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight } : null
    })()

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

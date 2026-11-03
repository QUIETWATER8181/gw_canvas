/**
 * 探针：草稿库窗口的布局体检（没有肉眼截图能力时靠几何数据判断）
 *
 * 检查：视口不出现横/纵向溢出、头/筛选/网格/底栏各就各位、
 *       卡片封面比例 16:9、封面图真的加载出来了、卡片菜单不跑出窗口。
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

  ;(async () => {
    for (let i = 0; i < 50 && !qa('.dl-card').length; i++) await wait(200)
    await wait(800)

    out.viewport = {
      w: innerWidth, h: innerHeight,
      docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight
    }
    out.overflow = {
      x: document.documentElement.scrollWidth - innerWidth,
      y: document.documentElement.scrollHeight - innerHeight
    }
    out.bar = rect(q('.dl-bar'))
    out.filters = rect(q('.dl-filters'))
    out.body = rect(q('.dl-body'))
    out.foot = rect(q('.dl-foot'))
    out.gridCols = q('.dl-grid') ? getComputedStyle(q('.dl-grid')).gridTemplateColumns.split(' ').length : 0
    out.cards = qa('.dl-card').length
    out.cardRect = rect(qa('.dl-card')[0])
    out.coverRect = rect(q('.dl-cover'))
    out.coverRatio = out.coverRect && out.cardRect ? Number((out.coverRect.w / out.coverRect.h).toFixed(2)) : null
    out.coverImages = qa('.dl-cover img').map(i => ({ w: i.naturalWidth, h: i.naturalHeight, complete: i.complete, ok: i.naturalWidth > 0 }))
    out.allCardsInsideViewport = qa('.dl-card').every(within)
    out.barHeight = out.bar?.h
    out.footAtBottom = out.foot ? Math.abs(out.foot.y + out.foot.h - innerHeight) <= 2 : false
    out.bodyFitsBetween = out.body && out.filters && out.foot
      ? out.body.y >= out.filters.y + out.filters.h - 1 && out.body.y + out.body.h <= out.foot.y + 1
      : false
    out.searchBox = rect(q('.dl-search'))
    out.sortBox = rect(q('.dl-sort'))
    out.newButton = rect(qa('.dl-bar-actions .btn').find(b => b.textContent.includes('新建草稿')))

    // 卡片菜单不能跑出窗口
    qa('.dl-more')[0]?.click()
    await wait(250)
    out.menu = rect(q('.dl-menu'))
    out.menuInside = q('.dl-menu') ? within(q('.dl-menu')) : null
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wait(150)
    out.menuClosed = !q('.dl-menu')

    // 搜索框输入不改变布局
    const input = q('.dl-search input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '测试')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await wait(300)
    out.afterSearch = { overflowX: document.documentElement.scrollWidth - innerWidth, cards: qa('.dl-card').length }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

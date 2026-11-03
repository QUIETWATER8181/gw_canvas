/**
 * 探针：草稿库窗口（独立 BrowserWindow）
 *
 * 验证卡片列表、搜索、新建、改名、复制、置顶、删除确认这一整套交互。
 *
 * 用法：
 *   electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts/probe-draft-window.js \
 *     --probe-window=drafts --probe-wait=2500 --log=_run.log
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const text = sel => q(sel)?.textContent?.trim() ?? null

  function setInput(el, value) {
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  const cards = () => qa('.dl-card')
  const cardNames = () => cards().map(c => c.querySelector('.dl-name')?.textContent?.trim() ?? '')
  const cardByName = name => cards().find(c => (c.querySelector('.dl-name')?.textContent ?? '').trim() === name)

  async function waitFor(fn, ms = 8000, step = 200) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (fn()) return true
      await wait(step)
    }
    return false
  }

  ;(async () => {
    await waitFor(() => cards().length > 0 || q('.dl-empty'), 15000)
    out.initialCount = cards().length
    out.initialNames = cardNames()
    out.filters = qa('.dl-filters > button').map(b => b.textContent.replace(/\s+/g, ' ').trim())
    out.footer = text('.dl-foot')
    out.coverCount = qa('.dl-cover img').length
    out.activeBadge = qa('.dl-cover-flag').map(e => e.textContent.trim())

    // ---- 新建草稿 ----
    const before = cards().length
    qa('.dl-bar-actions .btn').find(b => b.textContent.includes('新建草稿'))?.click()
    await waitFor(() => cards().length === before + 1, 8000)
    out.create = { count: cards().length, renameBoxShown: Boolean(q('.dl-rename')) }

    // ---- 改名（受控 input：原生 setter + input 事件 + Enter） ----
    const box = q('.dl-rename')
    const newName = '改名测试草稿'
    setInput(box, newName)
    await wait(120)
    box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => cardNames().includes(newName), 8000)
    out.rename = { ok: cardNames().includes(newName), names: cardNames() }

    // ---- 复制（卡片菜单） ----
    const target = cardByName(newName)
    target?.querySelector('.dl-more')?.click()
    await wait(200)
    out.menuItems = qa('.dl-menu button').map(b => b.textContent.trim())
    qa('.dl-menu button').find(b => b.textContent.includes('创建副本'))?.click()
    await waitFor(() => cards().length === before + 2, 10000)
    out.duplicate = { count: cards().length, names: cardNames() }

    // ---- 置顶 ----
    const copyName = `${newName} 副本`
    const copyCard = cardByName(copyName) ?? cardByName(newName)
    copyCard?.querySelector('.dl-more')?.click()
    await wait(200)
    qa('.dl-menu button').find(b => b.textContent.includes('置顶'))?.click()
    await waitFor(() => Boolean(cards()[0]?.querySelector('.dl-cover-pin')), 8000)
    out.pin = { firstHasPin: Boolean(cards()[0]?.querySelector('.dl-cover-pin')), first: cardNames()[0] }

    // ---- 搜索 ----
    setInput(q('.dl-search input'), newName)
    await waitFor(() => cards().length === 2, 5000)
    out.search = { count: cards().length, names: cardNames() }
    setInput(q('.dl-search input'), '不存在的草稿名-xyz')
    await waitFor(() => cards().length === 0, 5000)
    out.searchEmpty = { count: cards().length, emptyShown: Boolean(q('.dl-empty')) }
    setInput(q('.dl-search input'), '')
    await waitFor(() => cards().length === before + 2, 5000)

    // ---- 删除（确认框） ----
    const toDelete = cardByName(copyName)
    toDelete?.querySelector('.dl-more')?.click()
    await wait(200)
    qa('.dl-menu button').find(b => b.textContent.includes('删除草稿'))?.click()
    await wait(250)
    out.confirmShown = Boolean(q('.dl-confirm'))
    out.confirmText = text('.dl-confirm p')
    q('.dl-confirm .btn.danger')?.click()
    await waitFor(() => cards().length === before + 1, 10000)
    out.delete = { count: cards().length, names: cardNames() }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

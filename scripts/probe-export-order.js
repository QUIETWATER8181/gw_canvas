/**
 * 探针：导出对话框字段顺序（确认画质/帧率在最上面，用户不用滚）
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  async function waitFor(fn, ms = 10000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  ;(async () => {
    await waitFor(() => Boolean(q('.tb-right .btn')), 20000)
    await wait(800)
    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')), 8000)
    const labels = qa('.xdlg-body .xdlg-field > .xdlg-label-row > label').map(el => el.textContent.trim())
    const selects = qa('.xdlg-format select').map(el => ({ value: el.value, options: [...el.options].map(o => o.value) }))
    resolve(JSON.stringify({ labels, selects, dialog: Boolean(q('.xdlg')) }, null, 2))
  })().catch(e => resolve(JSON.stringify({ fatal: String(e && e.stack || e) }, null, 2)))
}))()

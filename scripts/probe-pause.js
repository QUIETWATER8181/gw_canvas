/**
 * 探针：AI 暂停 / 继续（真停 token，不是暂停显示）
 * 需要 mock 服务：MOCK_MODE=slow node scripts/mock-openai.mjs 8787
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const statusText = () => q('.tb-status-text')?.textContent?.trim() || ''
  const lastAssistantLen = () => {
    const list = [...document.querySelectorAll('.msg.assistant')]
    const el = list[list.length - 1]
    return el ? (el.textContent || '').length : 0
  }
  async function waitFor(fn, ms = 30000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(200) }
    return false
  }

  ;(async () => {
    out.ready = await waitFor(() => statusText() === '就绪', 40000)
    out.statusBefore = statusText()
    // 注意：不要 await —— sendPrompt 会一直挂到整轮结束
    const sendP = window.gewu.sendPrompt('请慢慢讲一段物理，用来测试暂停。').catch(e => { out.sendError = String(e) })
    out.started = await waitFor(() => statusText() === '思考中', 15000)
    await wait(1800)
    out.lenBeforePause = lastAssistantLen()
    out.progressVisible = Boolean(q('.rp-progress'))
    out.pauseButton = Boolean([...document.querySelectorAll('.rp-progress-actions .btn, .rp-composer .btn')].find(b => b.textContent.includes('暂停')))
    await window.gewu.pausePrompt()
    await wait(1800)
    out.statusAfterPause = statusText()
    const frozen = lastAssistantLen()
    await wait(1800)
    out.textFrozen = lastAssistantLen() === frozen
    out.frozenLen = frozen
    out.pauseNote = [...document.querySelectorAll('.msg.system')].slice(-1)[0]?.textContent?.trim() || null
    out.resumeButton = Boolean([...document.querySelectorAll('.rp-progress-actions .btn, .rp-composer .btn')].find(b => b.textContent.includes('继续')))
    await window.gewu.resumePrompt()
    await wait(2500)
    out.statusAfterResume = statusText()
    out.textGrewAfterResume = lastAssistantLen() > frozen
    await window.gewu.cancelPrompt()
    await wait(1000)
    out.statusAfterStop = statusText()
    await sendP
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

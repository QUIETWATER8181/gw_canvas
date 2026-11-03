/**
 * 探针：agent 正在跑的时候不许切草稿
 *
 * 为什么值得测：切草稿会换 cwd + 重启 agent。如果跑到一半切了，
 * 工具会把内容写进新草稿、旧草稿的对话也会串。
 *
 * 用法（需要 mock 服务在 8787，MOCK_MODE=slow）：
 *   MOCK_MODE=slow node scripts/mock-openai.mjs 8787
 *   electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts/probe-busy-switch.js --log=_run.log
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const text = sel => document.querySelector(sel)?.textContent?.trim() ?? null

  async function waitFor(fn, ms = 20000, step = 300) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (fn()) return true
      await wait(step)
    }
    return false
  }

  ;(async () => {
    await waitFor(() => Boolean(text('.tb-status')), 20000)
    const list = await window.gewu.listDrafts()
    const other = list.find(d => !d.active)
    out.draftCount = list.length
    out.hasOther = Boolean(other)
    if (!other) return resolve(JSON.stringify({ ...out, fatal: '只有一个草稿，先建一个再测' }))

    // 故意不 await：让这一轮一直占着 agent
    void window.gewu.sendPrompt('用一句话介绍一下自己，慢点说')
    out.busyStatus = await waitFor(() => (text('.tb-status') ?? '').includes('思考中'), 25000)
      ? text('.tb-status')
      : text('.tb-status')

    const blocked = await window.gewu.openDraft(other.id)
    out.blocked = { ok: blocked.ok, error: blocked.error }
    out.activeWhileBusy = (await window.gewu.getState()).draft?.id

    await window.gewu.cancelPrompt()
    const idle = await waitFor(() => !(text('.tb-status') ?? '').includes('思考中'), 30000)
    out.becameIdle = idle
    out.idleStatus = text('.tb-status')

    const ok = await window.gewu.openDraft(other.id)
    out.afterIdle = { ok: ok.ok, error: ok.error }
    await wait(3500)
    const st = await window.gewu.getState()
    out.switchedTo = st.draft?.id
    out.switchedToName = st.draft?.name
    out.titlebar = text('.tb-draft-name')

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

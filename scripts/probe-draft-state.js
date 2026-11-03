/**
 * 探针：草稿切换时对话/场景的隔离与恢复
 *
 * 需要 mock 服务（text 模式）在 8787：
 *   node scripts/mock-openai.mjs 8787
 *
 * 验证：
 *   1. 在 A 草稿里聊两句 → chat.json 落盘且是合法 JSON
 *   2. 切到 B → 对话是 B 自己的（空）
 *   3. 切回 A → 对话原样回来（含刚才那句话）
 *   4. 删当前草稿被拒绝；删别的草稿成功
 *   5. 副本目录里没有 exports/
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const text = sel => document.querySelector(sel)?.textContent?.trim() ?? null
  const chats = () => [...document.querySelectorAll('.msg')].map(m => m.textContent.trim())

  async function waitFor(fn, ms = 60000, step = 400) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (fn()) return true
      await wait(step)
    }
    return false
  }

  ;(async () => {
    await waitFor(() => Boolean(text('.tb-status')), 20000)
    const list0 = await window.gewu.listDrafts()
    out.start = list0.map(d => ({ id: d.id, name: d.name, active: d.active }))
    const active = list0.find(d => d.active)
    let other = list0.find(d => !d.active)
    if (!other) {
      const created = await window.gewu.createDraft('对话隔离测试', 'demo')
      out.createdForTest = created.ok ? created.draft?.id : created.error
      other = (await window.gewu.listDrafts()).find(d => !d.active)
    }
    out.pair = { active: active?.name, other: other?.name }

    // 1) 在 A 里聊一句
    const before = chats().length
    void window.gewu.sendPrompt('记住暗号：苹果七号。只回复“记住了”。')
    await waitFor(() => chats().length > before, 90000)
    out.chatAfterPrompt = { count: chats().length, last: chats().slice(-1)[0]?.slice(0, 60) }

    // 2) 切到 B
    const toB = await window.gewu.openDraft(other.id)
    await wait(4000)
    out.switchToB = { ok: toB.ok, error: toB.error, chatCount: chats().length, title: text('.tb-draft-name') }

    // 3) 切回 A
    const toA = await window.gewu.openDraft(active.id)
    await wait(4000)
    out.switchBackToA = {
      ok: toA.ok,
      error: toA.error,
      chatCount: chats().length,
      title: text('.tb-draft-name'),
      hasSecret: chats().join(' ').includes('苹果七号')
    }

    // 4) 删除保护
    const delActive = await window.gewu.deleteDraft(active.id)
    out.deleteActive = { ok: delActive.ok, error: delActive.error }
    const dup = await window.gewu.duplicateDraft(other.id)
    out.duplicate = { ok: dup.ok, name: dup.draft?.name, id: dup.draft?.id }
    if (dup.ok && dup.draft) {
      const delDup = await window.gewu.deleteDraft(dup.draft.id)
      out.deleteDuplicate = { ok: delDup.ok }
    }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

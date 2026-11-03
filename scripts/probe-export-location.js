/**
 * 探针：导出位置自由选择
 *
 * 验证：
 *   1. 设置里固定目录后，导出对话框默认填这个目录
 *   2. saveExportTo 真写到该目录；同名文件不覆盖（自动 -1）
 *   3. 完整导出一次，toast 里带绝对路径
 *   4. agent 的 saveWorkspaceExport 也跟着设置走（不再固定 workspace/exports）
 *
 * 用法：
 *   electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts/probe-export-location.js --log=_run.log
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const text = sel => q(sel)?.textContent?.trim() ?? null
  const OUT_DIR = 'C:\\Temp\\gewu-probe-out'

  function setInput(el, value) {
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  async function waitFor(fn, ms = 12000, step = 200) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (fn()) return true
      await wait(step)
    }
    return false
  }

  ;(async () => {
    for (let i = 0; i < 60; i++) {
      const st = text('.tb-status') ?? ''
      if (st && !st.includes('启动')) break
      await wait(500)
    }
    out.status = text('.tb-status')

    const initial = await window.gewu.getExportSettings()
    out.initial = { dir: initial.dir, resolvedDir: initial.resolvedDir, systemDir: initial.systemDir, recent: initial.recentDirs }

    // 1) 固定目录
    const fixed = await window.gewu.setExportSettings({ dir: OUT_DIR })
    out.fixed = { dir: fixed.dir, resolvedDir: fixed.resolvedDir }

    // 2) 同名不覆盖：两次写同一个名字，第二个必须变成 -1
    const bytes = new Uint8Array([0, 1, 2, 3, 4])
    const a = await window.gewu.saveExportTo({ dir: OUT_DIR, name: 'dup-test.mp4' }, bytes, { reveal: false })
    const b = await window.gewu.saveExportTo({ dir: OUT_DIR, name: 'dup-test.mp4' }, bytes, { reveal: false })
    out.uniquify = { first: a.path, second: b.path, differ: a.path !== b.path, ok: a.ok && b.ok }

    // 3) 导出对话框默认值
    qa('.tb-right .btn').find(x => x.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')), 8000)
    out.dialog = {
      open: Boolean(q('.xdlg')),
      dir: text('.xdlg-path > span'),
      name: q('.xdlg-name-row input')?.value ?? null,
      fullPath: text('.xdlg-fullpath'),
      chips: qa('.xdlg-chip').map(c => c.textContent.trim())
    }

    // 4) 改文件名并真导一次
    setInput(q('.xdlg-name-row input'), 'probe-export.mp4')
    await wait(150)
    out.dialogAfterRename = text('.xdlg-fullpath')
    q('.xdlg-export')?.click()
    await waitFor(() => Boolean(q('.toast')), 8000)
    const toast = await waitFor(() => {
      const t = text('.toast') ?? ''
      return t.includes('已导出') || t.includes('失败')
    }, 240000, 500)
    out.export = { done: toast, toast: text('.toast') }

    const after = await window.gewu.getExportSettings()
    out.afterExport = { dir: after.dir, recent: after.recentDirs.slice(0, 4) }

    // 5) agent 触发的导出也走同一个目录
    const agent = await window.gewu.saveWorkspaceExport('agent-export.mp4', new Uint8Array([9, 9, 9]))
    out.agentExport = { ok: agent.ok, path: agent.path, underFixedDir: (agent.path ?? '').startsWith(OUT_DIR) }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

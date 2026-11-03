/**
 * 探针：草稿体系（主窗口）
 *
 * 验证：
 *   1. 老 workspace 迁移成第一个草稿（state.draft / workspace 指向 drafts/<id>）
 *   2. 标题栏显示草稿名、下拉里能列出草稿
 *   3. 导出对话框默认位置/文件名有值
 *   4. 新建草稿 → 切换草稿 → 标题栏、场景标题、对话记录都跟着换
 *
 * 用法（一定要给独立的 userData，别碰真实草稿）：
 *   electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts/probe-drafts.js --log=_run.log
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const text = sel => q(sel)?.textContent?.trim() ?? null

  /** React 受控 input：必须用原生 setter 再派发 input，直接赋 value 不生效 */
  function setInput(el, value) {
    if (!el) return false
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  ;(async () => {
    for (let i = 0; i < 60; i++) {
      const st = text('.tb-status') ?? ''
      if (st && !st.includes('启动')) break
      await wait(500)
    }
    out.status = text('.tb-status')

    const st = await window.gewu.getState()
    out.initial = {
      draft: st.draft,
      workspace: st.workspace,
      scenePath: st.scenePath,
      exportResolvedDir: st.exportSettings?.resolvedDir,
      exportAsk: st.exportSettings?.askEveryTime,
      exportReveal: st.exportSettings?.revealAfterExport
    }

    const list = await window.gewu.listDrafts()
    out.drafts = list.map(d => ({
      id: d.id, name: d.name, title: d.title, layers: d.layerCount, dur: d.durationSec,
      active: d.active, pinned: d.pinned, cover: Boolean(d.coverUrl), assets: d.assetCount
    }))
    out.titlebarName = text('.tb-draft-name')

    // 草稿切换下拉
    q('.tb-draft')?.click()
    await wait(300)
    out.switcherItems = qa('.tb-draft-item').map(b => b.textContent.replace(/\s+/g, ' ').trim())
    out.switcherFoot = qa('.tb-drafts-foot button').map(b => b.textContent.trim())
    q('.tb-draft')?.click()
    await wait(150)

    // 草稿库按钮
    out.libraryButton = qa('.tb-right .btn').some(b => b.textContent.includes('草稿库'))

    // 导出对话框
    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await wait(600)
    out.exportDialog = {
      open: Boolean(q('.xdlg')),
      dir: text('.xdlg-path > span'),
      name: q('.xdlg-name-row input')?.value ?? null,
      fullPath: text('.xdlg-fullpath'),
      recentChips: qa('.xdlg-chip').map(c => c.textContent.trim()),
      scopeButtons: qa('.xdlg-scope > button').map(b => b.textContent.trim())
    }
    q('.xdlg .modal-head .icon-btn')?.click()
    await wait(200)

    // 新建 + 切换草稿
    const created = await window.gewu.createDraft({ name: '探针草稿' })
    out.create = {
      ok: created.ok,
      name: created.draft?.name,
      count: created.drafts?.length,
      dir: created.draft?.dir
    }
    const opened = await window.gewu.openDraft(created.draft.id)
    out.open = { ok: opened.ok, count: opened.drafts?.length }
    // 等主进程重启 agent + 广播 draft-opened
    await wait(3500)

    const st2 = await window.gewu.getState()
    const scene2 = await window.gewu.readScene()
    const chat2 = await window.gewu.readChat()
    out.afterSwitch = {
      draft: st2.draft,
      workspace: st2.workspace,
      sceneTitle: scene2.meta.title,
      layers: scene2.layers.length,
      chatCount: chat2.length,
      titlebarName: text('.tb-draft-name'),
      agentPhase: st2.agent.phase,
      draftCount: (await window.gewu.listDrafts()).length
    }

    // 导出设置：固定目录后 resolvedDir 必须跟着变
    const set = await window.gewu.setExportSettings({ dir: 'C:\\Temp\\gewu-probe-out' })
    out.settingsAfterSet = { dir: set.dir, resolvedDir: set.resolvedDir, recentDirs: set.recentDirs.slice(0, 3) }

    // 并发保存压力：连续 8 次改设置（主进程的 save 是 fire-and-forget，会重叠）。
    // 下一次启动如果打出「config.json 读不出来」，就是这里写坏了。
    for (let i = 0; i < 8; i++) {
      await window.gewu.setExportSettings({
        dir: i % 2 ? 'C:\\Temp\\gewu-probe-out' : 'C:\\Temp\\gewu-probe-out2',
        revealAfterExport: i % 2 === 0
      })
    }
    const afterStress = await window.gewu.getExportSettings()
    out.settingsAfterStress = { dir: afterStress.dir, recentDirs: afterStress.recentDirs.slice(0, 4) }

    const cleared = await window.gewu.setExportSettings({ dir: null })
    out.settingsAfterClear = { dir: cleared.dir, resolvedDir: cleared.resolvedDir }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

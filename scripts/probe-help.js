/**
 * 探针：标题栏 ⋯ 菜单不再「一碰就关」（点菜单变成开草稿库）+ 使用说明弹窗
 * 前置：powershell -NoProfile -File scripts\reset-probe-scene.ps1
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const out = { checks: [], failed: [] }
  const check = (name, ok, info) => {
    out.checks.push({ name, ok: !!ok, info: info === undefined ? null : info })
    if (!ok) out.failed.push(name)
  }
  const mid = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  const menu = () => q('.tb-menu')
  const menuItems = () => qa('.tb-menu button').map(b => b.textContent.trim())

  // 真实点击序列：mousedown → mouseup → click（React 的 onClick 走 click）
  const press = (el, at) => {
    const p = at ?? mid(el)
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, buttons: 1 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0 }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0 }))
  }

  try {
    await wait(2600)

    const more = qa('.tb-actions .btn').find(b => b.textContent.trim() === '⋯')
    check('右上角有「⋯」按钮', !!more)
    if (!more) return JSON.stringify(out, null, 1)

    press(more)
    await wait(250)
    check('点 ⋯ 弹出菜单', !!menu(), menuItems())

    const labels = menuItems()
    check('菜单最后一项是「使用说明（怎么用）…」', labels[labels.length - 1]?.startsWith('使用说明'), labels)
    check('菜单里不再有「草稿是怎么存的？」', !labels.some(t => t.includes('草稿是怎么存的')), labels)

    // —— 回归：鼠标离开菜单（移到「草稿库」按钮上边界）不能把菜单关掉
    const lib = qa('.tb-actions .btn').find(b => b.textContent.trim() === '草稿库')
    check('找到「草稿库」按钮', !!lib)
    if (lib && menu()) {
      const lr = lib.getBoundingClientRect()
      const topEdge = { x: lr.left + lr.width / 2, y: lr.top + 1 }
      menu().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: lib, clientX: topEdge.x, clientY: topEdge.y }))
      lib.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: menu(), clientX: topEdge.x, clientY: topEdge.y }))
      lib.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: topEdge.x, clientY: topEdge.y }))
      await wait(250)
      check('鼠标掠过「草稿库」上边界，菜单不消失', !!menu(), { open: !!menu() })
    }

    // —— 回归：菜单开着时点标题栏按钮，这一次点击只用来关菜单（不能顺手把导出框/草稿库点开）
    const exp = qa('.tb-actions .btn').find(b => b.textContent.trim() === '导出')
    check('找到「导出」按钮', !!exp)
    if (exp) {
      press(exp)
      await wait(300)
      check('菜单开着时点「导出」：只关菜单，不弹导出框', !menu() && !q('.modal-backdrop'), { menu: !!menu(), dialog: !!q('.modal-backdrop') })
      press(exp)
      await wait(300)
      check('再点一次「导出」：正常弹出导出框', !!q('.modal-backdrop .xdlg'), { dialog: !!q('.modal-backdrop') })
      // 关掉导出框
      const closeBtn = q('.xdlg .modal-head .icon-btn')
      if (closeBtn) press(closeBtn)
      await wait(250)
      check('导出框能关掉', !q('.xdlg'))
    }

    // —— 使用说明
    press(more)
    await wait(250)
    const helpItem = qa('.tb-menu button').find(b => b.textContent.includes('使用说明'))
    check('菜单里有「使用说明」项', !!helpItem)
    if (helpItem) {
      press(helpItem)
      await wait(350)
      const dlg = q('.hdlg')
      check('点「使用说明」打开弹窗', !!dlg)
      const tabs = qa('.hdlg .modal-tabs button').map(b => b.textContent.trim())
      check('说明有 6 个标签', tabs.length === 6, tabs)
      const body1 = q('.hdlg .help-body')?.textContent ?? ''
      check('默认停在「快速上手」，讲清五步', body1.includes('五步做出一段视频') && body1.includes('Ctrl') && body1.includes('导出'), body1.slice(0, 40))

      // 切到「组合」
      const groupTab = qa('.hdlg .modal-tabs button').find(b => b.textContent.trim() === '组合')
      check('有「组合」标签', !!groupTab)
      if (groupTab) {
        press(groupTab)
        await wait(250)
        const body2 = q('.hdlg .help-body')?.textContent ?? ''
        check(
          '「组合」页讲清：是什么 / 怎么建 / 会裁剪时间 / 换父级',
          body2.includes('组合是什么') &&
          body2.includes('相对组合左上角') &&
          body2.includes('Ctrl') && body2.includes('G') &&
          body2.includes('裁剪') &&
          body2.includes('图层树') &&
          body2.includes('Alt'),
          body2.slice(0, 60)
        )
        const kbds = qa('.hdlg .help-body kbd').length
        check('键位用 kbd 标签渲染', kbds >= 6, kbds)
      }

      // 逐页体检：每一页都不许横向溢出，弹窗不许出视口
      const tabsAll = qa('.hdlg .modal-tabs button')
      const bad = []
      for (const t of tabsAll) {
        press(t)
        await wait(160)
        const dlg = q('.hdlg')
        const body = q('.hdlg .help-body')
        if (!dlg || !body) { bad.push(`${t.textContent}: 没打开`); continue }
        const dr = dlg.getBoundingClientRect()
        const inside = dr.left >= 0 && dr.top >= 0 && dr.right <= innerWidth + 1 && dr.bottom <= innerHeight + 1
        const overX = body.scrollWidth - body.clientWidth
        const heads = qa('.hdlg .help-body h3').length
        const rows = qa('.hdlg .help-body .help-row').length
        if (!inside || overX > 1 || heads === 0) bad.push({ tab: t.textContent.trim(), inside, overX, heads })
        out['tab_' + t.textContent.trim()] = { inside, overX, heads, rows, bodyH: body.clientHeight, scrollH: body.scrollHeight }
      }
      check('6 个标签逐页：不出视口、不横向溢出、每页都有小标题', bad.length === 0, bad)

      // 草稿页仍然保留「草稿是怎么存的」
      const draftTab = qa('.hdlg .modal-tabs button').find(b => b.textContent.trim() === '草稿与导出')
      if (draftTab) {
        press(draftTab)
        await wait(200)
        const body3 = q('.hdlg .help-body')?.textContent ?? ''
        check('「草稿与导出」页保留保存位置说明', body3.includes('scene.json') && body3.includes('自动保存') && body3.includes('trash'), body3.slice(0, 50))
      }

      // Esc 关闭
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await wait(250)
      check('Esc 关闭使用说明', !q('.hdlg'))
    }

    // —— 输入框下面的「使用说明」入口
    const link = qa('.rp-composer-foot .link').find(b => b.textContent.trim() === '使用说明')
    check('输入框下方也有「使用说明」入口', !!link)
    if (link) {
      press(link)
      await wait(300)
      check('从输入框入口也能打开说明', !!q('.hdlg'))
      const btn = qa('.hdlg .help-foot .btn').find(b => b.textContent.trim() === '知道了')
      if (btn) press(btn)
      await wait(200)
      check('「知道了」关闭说明', !q('.hdlg'))
    }

    out.ok = out.failed.length === 0
    return JSON.stringify(out, null, 1)
  } catch (error) {
    out.ok = false
    out.error = String(error && error.stack || error)
    return JSON.stringify(out, null, 1)
  }
})()

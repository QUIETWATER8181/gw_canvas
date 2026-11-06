/**
 * 探针：手工剪辑体验（结构化元素 / 画布拖动 / 双击改字 / 时间轴多轨 / 素材拖拽 / 成组解组 / 右键菜单）
 *
 * 前置：powershell -NoProfile -File scripts\reset-probe-scene.ps1
 * 运行：electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts\probe-editor.js
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const checks = []
  const check = (name, ok, info) => checks.push({ name, ok: Boolean(ok), info })
  const rectOf = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const mid = el => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const readScene = () => window.gewu.readScene()
  const waitScene = async (pred, ms = 8000) => {
    const end = Date.now() + ms
    let last = await readScene()
    while (Date.now() < end) {
      if (pred(last)) return last
      await wait(220)
      last = await readScene()
    }
    return last
  }
  const flat = ls => ls.flatMap(l => [{ id: l.id, name: l.name, kind: l.kind || 'code', x: l.x, y: l.y, w: l.w, h: l.h, start: l.start, end: l.end, text: l.text, locked: l.locked, visible: l.visible }, ...flat(l.children ?? [])])
  const byName = (scene, name) => flat(scene.layers).find(l => l.name === name)
  const row = name => {
    const all = qa('.tl-track-name')
    return all.find(el => el.textContent.trim() === name) || all.find(el => el.textContent.includes(name))
  }
  const pdown = (el, x, y, extra = {}) => el.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra
  }))
  const pmove = (x, y) => window.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true
  }))
  const pup = (x, y) => window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true
  }))
  const mdrag = async (el, x, y, dx, dy) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }))
    await wait(160)
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx / 2, clientY: y + dy / 2, buttons: 1 }))
    await wait(160)
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y + dy, buttons: 1 }))
    await wait(160)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y + dy }))
    await wait(900)
  }
  const out = {}
  try {
    await wait(2600)
    const cv = q('.stage-canvas')
    out.rows = qa('.tl-track').length
    out.rowNames = qa('.tl-track-name').map(el => el.textContent.trim())
    check('时间轴：4 图层 + 组合展开 2 子元素 + 1 音频 + 2 字幕 = 9 行', out.rows === 9, out.rows)
    check('时间轴：类型配色（组合/音频/字幕）',
      qa('.tl-bar.kind-audio').length === 1 && qa('.tl-bar.kind-subtitle').length === 2 && qa('.tl-bar.kind-group').length === 1,
      qa('.tl-bar').map(b => [...b.classList].find(c => c.startsWith('kind-'))))

    // ---------- 1. 选中组合里的子元素并拖动 ----------
    row('卡片标题')?.click()
    await wait(400)
    const box = q('.sel-box')
    check('时间轴选中组合内子元素 → 画布出现选择框', Boolean(box), rectOf(box))
    check('选择框带 8 个缩放手柄 + 旋转手柄', qa('.sel-box .h').length === 9, qa('.sel-box .h').length)
    const b0 = rectOf(box)
    if (box) {
      const c = mid(box)
      pdown(cv, c.x, c.y)
      await wait(120)
      pmove(c.x + 60, c.y + 30)
      await wait(120)
      pmove(c.x + 120, c.y + 60)
      await wait(120)
      const live = rectOf(q('.sel-box'))
      check('拖动时选择框跟随（不冻结）', live && Math.abs(live.x - b0.x) > 20, { from: b0, to: live })
      pup(c.x + 120, c.y + 60)
      await wait(1600)
      const s1 = await readScene()
      const title = byName(s1, '卡片标题')
      check('拖动子元素：写回 scene.json（相对组合坐标）', title && title.x > 40 && title.y > 40, title && { x: title.x, y: title.y })
      out.afterDrag = title && { x: title.x, y: title.y }
      cv.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
      await wait(1600)
      const s1u = await readScene()
      check('Ctrl+Z 撤销拖动', byName(s1u, '卡片标题')?.x === 40, byName(s1u, '卡片标题'))
    }

    // ---------- 2. 双击改字 ----------
    row('独立标题')?.click()
    await wait(350)
    const fb = rectOf(q('.sel-box'))
    if (fb) {
      const c = { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 }
      q('.stage-canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: c.x, clientY: c.y, button: 0 }))
      await wait(400)
      const ta = q('.text-editor')
      check('双击文字 → 出现内联编辑框', Boolean(ta), ta && ta.value)
      if (ta) {
        ta.focus()
        ta.select()
        document.execCommand('insertText', false, '探针改字')
        await wait(200)
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
        await wait(1600)
        const s3 = await readScene()
        out.s3 = flat(s3.layers).map(l => ({ name: l.name, kind: l.kind, text: l.text }))
        check('Ctrl+Enter 提交文字', byName(s3, '独立标题')?.text?.content === '探针改字', byName(s3, '独立标题')?.text?.content)
        check('提交后编辑框关闭', !q('.text-editor'), Boolean(q('.text-editor')))
      }
    }

    // ---------- 3. 时间轴裁剪 + 移动 ----------
    const bar = () => qa('.tl-bar').find(b => b.textContent.includes('独立标题'))
    const rHandle = bar()?.querySelector('.tl-handle.r')
    check('剪辑块有左右裁剪手柄', Boolean(bar()?.querySelector('.tl-handle.l') && rHandle), null)
    if (rHandle) {
      const before = (await readScene()).layers.find(l => l.name === '独立标题')?.end
      const c = mid(rHandle)
      await mdrag(rHandle, c.x, c.y, -120, 0)
      const after = (await readScene()).layers.find(l => l.name === '独立标题')?.end
      check('拖右柄裁短：end 变小', after < before, { before, after })
      const c2 = mid(bar())
      await mdrag(bar(), c2.x, c2.y, 90, 0)
      const s4 = await readScene()
      const moved = s4.layers.find(l => l.name === '独立标题')
      check('拖动剪辑块：start 后移', moved.start > 0, { start: moved.start, end: moved.end })
    }

    // ---------- 4. 成组 / 解组 ----------
    row('独立标题')?.click()
    await wait(200)
    row('箭头')?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
    await wait(300)
    check('Ctrl+点击：多选两个元素', qa('.sel-box').length === 2, qa('.sel-box').length)
    q('.stage-canvas').dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
    const s5 = await waitScene(s => s.layers.some(l => (l.children ?? []).some(k => k.name === '独立标题')))
    const g = s5.layers.find(l => (l.children ?? []).some(k => k.name === '独立标题'))
    check('Ctrl+G 成组：生成带盒子与子元素的组合',
      Boolean(g && g.children.length === 2 && g.w > 0 && g.h > 0),
      g && { id: g.id, name: g.name, x: g.x, y: g.y, w: g.w, h: g.h, kids: g.children.map(k => ({ name: k.name, x: k.x, y: k.y })) })
    // 解组：按这个组合自己的名字精确找行（避免和夹具里的「卡片组合」混）
    qa('.tl-track-name').find(el => el.textContent.trim() === (g?.name ?? '组合'))?.click()
    await wait(300)
    q('.stage-canvas')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true }))
    const s6 = await waitScene(s => !s.layers.some(l => l.id === g?.id))
    check('Ctrl+Shift+G 解组：组合消失、子元素回到根层级',
      !s6.layers.some(l => l.id === g?.id) && s6.layers.some(l => l.name === '独立标题'),
      { groupGone: !s6.layers.some(l => l.id === g?.id), roots: s6.layers.map(l => l.name) })

    // ---------- 5. 右键菜单 ----------
    const cr = rectOf(cv)
    pdown(cv, cr.x + cr.w / 2, cr.y + cr.h / 2, { button: 2, buttons: 2 })
    await wait(350)
    const items = qa('.ctx-item').map(b => b.textContent.trim())
    check('右键菜单弹出且项齐全', items.length >= 8, items)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(250)
    check('Esc 关闭右键菜单', !q('.ctx-menu'), Boolean(q('.ctx-menu')))

    // ---------- 6. 属性面板 ----------
    row('独立标题')?.click()
    await wait(250)
    qa('.rp-tabs button').find(b => b.textContent.includes('图层'))?.click()
    await wait(450)
    const sections = qa('.insp-section-title').map(el => el.textContent.trim())
    check('属性面板：文字专属区块', sections.includes('文字'), sections)
    check('属性面板：类型徽标', Boolean(q('.insp-tabs .kind-pill')), q('.insp-tabs .kind-pill')?.textContent)

    // 代码图层：给出「让 AI 拆成组合」的入口
    row('背景网格')?.click()
    await wait(400)
    const splitBtns = qa('.insp-split .btn').map(b => b.textContent.trim())
    check('代码图层显示「让 AI 拆成组合」', Boolean(q('.insp-split')) && splitBtns.some(t => t.includes('拆成组合')), splitBtns)
    row('卡片底')?.click()
    await wait(350)
    check('形状元素不显示拆分入口', !q('.insp-split'), Boolean(q('.insp-split')))

    // ---------- 7. 素材拖进时间轴 / 画布 ----------
    const dt = new DataTransfer()
    dt.setData('text/gewu-asset', JSON.stringify({ name: '10.31.2.png', kind: 'image' }))
    const lane = qa('.tl-lane')[0]
    if (lane) {
      lane.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      lane.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: mid(lane).x + 40, clientY: mid(lane).y }))
      await wait(1100)
      const s7 = await waitScene(s => flat(s.layers).some(l => l.kind === 'image'))
      const imgs = flat(s7.layers).filter(l => l.kind === 'image')
      check('素材拖到时间轴 → 新增图片元素', imgs.length === 1, imgs.map(i => ({ name: i.name, x: i.x, y: i.y, w: i.w })))
    }
    const dt2 = new DataTransfer()
    dt2.setData('text/gewu-asset', JSON.stringify({ name: '10.31.2.png', kind: 'image' }))
    const cr2 = rectOf(cv)
    cv.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2, clientX: cr2.x + 200, clientY: cr2.y + 200 }))
    cv.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2, clientX: cr2.x + 200, clientY: cr2.y + 200 }))
    await wait(1100)
    const s8 = await waitScene(s => flat(s.layers).filter(l => l.kind === 'image').length >= 2)
    const imgs2 = flat(s8.layers).filter(l => l.kind === 'image')
    check('素材拖到画布 → 落点新增图片元素', imgs2.length === 2, imgs2.map(i => ({ name: i.name, x: i.x, y: i.y, w: i.w, h: i.h })))

    // ---------- 8. 锁定 ----------
    const lockBtn = qa('.tl-track').find(t => t.textContent.includes('箭头'))?.querySelector('.tl-mini[title="锁定"]')
    lockBtn?.click()
    const s9 = await waitScene(s => flat(s.layers).some(l => l.locked))
    check('时间轴行内锁定按钮写回场景', flat(s9.layers).some(l => l.locked), flat(s9.layers).map(l => ({ name: l.name, locked: l.locked })))

    out.checks = checks
    out.failed = checks.filter(c => !c.ok).map(c => c.name)
    out.ok = out.failed.length === 0
    return JSON.stringify(out, null, 1)
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.stack) || err), checks }, null, 1)
  }
})()

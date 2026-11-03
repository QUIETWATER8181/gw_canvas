/**
 * 探针：手工剪辑「体验补强」——对齐/等距、参考线（标尺拖出/吸附/删除）、
 * 组合内复制粘贴、时间轴框选、Alt+拖复制、双击定位、组合裁剪提示、图层树换父级。
 *
 * 前置：powershell -NoProfile -File scripts\reset-probe-scene.ps1
 * 运行：electron.exe . --user-data=_testhome\drafts-test --probe-file=scripts\probe-editor-ops.js
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const qa = s => [...document.querySelectorAll(s)]
  const checks = []
  const check = (name, ok, info) => checks.push({ name, ok: Boolean(ok), info })
  const readScene = () => window.gewu.readScene()
  const waitScene = async (pred, ms = 8000) => {
    const end = Date.now() + ms
    let last = await readScene()
    while (Date.now() < end) {
      if (pred(last)) return last
      await wait(200)
      last = await readScene()
    }
    return last
  }
  const flat = ls => ls.flatMap(l => [{ id: l.id, name: l.name, kind: l.kind || 'code', x: l.x, y: l.y, w: l.w, h: l.h, start: l.start, end: l.end, locked: l.locked }, ...flat(l.children ?? [])])
  const byId = (scene, id) => flat(scene.layers).find(l => l.id === id)
  const rowEl = name => {
    const all = qa('.tl-track-name')
    return all.find(el => el.textContent.trim() === name) || all.find(el => el.textContent.includes(name))
  }
  const track = id => qa('.tl-track').find(t => t.dataset.id === id)
  const barOf = id => track(id)?.querySelector('.tl-bar')
  const laneOf = id => track(id)?.querySelector('.tl-lane')
  const mid = el => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const rectOf = el => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }
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
  const mdrag = async (el, x, y, dx, dy, extra = {}) => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, ...extra }))
    await wait(90)
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx / 2, clientY: y + dy / 2, buttons: 1 }))
    await wait(90)
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y + dy, buttons: 1 }))
    await wait(90)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y + dy }))
    await wait(700)
  }
  const ctrlClick = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
  const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }))
  const menuItem = text => qa('.ctx-item').find(b => b.textContent.includes(text))
  const fieldInput = labelText => {
    const field = qa('.insp-body .field').find(f => (f.querySelector('label')?.textContent ?? '').includes(labelText))
    return field?.querySelector('input')
  }
  const setNum = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const fmtTC = (t, fps) => {
    const p = n => ('0' + n).slice(-2)
    return `${p(Math.floor(t / 60))}:${p(Math.floor(t % 60))}:${p(Math.floor((t * fps) % fps))}`
  }
  const parseTC = (tc) => {
    const m = /^(\d+):(\d+):(\d+)$/.exec((tc || '').trim())
    return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 30 : NaN
  }
  const out = {}
  try {
    await wait(2600)
    const cv = q('.stage-canvas')
    const cr = rectOf(cv)
    // 画布缩放：整幅画面放进 canvas 元素（letterbox）
    const scale = Math.min(cr.w / 1920, cr.h / 1080)
    const dx0 = (cr.w - 1920 * scale) / 2
    const dy0 = (cr.h - 1080 * scale) / 2
    const toClient = (x, y) => ({ x: cr.x + dx0 + x * scale, y: cr.y + dy0 + y * scale })
    const pps = (() => {
      const b = barOf('bg-grid')
      return b ? b.getBoundingClientRect().width / 8 : 80
    })()
    out.scale = Number(scale.toFixed(3))
    out.pps = Number(pps.toFixed(2))

    // ---------- 1. 多选对齐 ----------
    rowEl('独立标题')?.click()
    await wait(250)
    ctrlClick(rowEl('箭头'))
    await wait(350)
    check('多选 2 个元素出现对齐条', qa('.align-bar .align-btn').length === 8, qa('.align-bar .align-btn').map(b => b.textContent))
    q('.align-bar button[data-align="left"]')?.click()
    const s1 = await waitScene(s => byId(s, 'free-title')?.x === 300)
    check('左对齐：两个元素左边都是 x=300', byId(s1, 'free-title')?.x === 300 && byId(s1, 'arrow-1')?.x === 300,
      { title: byId(s1, 'free-title')?.x, arrow: byId(s1, 'arrow-1')?.x })
    key(cv, 'z', { ctrlKey: true })
    const s1u = await waitScene(s => byId(s, 'free-title')?.x === 560)
    check('Ctrl+Z 撤销对齐', byId(s1u, 'free-title')?.x === 560, byId(s1u, 'free-title')?.x)

    // ---------- 2. 垂直等距（3 个元素） ----------
    ctrlClick(rowEl('卡片组合'))
    await wait(350)
    check('3 个选中 → 对齐条仍在', qa('.align-bar').length === 1, qa('.tl-track.sel').length)
    q('.align-bar button[data-align="vdist"]')?.click()
    const s2 = await waitScene(s => byId(s, 'free-title')?.y === 630)
    check('垂直等距：中间元素 y 变成 630（两端不动）',
      byId(s2, 'free-title')?.y === 630 && byId(s2, 'grp-card')?.y === 180 && byId(s2, 'arrow-1')?.y === 820,
      { group: byId(s2, 'grp-card')?.y, title: byId(s2, 'free-title')?.y, arrow: byId(s2, 'arrow-1')?.y })
    key(cv, 'z', { ctrlKey: true })
    await waitScene(s => byId(s, 'free-title')?.y === 720)

    // ---------- 3. 参考线：右键加 → 拖动吸附 → 双击删除 ----------
    const g600 = toClient(600, 400)
    pdown(cv, g600.x, g600.y, { button: 2, buttons: 2 })
    await wait(350)
    check('右键菜单有「在此加竖参考线」', Boolean(menuItem('在此加竖参考线')), qa('.ctx-item').length)
    menuItem('在此加竖参考线')?.click()
    const s3 = await waitScene(s => Array.isArray(s.guides?.v) && s.guides.v.some(x => Math.abs(x - 600) < 2))
    check('竖参考线写进 scene.guides', s3.guides?.v?.some(x => Math.abs(x - 600) < 2), s3.guides)
    check('画布上出现参考线元素', qa('.user-guide.v').length === 1, qa('.user-guide').length)

    // 箭头 x=300，往右拖 290 → 左缘落在 590，应被 600 的参考线吸住
    rowEl('箭头')?.click()
    await wait(300)
    const arrowBox = q('.sel-box')
    const ab = rectOf(arrowBox)
    pdown(cv, ab.x + ab.w / 2, ab.y + ab.h / 2)
    await wait(140)
    pmove(ab.x + ab.w / 2 + 145, ab.y + ab.h / 2)
    await wait(140)
    pmove(ab.x + ab.w / 2 + 290 * scale, ab.y + ab.h / 2)
    await wait(140)
    pup(ab.x + ab.w / 2 + 290 * scale, ab.y + ab.h / 2)
    const s4 = await waitScene(s => Math.abs((byId(s, 'arrow-1')?.x ?? 0) - 600) < 0.6)
    check('拖动时吸附到用户参考线（x=600）', Math.abs((byId(s4, 'arrow-1')?.x ?? 0) - 600) < 0.6, byId(s4, 'arrow-1')?.x)

    const guide = q('.user-guide.v')
    guide?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    const s5 = await waitScene(s => !(s.guides?.v?.length))
    check('双击参考线删除', !(s5.guides?.v?.length) && qa('.user-guide.v').length === 0, s5.guides)

    // ---------- 4. 组合内复制粘贴 ----------
    rowEl('卡片标题')?.click()
    await wait(300)
    key(cv, 'c', { ctrlKey: true })
    await wait(200)
    key(cv, 'v', { ctrlKey: true })
    const s6 = await waitScene(s => (s.layers.find(l => l.id === 'grp-card')?.children ?? []).length === 3)
    const grp = s6.layers.find(l => l.id === 'grp-card')
    const pasted = grp?.children?.find(k => k.id.startsWith('paste_'))
    check('组合内 Ctrl+C/V：粘贴回同一个组合（不掉到根层级）',
      Boolean(grp && grp.children.length === 3 && pasted) && !s6.layers.some(l => l.id.startsWith('paste_')),
      grp && { kids: grp.children.map(k => ({ id: k.id, x: k.x, y: k.y })) })
    check('粘贴体偏移 +24（相对原元素）', pasted?.x === 64 && pasted?.y === 64, pasted && { x: pasted.x, y: pasted.y })
    key(cv, 'z', { ctrlKey: true })
    await waitScene(s => (s.layers.find(l => l.id === 'grp-card')?.children ?? []).length === 2)

    // ---------- 5. 时间轴框选 ----------
    // 先把箭头裁短，空出 4s 之后的轨道区（满时长的剪辑块没有空白可拖）
    const arrowBar = barOf('arrow-1')
    const rh = arrowBar?.querySelector('.tl-handle.r')
    out.shortenDbg = { pps: Number(pps.toFixed(2)), time: q('.tl-time-cur')?.textContent, bar: arrowBar ? rectOf(arrowBar) : null, before: byId(await readScene(), 'arrow-1') }
    if (rh) {
      const rc = mid(rh)
      out.shortenDbg.handle = rc
      rh.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rc.x, clientY: rc.y, button: 0, buttons: 1 }))
      await wait(150)
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc.x - 2 * pps, clientY: rc.y, buttons: 1 }))
      await wait(150)
      out.shortenDbg.bubble1 = q('.tl-bubble')?.textContent
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rc.x - 4 * pps, clientY: rc.y, buttons: 1 }))
      await wait(150)
      out.shortenDbg.bubble2 = q('.tl-bubble')?.textContent
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rc.x - 4 * pps, clientY: rc.y }))
      await wait(900)
    }
    const s7 = await readScene()
    out.arrowEnd = byId(s7, 'arrow-1')?.end
    check('箭头裁短到 4s 左右（为框选腾出空白）', Math.abs((byId(s7, 'arrow-1')?.end ?? 0) - 4) < 0.3, byId(s7, 'arrow-1')?.end)

    // 空白轨道区单击 = 移动播放头（不能误触发框选）
    const emptyLane = laneOf('arrow-1')
    if (emptyLane) {
      const lr = rectOf(emptyLane)
      const cx = lr.left + 6 * pps
      const cy = lr.top + lr.h / 2
      emptyLane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, buttons: 1 }))
      await wait(150)
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }))
      await wait(300)
      const tc = q('.tl-time-cur')?.textContent ?? ''
      const secs = parseTC(tc)
      check('空白轨道区单击 = 移动播放头（不误选框选）', Math.abs(secs - 6) < 0.1 && qa('.tl-marquee').length === 0, { tc, secs })
    }

    const arrowLane = laneOf('arrow-1')
    const titleLane = laneOf('free-title')
    if (arrowLane && titleLane) {
      const al = rectOf(arrowLane)
      const tl = rectOf(titleLane)
      const sx = al.left + 6 * pps
      const sy = al.top + al.h / 2
      const ex = sx + 30
      const ey = tl.top + tl.h / 2
      arrowLane.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0, buttons: 1 }))
      await wait(120)
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: sx + 6, clientY: sy - 8, buttons: 1 }))
      await wait(120)
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ex, clientY: ey, buttons: 1 }))
      await wait(150)
      const marqueeSeen = Boolean(q('.tl-marquee'))
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ex, clientY: ey }))
      await wait(500)
      const selIds = qa('.tl-track.sel').map(t => t.dataset.id).filter(Boolean)
      check('轨道区拖框 → 框选多个剪辑块', marqueeSeen && selIds.length === 2 && selIds.includes('free-title') && selIds.includes('arrow-1'), { marqueeSeen, selIds })
    }

    // ---------- 6. Alt+拖复制剪辑块 ----------
    // 用已经裁短的箭头（满时长的剪辑块没有可移动空间）
    const before6 = flat((await readScene()).layers).filter(l => l.name.startsWith('箭头')).length
    const arrowBar2 = barOf('arrow-1')
    if (arrowBar2) {
      const tb = mid(arrowBar2)
      await mdrag(arrowBar2, tb.x, tb.y, 60, 0, { altKey: true })
    }
    const s8 = await waitScene(s => {
      const list = flat(s.layers).filter(l => l.name.startsWith('箭头'))
      return list.length === before6 + 1 && list.some(l => l.name.includes('副本') && (l.start ?? 0) > 0.2)
    })
    const copies = flat(s8.layers).filter(l => l.name.startsWith('箭头'))
    const orig = copies.find(l => !l.name.includes('副本'))
    const dup = copies.find(l => l.name.includes('副本'))
    check('Alt+拖：复制出一条新剪辑块（原件留在原地）', copies.length === before6 + 1 && Boolean(dup), copies.map(c => ({ name: c.name, start: c.start, end: c.end })))
    check('复制体被拖到后面（start 变大，原件 start 不变）',
      Boolean(dup && orig && dup.start > orig.start + 0.2 && orig.start === 0),
      { orig: orig && orig.start, dup: dup && dup.start })

    // ---------- 7. 双击剪辑块定位 ----------
    q('.tl-ruler')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: rectOf(q('.tl-ruler')).left + 5 * pps, clientY: rectOf(q('.tl-ruler')).top + 8, button: 0, buttons: 1 }))
    await wait(200)
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await wait(250)
    const tBefore = q('.tl-time-cur')?.textContent
    barOf('arrow-1')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await wait(400)
    const arrowStart = byId(await readScene(), 'arrow-1')?.start ?? 0
    check('双击剪辑块：选中该元素 + 播放头跳到它开头',
      Boolean(q('.tl-track.sel[data-id="arrow-1"]')) && q('.tl-time-cur')?.textContent === fmtTC(arrowStart, 30),
      { before: tBefore, after: q('.tl-time-cur')?.textContent, expect: fmtTC(arrowStart, 30) })

    // ---------- 8. 组合裁剪提示 ----------
    rowEl('卡片组合')?.click()
    await wait(250)
    qa('.rp-tabs button').find(b => b.textContent.includes('图层'))?.click()
    await wait(400)
    check('组合的时间区有「会裁剪子元素」提示',
      qa('.insp-hint').some(el => el.textContent.includes('裁剪')), qa('.insp-hint').map(el => el.textContent.trim()))
    rowEl('卡片标题')?.click()
    await wait(300)
    const endInput = fieldInput('结束')
    if (endInput) setNum(endInput, 9)
    const s9 = await waitScene(s => (byId(s, 'card-title')?.end ?? 0) > 8)
    await wait(300)
    check('子元素时间超出组合 → 时间轴行标出「被组合裁剪」',
      (byId(s9, 'card-title')?.end ?? 0) > 8 && qa('.tl-clip').length >= 1,
      { end: byId(s9, 'card-title')?.end, clip: qa('.tl-clip').length })
    key(cv, 'z', { ctrlKey: true })
    await waitScene(s => (byId(s, 'card-title')?.end ?? 0) === 8 || byId(s, 'card-title')?.end === undefined)

    // ---------- 9. 图层树拖拽换父级（坐标要换算） ----------
    const arrowX = byId(await readScene(), 'arrow-1')?.x
    const arrowY = byId(await readScene(), 'arrow-1')?.y
    const src = q('.ll-item[data-id="arrow-1"]')
    const dst = q('.ll-item[data-id="grp-card"]')
    check('图层树里能找到箭头与卡片组合', Boolean(src && dst), { src: Boolean(src), dst: Boolean(dst) })
    if (src && dst) {
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
      await wait(200)
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
      await wait(120)
      dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
      const s10 = await waitScene(s => (s.layers.find(l => l.id === 'grp-card')?.children ?? []).some(k => k.id === 'arrow-1'))
      const child = s10.layers.find(l => l.id === 'grp-card')?.children?.find(k => k.id === 'arrow-1')
      check('拖进组合：成为子元素', Boolean(child), s10.layers.find(l => l.id === 'grp-card')?.children?.map(k => k.id))
      check('换父级后坐标换算（画面不跳）',
        Boolean(child) && Math.abs((child.x ?? 0) - ((arrowX ?? 0) - 240)) < 1.5 && Math.abs((child.y ?? 0) - ((arrowY ?? 0) - 180)) < 1.5,
        { before: { x: arrowX, y: arrowY }, after: child && { x: child.x, y: child.y } })
    }

    out.checks = checks
    out.failed = checks.filter(c => !c.ok).map(c => c.name)
    out.ok = out.failed.length === 0
    return JSON.stringify(out, null, 1)
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.stack) || err), checks }, null, 1)
  }
})()

/**
 * 探针：导出画质（720p / 24fps）真的生效
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const d = () => window.__gewuDebug
  async function waitFor(fn, ms = 10000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  const setSelect = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')), 20000)
    await wait(500)

    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: false, duration: 2, fps: 30 },
      layers: [{
        id: 'exp-box', name: '导出探针', kind: 'shape',
        x: 100, y: 100, w: 800, h: 500,
        shape: { type: 'rect', fill: '#4fc3d9' },
        start: 0, end: 2,
        enter: { kind: 'fade', dur: 0.4 }
      }],
      audio: [],
      subtitles: []
    }), { label: 'probe-export' })
    await wait(500)

    const dir = 'C:\\杂七杂八的素材\\格物社AIagent开发\\_testhome\\export-out'
    await window.gewu.setExportSettings({ dir })
    out.settings = await window.gewu.getExportSettings()

    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')), 8000)
    out.dialog = Boolean(q('.xdlg'))
    const selects = qa('.xdlg-format select')
    out.selectCount = selects.length
    if (selects.length >= 3) {
      setSelect(selects[0], '720p')
      setSelect(selects[1], '24')
      setSelect(selects[2], 'balanced')
      await wait(300)
      out.estLine = q('.xdlg-label-row .tiny')?.textContent?.trim()
    }
    q('.xdlg-export')?.click()
    out.exportClicked = true
    const ok = await waitFor(() => {
      const t = q('.toast')?.textContent || ''
      return t.includes('已导出') || t.includes('导出失败')
    }, 120000)
    out.finished = ok
    out.toast = q('.toast')?.textContent?.trim() || null
    out.progress = q('.st-exporting')?.textContent?.trim() || null
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

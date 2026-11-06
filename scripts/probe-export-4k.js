/**
 * 探针：4K / 150fps 导出是否真的生效（含编码器不支持时的报错）
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = { runs: [] }
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
  async function exportOnce(resolution, fps, quality, prevToast) {
    qa('.tb-right .btn').find(b => b.textContent.includes('导出'))?.click()
    await waitFor(() => Boolean(q('.xdlg')), 8000)
    const selects = qa('.xdlg-format select')
    if (selects.length < 3) return { error: 'no format selects' }
    setSelect(selects[0], resolution)
    setSelect(selects[1], String(fps))
    setSelect(selects[2], quality)
    await wait(300)
    q('.xdlg-export')?.click()
    const done = await waitFor(() => {
      const t = q('.toast')?.textContent || ''
      const changed = t !== (prevToast || '')
      return changed && (t.includes('已导出') || t.includes('导出失败'))
    }, 180000)
    return { done, toast: q('.toast')?.textContent?.trim() || null }
  }
  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')), 20000)
    await wait(500)
    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: false, duration: 0.6, fps: 30 },
      layers: [{
        id: 'exp-box', name: '画质探针', kind: 'shape',
        x: 100, y: 100, w: 1200, h: 700,
        shape: { type: 'rect', fill: '#4fc3d9' },
        start: 0, end: 0.6
      }],
      audio: [],
      subtitles: []
    }), { label: 'probe-4k' })
    await wait(500)
    await window.gewu.setExportSettings({ dir: 'C:\\杂七杂八的素材\\格物社AIagent开发\\_testhome\\export-4k' })

    const first = await exportOnce('4k', 30, 'small')
    out.runs.push({ name: '4k30', ...first })
    await wait(3600)
    const second = await exportOnce('720p', 150, 'small', first.toast)
    out.runs.push({ name: '720p150', ...second })
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

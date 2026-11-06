/**
 * 探针：时长自动缩放 / 进出场动画像素 / 音效 / 联网素材检索
 * 用 window.__gewuDebug（App 暴露的只读调试入口）驱动，不需要点鼠标。
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const qa = sel => [...document.querySelectorAll(sel)]
  const d = () => window.__gewuDebug
  const sampleCenter = () => {
    const c = q('.stage-canvas')
    if (!c) return null
    const ctx = c.getContext('2d')
    const x = Math.round(c.width / 2)
    const y = Math.round(c.height / 2)
    const p = ctx.getImageData(x, y, 1, 1).data
    return { r: p[0], g: p[1], b: p[2], a: p[3] }
  }
  async function waitFor(fn, ms = 10000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(120) }
    return false
  }

  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')), 20000)
    await wait(600)

    // ---- 1. 时长跟随素材 ----
    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: true },
      layers: [{
        id: 'probe-box', name: '探针白块', kind: 'shape',
        x: 0, y: 0, w: 1920, h: 1080,
        shape: { type: 'rect', fill: '#ffffff' },
        start: 0, end: 6.4,
        enter: { kind: 'fade', dur: 2 }
      }],
      audio: [],
      subtitles: []
    }), { label: 'probe-setup' })
    await wait(400)
    out.autoDurationAfterExtend = d().getScene().canvas.duration

    d().editor.updateLayer('probe-box', { end: 3.2 })
    await wait(400)
    out.autoDurationAfterShrink = d().getScene().canvas.duration

    d().editor.updateScene(s => ({ ...s, canvas: { ...s.canvas, autoDuration: false, duration: 5 } }), { label: 'probe-manual' })
    await wait(200)
    d().editor.updateLayer('probe-box', { end: 7.7 })
    await wait(400)
    out.manualExtendOnOverflow = d().getScene().canvas.duration

    // ---- 2. 进出场动画：中间像素亮度 ----
    d().editor.setTime(0.2)
    await wait(450)
    out.fadeEarly = sampleCenter()
    d().editor.setTime(2.2)
    await wait(450)
    out.fadeFull = sampleCenter()
    d().editor.updateLayer('probe-box', { end: 4, exit: { kind: 'fade', dur: 1 } })
    d().editor.setTime(3.9)
    await wait(450)
    out.fadeExit = sampleCenter()

    // ---- 3. 音效：点「音频」→ 加第一条 ----
    qa('.lp-rail-btn').find(b => b.textContent.includes('音频'))?.click()
    await wait(300)
    out.sfxCards = qa('.sfx-card').length
    const before = d().getScene().audio.length
    qa('.sfx-add')[0]?.click()
    await wait(1200)
    out.audioBefore = before
    out.audioAfter = d().getScene().audio.length
    out.lastAudio = d().getScene().audio.slice(-1)[0] || null
    const assets = await window.gewu.listAssets()
    out.sfxAssetExists = assets.some(a => a.name === 'sfx-whoosh.wav')

    // ---- 4. 联网素材检索 ----
    try {
      const res = await window.gewu.searchAssets({ query: 'polarization', source: 'commons', limit: 6 })
      out.searchOk = res.ok
      out.searchError = res.error || null
      out.searchCount = res.items.length
      out.searchFirst = res.items[0] ? {
        title: res.items[0].title,
        license: res.items[0].license,
        artist: res.items[0].artist,
        thumb: Boolean(res.items[0].thumbUrl),
        downloadable: res.items[0].downloadable,
        size: `${res.items[0].width}x${res.items[0].height}`
      } : null
      const pick = res.items.find(i => i.downloadable)
      if (pick) {
        const dl = await window.gewu.downloadAsset(pick)
        out.downloadOk = dl.ok
        out.downloadPath = dl.path || null
        out.downloadError = dl.error || null
        out.credits = (await window.gewu.listCredits()).length
      }
    } catch (e) {
      out.searchFatal = String(e)
    }

    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

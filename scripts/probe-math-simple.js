/**
 * 聚焦探针：g.math 是否真的画出了像素（和 g.text / shape 对照）
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const d = () => window.__gewuDebug
  async function waitFor(fn, ms = 20000) {
    const end = Date.now() + ms
    while (Date.now() < end) { if (fn()) return true; await wait(150) }
    return false
  }
  ;(async () => {
    await waitFor(() => Boolean(d() && q('.stage-canvas')))
    await wait(500)
    d().editor.updateScene(s => ({
      ...s,
      canvas: { ...s.canvas, autoDuration: false, duration: 2 },
      layers: [
        { id: 'txt', name: '文字', kind: 'code', start: 0, end: 2, draw: "g.text('HELLO', 300, 300, { size: 80, color: '#ff0000' })" },
        { id: 'mth', name: '公式', kind: 'code', start: 0, end: 2, draw: "g.math('x^2 + y^2', 300, 600, { size: 80, color: '#00ff00' })" },
        { id: 'shp', name: '形状', kind: 'shape', x: 800, y: 200, w: 300, h: 200, shape: { type: 'rect', fill: '#0000ff' }, start: 0, end: 2 }
      ],
      audio: [],
      subtitles: []
    }), { label: 'probe-math-simple' })
    d().editor.setTime(1)
    await wait(1000)
    const canvas = q('.stage-canvas')
    const ctx = canvas.getContext('2d')
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let red = 0, green = 0, blue = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (r > 150 && g < 100 && b < 100) red++
      else if (g > 150 && r < 100 && b < 100) green++
      else if (b > 150 && r < 100 && g < 100) blue++
    }
    out.counts = { red, green, blue }
    out.size = { w: canvas.width, h: canvas.height }
    out.sceneLayers = d().editor.state.scene.layers.map(l => ({ id: l.id, draw: l.draw?.slice(0, 50) }))
    resolve(JSON.stringify(out, null, 2))
  })().catch(e => resolve(JSON.stringify({ ...out, fatal: String(e && e.stack || e) }, null, 2)))
}))()

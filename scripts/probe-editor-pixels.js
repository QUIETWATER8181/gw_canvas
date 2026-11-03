/**
 * 探针：画布像素体检（组合内子元素、文字、形状真的画出来了）
 * 前置：powershell -NoProfile -File scripts\reset-probe-scene.ps1
 */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const q = s => document.querySelector(s)
  const out = {}
  try {
    await wait(3200)
    const cv = q('.stage-canvas')
    const W = cv.width
    const H = cv.height
    const tmp = document.createElement('canvas')
    tmp.width = W
    tmp.height = H
    const ctx = tmp.getContext('2d')
    ctx.drawImage(cv, 0, 0)
    const img = ctx.getImageData(0, 0, W, H).data
    const sx = W / 1920
    const sy = H / 1080
    const region = (x, y, w, h) => {
      let n = 0, sum = 0, gold = 0, cyan = 0
      const x0 = Math.max(0, Math.round(x * sx))
      const x1 = Math.min(W, Math.round((x + w) * sx))
      const y0 = Math.max(0, Math.round(y * sy))
      const y1 = Math.min(H, Math.round((y + h) * sy))
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * W + xx) * 4
          const r = img[i], g = img[i + 1], b = img[i + 2]
          const lum = 0.299 * r + 0.587 * g + 0.114 * b
          sum += lum
          n++
          if (r > 180 && g > 130 && b < 110) gold++
          if (b > 140 && g > 130 && r < 130) cyan++
        }
      }
      return { px: n, mean: Number((sum / Math.max(1, n)).toFixed(1)), gold, cyan }
    }
    out.size = { W, H }
    // 组合里的卡片底 + 边框（设计 240,180 640x360）
    out.card = region(240, 180, 640, 360)
    out.cardBorder = region(240, 180, 640, 8)
    // 卡片标题文字（相对组合 40,40 → 绝对 280,220，560x80）
    out.cardTitle = region(280, 220, 560, 80)
    // 独立标题（金色，560,720 800x100）
    out.freeTitle = region(560, 720, 800, 100)
    // 箭头（300,820 → 600,940）
    out.arrow = region(300, 820, 300, 120)
    // 空白处（右下角）
    out.blank = region(1500, 900, 300, 120)

    out.checks = {
      cardDarkerThanBg: out.card.mean < 40,
      borderVisible: out.card.cyan > 500,
      cardTitlePainted: out.cardTitle.mean > out.card.mean + 4,
      freeTitleGold: out.freeTitle.gold > 200,
      arrowCyan: out.arrow.cyan > 100,
      blankEmpty: out.blank.mean < 30
    }
    out.ok = Object.values(out.checks).every(Boolean)
    return JSON.stringify(out, null, 1)
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.stack) || err), out }, null, 1)
  }
})()

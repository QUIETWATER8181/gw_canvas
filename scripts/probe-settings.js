/**
 * 设置面板探针：打开「模型设置」，检查视觉模型选择器。
 * 用法：electron.exe . --probe-file=scripts/probe-settings.js --probe-wait=3000
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  ;(async () => {
    for (let i = 0; i < 40; i++) {
      const st = document.querySelector('.tb-status')?.textContent ?? ''
      if (st.includes('就绪') || st.includes('异常')) break
      await wait(500)
    }
    document.querySelector('.tb-status')?.click()
    await wait(600)

    out.modalOpen = Boolean(document.querySelector('.modal'))
    const sel = document.querySelector('.vision-select')
    out.hasVisionSelect = Boolean(sel)
    out.visionValue = sel?.value ?? null
    out.visionOptions = sel ? [...sel.options].map(o => o.textContent) : []
    out.hint = document.querySelector('.vision-pick .hint')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 90)
    out.presets = [...document.querySelectorAll('.preset-row .tb-chip')].map(b => b.textContent)

    // 选中 mock 连接当视觉模型
    if (sel && sel.options.length > 1) {
      const target = sel.options[1].value
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(sel, target)
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      await wait(700)
      out.afterPick = document.querySelector('.vision-select')?.value
    }
    resolve(JSON.stringify(out))
  })()
}))()

/**
 * 调试探针：发一条 prompt，等工具条跑完，打印 chip 列表和助手文字。
 * 用法：
 *   electron.exe . --probe-file=scripts/probe-chat.js --prompt-text="做一个偏振光动画"
 * 不传 --prompt-text 就用默认那句。
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const setTa = (el, v) => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const out = {}
  ;(async () => {
    const chatTab = [...document.querySelectorAll('.rp-tabs button')].find(b => b.textContent.includes('AI'))
    chatTab?.click()
    await wait(300)
    for (let i = 0; i < 60; i++) {
      const st = document.querySelector('.tb-status')?.textContent ?? ''
      if (st.includes('就绪') || st.includes('异常')) break
      await wait(500)
    }
    out.status = document.querySelector('.tb-status')?.textContent
    setTa(document.querySelector('.rp-input'), '做一个偏振光动画')
    await wait(400)
    ;[...document.querySelectorAll('.rp-composer-actions .btn')].find(b => b.textContent.includes('发送'))?.click()

    for (let i = 0; i < 90; i++) {
      await wait(1000)
      const chips = [...document.querySelectorAll('.tool-chip')]
      if (chips.length >= 1 && chips.every(c => c.className.includes('done') || c.className.includes('error'))) {
        await wait(2500)
        break
      }
    }
    out.chips = [...document.querySelectorAll('.tool-chip .tool-title')].map(e => e.textContent)
    out.chipState = [...document.querySelectorAll('.tool-chip')].map(e => e.className.replace('tool-chip ', ''))
    out.asst = [...document.querySelectorAll('.msg.assistant .msg-body')].map(e => e.textContent).join(' | ').slice(0, 200)
    out.err = document.querySelector('.msg.err')?.textContent ?? null
    out.tokens = document.querySelector('.rp-count')?.textContent
    resolve(JSON.stringify(out))
  })()
}))()

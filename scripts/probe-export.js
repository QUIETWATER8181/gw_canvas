/**
 * 调试探针：等界面就绪后点「导出」，等导出结束，打印结果。
 * 用法（配合主进程的 --export-path 指定落盘位置）：
 *   electron.exe . --probe-file=scripts/probe-export.js --export-path=_out.mp4
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  ;(async () => {
    for (let i = 0; i < 60; i++) {
      const st = document.querySelector('.tb-status')?.textContent ?? ''
      if (st && !st.includes('启动')) break
      await wait(500)
    }
    out.status = document.querySelector('.tb-status')?.textContent
    const btn = [...document.querySelectorAll('.tb-right .btn')].find(b => b.textContent.includes('导出'))
    out.btnFound = !!btn
    if (!btn) return resolve(JSON.stringify(out))
    btn.click()
    let last = ''
    for (let i = 0; i < 300; i++) {
      await wait(1000)
      const toast = document.querySelector('.toast')?.textContent ?? ''
      const prog = document.querySelector('.export-toast')?.textContent ?? ''
      last = toast || prog
      if (toast.includes('已导出') || toast.includes('失败')) break
    }
    out.finalToast = last
    resolve(JSON.stringify(out))
  })()
}))()

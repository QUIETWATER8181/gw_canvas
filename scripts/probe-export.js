/**
 * 调试探针：等界面就绪后点「导出」→ 在导出对话框里点「开始导出」，等结束，打印结果。
 * 用法（配合主进程的 --export-path 指定落盘位置，会预填到对话框里）：
 *   electron.exe . --probe-file=scripts/probe-export.js --export-path=_out.mp4
 */
(() => new Promise(resolve => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const out = {}
  const q = sel => document.querySelector(sel)
  const text = sel => q(sel)?.textContent?.trim() ?? null
  ;(async () => {
    for (let i = 0; i < 60; i++) {
      const st = text('.tb-status') ?? ''
      if (st && !st.includes('启动')) break
      await wait(500)
    }
    out.status = text('.tb-status')
    const btn = [...document.querySelectorAll('.tb-right .btn')].find(b => b.textContent.includes('导出'))
    out.btnFound = !!btn
    if (!btn) return resolve(JSON.stringify(out))
    btn.click()
    // 新流程：先开导出对话框，确认位置/文件名后再导
    for (let i = 0; i < 40 && !q('.xdlg'); i++) await wait(200)
    out.dialog = { open: !!q('.xdlg'), dir: text('.xdlg-path > span'), name: q('.xdlg-name-row input')?.value }
    q('.xdlg-export')?.click()
    let last = ''
    for (let i = 0; i < 300; i++) {
      await wait(1000)
      const toast = text('.toast') ?? ''
      const prog = text('.export-toast') ?? ''
      last = toast || prog
      if (toast.includes('已导出') || toast.includes('失败')) break
    }
    out.finalToast = last
    resolve(JSON.stringify(out))
  })()
}))()

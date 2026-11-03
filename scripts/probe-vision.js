/**
 * 视觉模型探针：直接调 window.gewu.visionDescribe，不经过 agent。
 * 用法：electron.exe . --probe-file=scripts/probe-vision.js --probe-wait=4000
 * 依赖工作区里已有一张 assets/kf_a.png（或改下面的 PATH）。
 */
(() => new Promise(resolve => {
  const PATH = 'assets/kf_a.png'
  ;(async () => {
    const out = {}
    out.hasApi = typeof window.gewu?.visionDescribe === 'function'
    const r = await window.gewu.visionDescribe({ path: PATH })
    out.ok = r.ok
    out.model = r.model
    out.ms = r.ms
    out.text = r.text ? r.text.slice(0, 400) : undefined
    out.error = r.error

    // 再测一次自定义问题 + 一张不存在的图（看错误提示）
    const bad = await window.gewu.visionDescribe({ path: 'assets/不存在.png' })
    out.badOk = bad.ok
    out.badError = bad.error
    resolve(JSON.stringify(out))
  })()
}))()

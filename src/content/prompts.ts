/** 左栏快捷操作拼出来的 prompt。抽成纯函数，方便自检。 */

export interface KeyframeInput {
  firstPath: string
  lastPath: string
  duration: number
  note?: string
  width?: number
  height?: number
}

/** 首尾帧补间 */
export function keyframePrompt(input: KeyframeInput): string {
  const dur = Math.max(1, Math.min(60, Number(input.duration) || 6))
  const w = input.width ?? 1920
  const h = input.height ?? 1080
  const note = (input.note ?? '').trim()
  return (
    `用首尾帧补间做一个 ${dur} 秒的动画。\n\n` +
    `首帧：${input.firstPath}\n` +
    `尾帧：${input.lastPath}\n` +
    (note ? `补充要求：${note}\n` : '') +
    `\n按这个流程做，不要跳步：\n` +
    `1. asset_import 把两张图导入 assets/。\n` +
    `2. image_inspect 各看一遍，弄清画面里有什么元素、什么配色。\n` +
    `3. image_compare 拿运动向量，确定主体从哪移到哪、变了多少。\n` +
    `4. 选做法：主体是矢量元素（圆、箭头、光路、波形、图表）就用代码重建并插值——这是首选；` +
    `主体是照片/复杂插画就用 g.image 把首尾帧交叉淡入，再叠代码画的矢量元素承担「动」的部分；也可以两者结合。\n` +
    `5. 画布 ${w}×${h}，时长 ${dur} 秒。首帧必须和第一张图对得上，尾帧必须和第二张图对得上。\n` +
    `6. scene_render_frame({ times: [0, ${(dur / 2).toFixed(1)}, ${dur}] }) 自检，确认首尾两帧构图对得上、中间没有跳变。\n` +
    `7. 最后告诉我：你选了哪种做法、中间补了什么、还能怎么调。`
  )
}

/** 单张参考图 */
export function referencePrompt(name: string, path: string): string {
  return (
    `以我提供的参考图「${name}」（本地路径：${path}）为准，把它导入工作区并用代码还原成可动画的场景。\n` +
    `要求：\n1. 先用 asset_import 把图导入 assets/，再用 image_inspect 看清它。\n` +
    `2. 保持参考图的构图与配色（用 image_inspect 返回的主色重建 theme），` +
    `但把需要动的部分（箭头、光路、波形、粒子）拆成独立图层，用代码做动画。\n` +
    `3. 先给出一版 6–10 秒的场景，渲染一帧自检后告诉我效果。`
  )
}

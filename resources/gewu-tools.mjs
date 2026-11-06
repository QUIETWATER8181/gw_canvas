import net from 'node:net'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'gewu-tool-gateway'
export const inject = ['tools']

const MAX_WIRE_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 30 * 60_000

function callHost(tool, args, agent, signal) {
  const socketPath = process.env.GEWU_BRIDGE_SOCKET
  const token = process.env.GEWU_BRIDGE_TOKEN
  if (!socketPath || !token || !agent?.id) throw new Error('格物工具网关未绑定当前任务')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath })
    let received = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('工具网关响应超时')), TIMEOUT_MS)
    const abort = () => finish(new Error('任务已取消'))
    signal?.addEventListener?.('abort', abort, { once: true })
    socket.on('connect', () => {
      const frame = JSON.stringify({ token, sessionId: agent.id, tool, args }) + '\n'
      if (Buffer.byteLength(frame) > MAX_WIRE_BYTES) return finish(new Error('工具请求超出上限'))
      socket.write(frame)
    })
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (Buffer.byteLength(received) > MAX_WIRE_BYTES) return finish(new Error('工具结果超出上限'))
      const end = received.indexOf('\n')
      if (end < 0) return
      let response
      try { response = JSON.parse(received.slice(0, end)) } catch { return finish(new Error('工具网关返回无效数据')) }
      if (response?.ok !== true) return finish(new Error(typeof response?.error === 'string' ? response.error : '工具调用被拒绝'))
      finish(null, typeof response.result === 'string' ? response.result : JSON.stringify(response.result))
    })
    socket.on('error', () => finish(new Error('工具网关不可用')))
    socket.on('close', () => finish(new Error('工具网关已关闭')))
  })
}

const tools = [
  {
    name: 'scene_read',
    description: '读取当前 scene.json 的完整内容（含所有图层的绘制代码）。修改场景前先用它确认现状。',
    parameters: {}
  },
  {
    name: 'scene_inspect',
    description: '只读取场景摘要：标题、画布、时长、元素树（id/类型/名称/时间区间/位置/文字预览，组合内缩进），不含绘制代码。开销小，适合每轮开始确认状态。',
    parameters: {}
  },
  {
    name: 'scene_write',
    description: '用完整的新场景对象覆盖 scene.json。适合大改；小改用 scene_set_layer。返回写入后的元素数与时长。注意：新场景请把每个有语义的对象写成独立元素（kind:text/image/shape），相关的放进 kind:"group" 的 children，方便用户手动拖动/改字。',
    parameters: {
      scene: { type: 'object', additionalProperties: true, required: true, description: '完整的 Scene 对象，结构见 AGENTS.md（layers 支持 children 嵌套）' }
    }
  },
  {
    name: 'scene_set_layer',
    description: '修改单个元素：只传要改的字段。id 在任意嵌套深度都能定位（组合里的子元素也能直接改）。也支持通过 canvas 字段顺带改画布时长/自动时长。要改多处时优先用 scene_batch，一次调用省 token。',
    parameters: {
      id: { type: 'string', required: true },
      patch: {
        type: 'object', additionalProperties: true, required: true,
        description: '可含 name/draw/x/y/w/h/scale/rotation/opacity/blend/visible/start/end/bounds/note/kind/text/image/shape/children/enter/exit。enter/exit 是进出场动画：{ kind:"fade|slide-left|slide-right|slide-up|slide-down|zoom-in|zoom-out|wipe-left|wipe-right", dur?:秒, delay?:秒, ease?:linear|outCubic|inOutCubic|outBack, distance?:像素 }'
      },
      canvas: { type: 'object', additionalProperties: true, description: '可选，画布字段 width/height/fps/duration/background/autoDuration' }
    }
  },
  {
    name: 'scene_batch',
    description: '一次调用批量改场景（推荐：比连续多次 scene_set_layer 省很多 token，也少一轮自检）。ops 按顺序执行：{op:"set",id,patch} / {op:"add",layer,parent?} / {op:"delete",id} / {op:"canvas",canvas:{duration,autoDuration,fps}}。单个 op 失败不影响其它 op，返回 errors。',
    parameters: {
      ops: {
        type: 'array', required: true,
        description: '操作数组，最多 60 个。例：[{"op":"set","id":"title","patch":{"x":120}},{"op":"add","layer":{"id":"arrow2","kind":"shape","x":700,"y":400,"w":260,"h":0,"shape":{"type":"arrow"}}},{"op":"canvas","canvas":{"autoDuration":true}}]'
      }
    }
  },
  {
    name: 'scene_add_layer',
    description: '新增一个元素。id 省略时自动生成。要么给 draw（绘制代码），要么给 kind=text/image/shape/group 加对应属性。给了 parent 就加进那个组合的 children。',
    parameters: {
      layer: {
        type: 'object', additionalProperties: true, required: true,
        description: '{ id?, name, kind?, draw?, x?, y?, w?, h?, rotation?, opacity?, start?, end?, note?, text?, image?, shape?, children? }'
      },
      parent: { type: 'string', description: '可选，父组合的 id；省略则加到顶层' }
    }
  },
  {
    name: 'scene_delete_layer',
    description: '删除一个元素（组合里的子元素也可以直接删）。',
    parameters: { id: { type: 'string', required: true } }
  },
  {
    name: 'scene_restructure',
    description: '把「一整段画死的代码」重组成「组合 + 可单独编辑的元素」时，先调用它拿到拆分要求。它不会改场景，只返回一份可执行的拆分指引（含目标图层信息），然后你按指引用 scene_write 写入新结构。用户点「让 AI 拆成组合」时也会走这条路。',
    parameters: { id: { type: 'string', description: '要拆的图层 id；省略表示整个场景' } }
  },
  {
    name: 'scene_render_frame',
    description: '渲染指定时刻并返回「字符预览 + 各图层实际占据范围 + 图层报错」，这是你的基本眼睛。一次可给多个时刻（times，最多 4 个）来检查整段动画的走向。加 describe:true 会再让视觉模型描述这一帧真正长什么样（慢、花钱，但能看出构图和"像不像"）。',
    parameters: {
      t: { type: 'number', description: '单个时刻（秒）' },
      times: { type: 'array', items: { type: 'number' }, description: '多个时刻（秒），最多 4 个；给了 times 就忽略 t' },
      cols: { type: 'number', description: '字符预览列数，缺省 96；多帧时自动降到 72' },
      describe: { type: 'boolean', description: '是否再让视觉模型描述这一帧（仅单帧时生效）' }
    }
  },
  {
    name: 'scene_export_video',
    description: '把当前场景导出为 mp4（含音频与字幕），文件写入工作区 exports/ 目录，不需要用户确认。耗时长（1080p 大约 1 秒视频要渲染 1 秒），只在用户明确要求或收尾时调用。可以按需要改帧率/分辨率/清晰度。',
    parameters: {
      name: { type: 'string', description: '输出文件名，缺省自动生成' },
      from: { type: 'number', description: '起始秒，缺省 0' },
      to: { type: 'number', description: '结束秒，缺省整段' },
      fps: { type: 'number', description: '帧率 24/25/30/50/60/120/150，缺省跟场景；4K 建议 ≤60，150fps 建议 ≤1080p' },
      width: { type: 'number', description: '输出宽度，缺省 1920；4K 用 3840，2K 用 2560' },
      height: { type: 'number', description: '输出高度，缺省 1080；4K 用 2160，2K 用 1440' },
      quality: { type: 'string', description: 'high / balanced / small，缺省 balanced' }
    }
  },
  {
    name: 'asset_import',
    description: '把用户提供的本地图片/视频复制进工作区 assets/ 目录，返回相对路径和 gewu:// URL，可在绘制代码里用 asset() 引用。',
    parameters: { path: { type: 'string', required: true, description: '源文件的绝对路径' } }
  },
  {
    name: 'tts_speak',
    description: '用本机离线语音（Windows SAPI，不需要 Key）把一段中文念成 wav，存进 assets/ 并返回 path 和 durationSec。要加旁白时：先 tts_speak 拿到时长，再把这个 path 写进 scene.audio 的 src，start 用字幕的开始时刻。',
    parameters: {
      text: { type: 'string', required: true, description: '要念的文字，别超过 60 字，长句拆成多条' },
      name: { type: 'string', description: '文件名（不含扩展名），缺省自动生成；同一个 name 会覆盖，适合重做某一句' },
      voice: { type: 'string', description: '音色名，缺省用系统中文音色' },
      rate: { type: 'number', description: '语速 -10~10，0 是正常，中文旁白建议 0~2' }
    }
  },
  {
    name: 'check_scene',
    description: '抽样渲染整条时间轴，报告图层运行时错误；同时做静态检查（id 重复、draw 写成函数声明或箭头函数、用了被禁用的全局、end 不大于 start、画布尺寸不对等）。写完场景后应该跑一次。',
    parameters: { samples: { type: 'number', description: '抽样点数，缺省 8' } }
  },
  {
    name: 'image_inspect',
    description: '「看」一张图片的明暗分布：返回字符预览、主色、平均亮度、细节密度和 8×5 分区平均色。便宜快，但看不出「画的是什么」。要真正看懂内容用 image_describe。只看 assets/ 下的相对路径。',
    parameters: {
      path: { type: 'string', required: true, description: '图片相对路径，如 assets/frame1.png' },
      cols: { type: 'number', description: '字符预览列数，缺省 64，最多 120' }
    }
  },
  {
    name: 'image_describe',
    description: '让视觉模型真正「看懂」一张图：返回对画面主体、位置、几何元素、配色、文字的中文描述。比 image_inspect 慢且要花钱，但构图、元素、文字只有它能看出来。用户给参考图/首帧/尾帧，或者你想确认自己画出来的到底是什么样，就用它。',
    parameters: {
      path: { type: 'string', required: true, description: '图片相对路径，如 assets/frame1.png 或 assets/preview-0_00.png' },
      question: { type: 'string', description: '想特别问的点；缺省是「客观描述画面，供后续用代码复现」' }
    }
  },
  {
    name: 'image_compare',
    description: '比较两张图（通常是首帧和尾帧），返回变化区域包围盒、变化占比、内容整体位移方向和 12×7 变化强度图。做首尾帧补间前必须调用。',
    parameters: {
      first: { type: 'string', required: true, description: '起始图片相对路径' },
      last: { type: 'string', required: true, description: '结束图片相对路径' }
    }
  },
  {
    name: 'asset_svg',
    description: '生成一张 SVG 素材并写进 assets/（图标、示意图、公式占位、箭头/刻度等）。不用联网、没有版权问题。只能写纯静态 SVG，不能含 script/foreignObject/事件属性。',
    parameters: {
      name: { type: 'string', description: '文件名（不含扩展名），缺省自动生成' },
      svg: { type: 'string', required: true, description: '完整的 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>' }
    }
  },
  {
    name: 'sfx_add',
    description: '加一条现场合成的音效到时间轴（无需联网、无版权问题）。可用 preset：whoosh（呼啸）/ swoosh（轻扫）/ riser（上升）/ transition（转场）/ pop（弹出）/ click（点击）/ tick（滴答）/ typing（打字）/ ding（叮）/ success（完成）/ error（错误）/ impact（撞击）。音效要卡在画面节点上：at 用对应图层的 start 或 end。',
    parameters: {
      preset: { type: 'string', required: true, description: '音效名（见工具描述）' },
      at: { type: 'number', required: true, description: '开始时刻（秒）' },
      volume: { type: 'number', description: '音量 0–2，缺省 0.8；音效不要盖过旁白' }
    }
  },
  {
    name: 'asset_search',
    description: '联网检索图片素材（Wikimedia Commons / Openverse，不需要 Key）。返回候选的 id、尺寸、许可证、作者。用于找物理示意图、实验照片、公式图、历史图片。找公式/示意图优先用英文关键词（如 "Malus law", "polarization wave"）。',
    parameters: {
      query: { type: 'string', required: true, description: '搜索词，英文效果通常更好' },
      source: { type: 'string', description: 'commons（默认，推荐）或 openverse' },
      limit: { type: 'number', description: '返回数量，缺省 12，最多 24' }
    }
  },
  {
    name: 'asset_download',
    description: '把 asset_search 里选中的素材下载进当前草稿 assets/，自动记录作者/许可证到 assets/credits.json。返回 path，之后用 kind:"image" 或 g.image(path) 使用。',
    parameters: {
      id: { type: 'string', required: true, description: 'asset_search 返回的 id' }
    }
  },
  {
    name: 'knowledge_search',
    description: '检索本地知识库：物理（physics）/ 数学（math）/ 剪辑分镜（storyboard）。写场景前如果不确定公式、物理图像、分镜节奏，先查这里；只返回命中的 1–2 条，比整份读便宜。常用查询：「马吕斯定律」「偏振」「导数 切线」「矩阵 变换」「对照实验 分镜」「五拍结构」。',
    parameters: {
      query: { type: 'string', required: true, description: '关键词，中文即可（如「马吕斯定律」「导数」「对照实验 分镜」）' },
      topic: { type: 'string', description: '可选：physics / math / storyboard；不填则全部搜' },
      limit: { type: 'number', description: '返回条数，缺省 2，最多 4' }
    }
  },
  {
    name: 'ask_user',
    description: '当需求存在关键歧义（讲什么现象、时长、风格、是否需要公式）时向用户提问。调用后结束本轮。',
    parameters: {
      question: { type: 'string', required: true },
      options: { type: 'array', items: { type: 'string' }, description: '可选答案' }
    }
  }
]

export function apply(ctx) {
  for (const tool of tools) {
    ctx.tools.register(defineTool({
      ...tool,
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute(args, exec) { return callHost(tool.name, args, exec.agent, exec.signal) }
    }))
  }
}

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
    description: '只读取场景摘要：标题、画布、时长、图层清单（id/名称/时间区间），不含绘制代码。开销小，适合每轮开始确认状态。',
    parameters: {}
  },
  {
    name: 'scene_write',
    description: '用完整的新场景对象覆盖 scene.json。适合大改；小改用 scene_set_layer。返回写入后的图层数与时长。',
    parameters: {
      scene: { type: 'object', additionalProperties: true, required: true, description: '完整的 Scene 对象，结构见 AGENTS.md' }
    }
  },
  {
    name: 'scene_set_layer',
    description: '修改单个图层：只传要改的字段。也支持通过 canvas 字段顺带改画布尺寸/时长。',
    parameters: {
      id: { type: 'string', required: true },
      patch: {
        type: 'object', additionalProperties: true, required: true,
        description: '可含 name/draw/x/y/opacity/blend/visible/start/end/bounds/note'
      },
      canvas: { type: 'object', additionalProperties: true, description: '可选，画布字段 width/height/fps/duration/background' }
    }
  },
  {
    name: 'scene_add_layer',
    description: '新增一个图层。id 省略时自动生成。draw 为绘制代码。',
    parameters: {
      layer: {
        type: 'object', additionalProperties: true, required: true,
        description: '{ id?, name, draw, x?, y?, opacity?, start?, end?, note? }'
      }
    }
  },
  {
    name: 'scene_delete_layer',
    description: '删除一个图层。',
    parameters: { id: { type: 'string', required: true } }
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
    description: '把当前场景导出为 mp4（含音频与字幕），文件写入工作区 exports/ 目录，不需要用户确认。耗时长（1080p 大约 1 秒视频要渲染 1 秒），只在用户明确要求或收尾时调用。',
    parameters: {
      name: { type: 'string', description: '输出文件名，缺省自动生成' },
      from: { type: 'number', description: '起始秒，缺省 0' },
      to: { type: 'number', description: '结束秒，缺省整段' }
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

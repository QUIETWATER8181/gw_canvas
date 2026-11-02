// 本地假 OpenAI 兼容服务，用于在没有真实 API Key 的情况下验证
// 「DSH 运行时 → ACP → 模型代理 → 工具网关 → 渲染进程」整条链路。
// 用法：$env:MOCK_MODE='text|inspect|frame|write|scene'; node scripts/mock-openai.mjs 8787
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8787)
const MODE = process.env.MOCK_MODE ?? 'text'

// 夹具：默认指向工作区里的两张合成图，可用环境变量覆盖
const WS = process.env.APPDATA ? `${process.env.APPDATA}\\gewu-video\\workspace` : '.'
const FIXTURE_A = process.env.MOCK_FIXTURE_A ?? `${WS}\\assets\\kf_a.png`
const FIXTURE_B = process.env.MOCK_FIXTURE_B ?? `${WS}\\assets\\kf_b.png`

const DEMO_SCENE = {
  version: 1,
  meta: { title: 'mock 生成的场景', brief: '验证 scene_write 全链路', style: '深色矢量' },
  canvas: { width: 1920, height: 1080, fps: 30, duration: 6 },
  layers: [
    {
      id: 'bg',
      name: '背景',
      start: 0,
      end: 6,
      draw: "const gd = ctx.createLinearGradient(0, 0, 0, height)\ngd.addColorStop(0, '#101820')\ngd.addColorStop(1, '#080c11')\nctx.fillStyle = gd\nctx.fillRect(0, 0, width, height)"
    },
    {
      id: 'title',
      name: '标题',
      start: 0,
      end: 6,
      draw: "const a = ease.outCubic(ease.span(t, 0, 0.8))\nctx.globalAlpha = a\ng.text('mock 生成的场景', 120, 140, { size: 56, weight: 700, color: theme.fg })\ng.text('由 scene_write 一次写入', 120, 200, { size: 24, color: theme.muted })"
    },
    {
      id: 'wave',
      name: '正弦波',
      start: 0,
      end: 6,
      draw: "const pts = []\nfor (let x = 120; x <= 1800; x += 6) {\n  const k = (x - 120) / 260\n  pts.push({ x, y: 560 - Math.sin(k - t * 4) * 90 * ease.outCubic(ease.span(t, 0.2, 1.4)) })\n}\ng.glow(pts, theme.accent, 2.5)"
    },
    {
      id: 'formula',
      name: '公式',
      start: 0.4,
      end: 6,
      draw: "const a = ease.outCubic(ease.span(t, 0.4, 1.2))\nctx.globalAlpha = a\ng.math('y = A\\\\sin(kx - \\\\omega t)', width / 2, 860, { size: 54, color: theme.fg })"
    }
  ],
  audio: [],
  subtitles: [{ id: 's1', start: 0.5, end: 3.2, text: '这是一条由场景数据生成的字幕，用来验证字幕层渲染。' }]
}

/** scene 模式：第 1 轮写场景，第 2 轮渲染自检，第 3 轮抽样检查，第 4 轮导出 */
function sceneTurn(toolResults) {
  if (toolResults === 0) return { name: 'scene_write', args: { scene: DEMO_SCENE } }
  if (toolResults === 1) return { name: 'scene_render_frame', args: { t: 2.5 } }
  if (toolResults === 2) return { name: 'check_scene', args: { samples: 4 } }
  if (toolResults === 3) return { name: 'scene_export_video', args: { name: 'mock-scene.mp4', from: 0, to: 2 } }
  return null
}

/**
 * tts 模式：先调 tts_speak 合成一句旁白，拿到 path/durationSec 后
 * 再把它们写进 scene.audio —— 验证「agent 自己配音」这条链路。
 */
function ttsTurn(toolResults, toolMsgs) {
  if (toolResults === 0) {
    return { name: 'tts_speak', args: { text: '马吕斯定律：透射光强正比于入射光强乘以余弦的平方。', name: 'vo-agent', rate: 1 } }
  }
  if (toolResults === 1) {
    const last = toolMsgs[toolMsgs.length - 1]
    const raw = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
    const m = raw.match(/\{"ok":true[^}]*"path":"([^"]+)"[^}]*"durationSec":([0-9.]+)/)
    if (!m) throw new Error('mock: 没能从工具结果里解析出 path/durationSec：' + raw.slice(0, 200))
    const [, path, dur] = m
    const duration = Math.max(6, Math.ceil(Number(dur) + 1))
    return {
      name: 'scene_write',
      args: {
        scene: {
          version: 1,
          meta: { title: 'agent 自己配音', brief: 'tts_speak → scene_write', style: '深色矢量' },
          canvas: { width: 1920, height: 1080, fps: 30, duration },
          layers: [
            {
              id: 'bg', name: '背景', start: 0, end: duration,
              draw: "const gd = ctx.createLinearGradient(0, 0, 0, height)\ngd.addColorStop(0, '#101820')\ngd.addColorStop(1, '#080c11')\nctx.fillStyle = gd\nctx.fillRect(0, 0, width, height)"
            },
            {
              id: 'title', name: '标题', start: 0, end: duration,
              draw: "g.text('马吕斯定律', 120, 180, { size: 64, weight: 700, color: theme.fg })\ng.text('I = I₀cos²θ', 120, 260, { size: 36, color: theme.accent })"
            }
          ],
          audio: [{ id: 'vo-agent', name: '旁白', src: path, start: 0, volume: 1 }],
          subtitles: [{ id: 's-agent', start: 0, end: Number(dur), text: '马吕斯定律：透射光强正比于入射光强乘以余弦的平方。' }]
        }
      }
    }
  }
  return null
}

/** 故意写坏的场景，用来验证写入前的静态检查 */
const BAD_SCENE = {
  version: 1,
  meta: { title: '坏场景' },
  canvas: { width: 1280, height: 1080, fps: 30, duration: 4 },
  layers: [
    { id: 'bg', name: '背景', draw: "ctx.fillStyle = theme.bg\nctx.fillRect(0, 0, width, height)" },
    { id: 'bg', name: '重复 id', draw: "g.circle(400, 400, 40, { fill: theme.accent })" },
    { id: 'Bad Id!', name: '非法 id', draw: "function draw() { g.text('x', 100, 100) }" },
    { id: 'arrow', name: '箭头函数', draw: "() => g.line(0, 0, 100, 100)" },
    { id: 'rand', name: '用了随机', draw: "g.dots([{ x: Math.random() * width, y: 500 }], 4, theme.fg)" },
    { id: 'rev', name: '时间倒序', start: 3, end: 1, draw: "g.line(0, cy, width, cy, { stroke: theme.accent })" },
    { id: 'noret', name: '带 return', draw: "if (t < 1) return\ng.line(0, 200, 400, 200, { stroke: theme.fg })" },
    { name: '没有 draw' }
  ],
  subtitles: 'oops'
}

/** 首尾帧模式：模拟真实模型拿到「首尾帧补间」prompt 之后的完整动作序列 */
function keyframeTurn(toolResults) {
  if (toolResults === 0) return { name: 'asset_import', args: { path: FIXTURE_A } }
  if (toolResults === 1) return { name: 'asset_import', args: { path: FIXTURE_B } }
  if (toolResults === 2) return { name: 'image_inspect', args: { path: 'assets/kf_a.png', cols: 48 } }
  if (toolResults === 3) return { name: 'image_compare', args: { first: 'assets/kf_a.png', last: 'assets/kf_b.png' } }
  if (toolResults === 4) return { name: 'scene_write', args: { scene: KEYFRAME_SCENE } }
  if (toolResults === 5) return { name: 'scene_render_frame', args: { times: [0, 3, 6] } }
  if (toolResults === 6) return { name: 'scene_export_video', args: { name: 'mock-keyframe.mp4', from: 0, to: 6 } }
  return null
}

/** 首尾帧模式最后写出的场景：用 g.image 交叉淡入 + 代码画的箭头承担运动 */
const KEYFRAME_SCENE = {
  version: 1,
  meta: { title: '首尾帧补间（mock）', brief: '验证图生视频链路', style: '深色 + 底图过渡' },
  canvas: { width: 1920, height: 1080, fps: 30, duration: 6 },
  layers: [
    { id: 'bg', name: '背景', start: 0, end: 6, draw: "ctx.fillStyle = theme.bg\nctx.fillRect(0, 0, width, height)" },
    {
      id: 'first',
      name: '首帧底图',
      start: 0,
      end: 6,
      draw: "const a = 1 - ease.inOutCubic(ease.span(t, 2.4, 3.6))\nif (a > 0.001) g.image('assets/kf_a.png', cx, cy, 640, 360, { alpha: a })"
    },
    {
      id: 'last',
      name: '尾帧底图',
      start: 0,
      end: 6,
      draw: "const a = ease.inOutCubic(ease.span(t, 2.4, 3.6))\nif (a > 0.001) g.image('assets/kf_b.png', cx, cy, 640, 360, { alpha: a })"
    },
    {
      id: 'arrow',
      name: '运动箭头',
      start: 0,
      end: 6,
      draw: "const k = ease.inOutCubic(ease.span(t, 0.2, 5.6))\nconst x0 = cx - 320 + 160, x1 = cx - 320 + 460\ng.arrow(x0, cy + 220, x0 + (x1 - x0) * k, cy + 220, { stroke: theme.accent2, width: 4 })"
    }
  ],
  audio: [],
  subtitles: []
}

const CALLS = {
  inspect: { name: 'scene_inspect', args: {} },
  check: { name: 'check_scene', args: { samples: 9 } },
  frame: { name: 'scene_render_frame', args: { t: 5 } },
  bad: { name: 'scene_write', args: { scene: BAD_SCENE } },
  empty: { name: 'scene_write', args: { scene: { version: 1, meta: { title: '空场景' } } } },
  emptyDraw: { name: 'scene_write', args: { scene: { version: 1, layers: [{ id: 'a', name: '空层' }] } } },
  img: { name: 'image_inspect', args: { path: 'assets/kf_a.png', cols: 48 } },
  cmp: { name: 'image_compare', args: { first: 'assets/kf_a.png', last: 'assets/kf_b.png' } },
  multi: { name: 'scene_render_frame', args: { times: [0.5, 6, 11.5] } },
  export: { name: 'scene_export_video', args: { name: 'mock-export.mp4', from: 0, to: 2 } },
  write: {
    name: 'scene_add_layer',
    args: {
      layer: {
        id: 'mock_probe',
        name: 'mock 探针',
        start: 0,
        end: 12,
        draw: "g.circle(1600, 200, 60 + Math.sin(t * 3) * 10, { fill: theme.accent2, alpha: 0.9 })\ng.text('mock', 1600, 300, { size: 28, color: theme.muted, align: 'center' })"
      }
    }
  }
}

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-deepseek', object: 'model' }] }))
    return
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"not found"}')
    return
  }

  let body = ''
  for await (const chunk of req) body += chunk
  const payload = JSON.parse(body || '{}')
  const messages = payload.messages ?? []
  const toolMsgs = messages.filter(m => m.role === 'tool')
  console.log('[mock] request model=%s msgs=%d tools=%d toolResults=%d', payload.model, messages.length, (payload.tools ?? []).length, toolMsgs.length)

  /**
   * reject400：假装是「不认 stream_options」的中转站——带这个字段就 400。
   * 用来验证主进程 model-proxy 的「退一步重试」路径。
   */
  if (MODE === 'reject400' && payload.stream_options) {
    console.log('[mock] reject400: 收到 stream_options，回 400')
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Unsupported parameter: stream_options', type: 'invalid_request_error' } }))
    return
  }

  /** auth401：Key 不对时用户会看到什么 */
  if (MODE === 'auth401') {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'authentication_error' } }))
    return
  }

  /**
   * nostream：假装是「不认 stream:true」的中转站——直接回一整块 JSON。
   * 用来验证主进程 model-proxy 的 toChunks 兜底路径。
   */
  if (MODE === 'nostream') {
    const message = toolMsgs.length === 0
      ? {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call_ns1', type: 'function', function: { name: 'scene_inspect', arguments: '{}' } }]
        }
      : { role: 'assistant', content: '非流式响应也能跑通，工具结果已收到。' }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'chatcmpl-nostream',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'mock',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 15, total_tokens: 135 }
    }))
    return
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  if (process.env.MOCK_DUMP) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.MOCK_DUMP, JSON.stringify({ tools: payload.tools, messages }, null, 2), 'utf8')
    console.log('[mock] dumped request to %s', process.env.MOCK_DUMP)
  }
  const id = 'chatcmpl-mock'
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: payload.model ?? 'mock' }

  const nextCall = MODE === 'scene'
    ? sceneTurn(toolMsgs.length)
    : MODE === 'kf'
      ? keyframeTurn(toolMsgs.length)      : MODE === 'tts'
        ? ttsTurn(toolMsgs.length, toolMsgs)
        : (MODE !== 'text' && toolMsgs.length === 0 ? (CALLS[MODE] ?? CALLS.inspect) : null)
  if (nextCall) {
    console.log('[mock] emitting tool_call %s (round %d)', nextCall.name, toolMsgs.length + 1)
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    sse(res, {
      ...base,
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 'call_' + (toolMsgs.length + 1), type: 'function', function: { name: nextCall.name, arguments: JSON.stringify(nextCall.args) } }] },
        finish_reason: null
      }]
    })
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
    sse(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  let text = '收到。这是 mock 模型的回复：链路已打通。'
  if (toolMsgs.length) {
    const last = toolMsgs[toolMsgs.length - 1]
    const content = typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
    console.log('[mock] tool result #%d (%d chars):\n%s', toolMsgs.length, content.length, content.slice(0, 1600))
    // 直接落盘：Windows 上 stdout 重定向到文件时被强杀会丢缓冲，调试时不可靠
    if (process.env.MOCK_LOG_RESULT) {
      const { appendFileSync } = await import('node:fs')
      appendFileSync(process.env.MOCK_LOG_RESULT, `\n===== tool result #${toolMsgs.length} =====\n${content}\n`, 'utf8')
    }
    text = '工具已执行完毕，我看到了返回结果。'
  }
  if (MODE === 'slow') {
    // 慢慢吐字，用来测「停止」按钮：每 400ms 一个片段，共 150 段（约 60 秒）
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    for (let i = 0; i < 150; i++) {
      if (res.writableEnded || res.destroyed) { console.log('[mock] client aborted at chunk %d', i); return }
      sse(res, { ...base, choices: [{ index: 0, delta: { content: `第${i}段。` }, finish_reason: null }] })
      await new Promise(r => setTimeout(r, 400))
    }
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }
  sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
  for (const piece of text.match(/[\s\S]{1,8}/g) ?? []) {
    sse(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
    await new Promise(r => setTimeout(r, 10))
  }
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  sse(res, { ...base, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })
  res.write('data: [DONE]\n\n')
  res.end()
})

server.listen(port, '127.0.0.1', () => console.log('[mock] listening on http://127.0.0.1:' + port + ' mode=' + MODE))

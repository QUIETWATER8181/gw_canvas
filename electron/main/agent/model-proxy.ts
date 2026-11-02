import { randomBytes, timingSafeEqual } from 'node:crypto'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { friendlyHttpError } from './http-errors'

const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

export interface ProxyUpstream {
  baseUrl: string
  apiKey: string
  /** 上游真实模型名；DSH 传来的 model 会被替换成它 */
  model: string
}

export interface ProxyUsage {
  inputTokens: number
  outputTokens: number
  requests: number
}

/**
 * 本地 OpenAI 兼容代理：DSH 只看到一个临时 token，
 * 真正的密钥和上游地址留在主进程里。顺便统计 token 用量。
 */
export class ModelProxy {
  private readonly token = randomBytes(32).toString('hex')
  private server: Server | null = null
  private readonly active = new Set<AbortController>()
  readonly usage: ProxyUsage = { inputTokens: 0, outputTokens: 0, requests: 0 }

  constructor(private readonly upstream: ProxyUpstream) {
    const url = new URL(upstream.baseUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('模型接口地址必须使用 HTTPS（本机地址除外）')
    }
  }

  async start(): Promise<{ port: number; token: string }> {
    if (this.server) throw new Error('模型代理已启动')
    const server = http.createServer((req, res) => { void this.handle(req, res) })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    this.server = server
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('模型代理未获得端口')
    return { port: address.port, token: this.token }
  }

  async close(): Promise<void> {
    for (const c of this.active) c.abort()
    this.active.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  }

  private authorized(value: string | undefined): boolean {
    const received = value?.startsWith('Bearer ') ? value.slice(7) : ''
    const a = Buffer.from(this.token)
    const b = Buffer.from(received)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private upstreamUrl(path: string): string {
    const base = this.upstream.baseUrl.replace(/\/+$/, '')
    // 用户可能填了 https://api.deepseek.com 或 https://api.deepseek.com/v1 或 .../v1/chat/completions
    if (/\/chat\/completions$/.test(base)) return base
    if (/\/v\d+$/.test(base)) return `${base}${path}`
    return `${base}/v1${path}`
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const isLocal = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1'
    if (!isLocal || !this.authorized(req.headers.authorization)) {
      res.writeHead(403).end()
      return
    }
    // 让「测试连接」也能经由代理走，路径与鉴权一致
    if (req.method === 'GET') {
      try {
        const upstream = await fetch(this.upstreamUrl('/models'), {
          headers: { Authorization: `Bearer ${this.upstream.apiKey}` },
          signal: AbortSignal.timeout(20_000)
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(text)
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(error) } }))
      }
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const controller = new AbortController()
    this.active.add(controller)
    res.once('close', () => controller.abort())
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        bytes += (chunk as Buffer).length
        if (bytes > MAX_REQUEST_BYTES) throw new Error('请求体超出上限')
        chunks.push(chunk as Buffer)
      }
      let body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      // 用真实模型名覆盖 DSH 传来的内部标识
      body.model = this.upstream.model
      if (!body.stream_options) body.stream_options = { include_usage: true }

      let upstream = await this.forward(body, controller.signal)
      if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
        // 部分中转站不认 stream_options / 思考参数，退一步重试
        const retryBody = { ...body }
        for (const key of ['stream_options', 'reasoning_effort', 'thinking', 'thinking_budget', 'enable_thinking', 'parallel_tool_calls', 'tool_choice']) {
          delete retryBody[key]
        }
        upstream = await this.forward(retryBody, controller.signal)
      }
      if (!upstream.ok || !upstream.body) {
        const text = upstream.body ? await upstream.text().catch(() => '') : ''
        res.writeHead(upstream.status || 502, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ error: { message: friendlyHttpError(upstream.status, text) } })
        )
        return
      }
      const ctype = upstream.headers.get('content-type') ?? ''
      if (!ctype.includes('text/event-stream')) {
        // 非流式（少数中转站忽略 stream=true），转成标准 chunk 序列
        const json = await upstream.json() as Record<string, unknown>
        this.countUsage(json)
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        for (const chunk of toChunks(json)) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      let total = 0
      let pending = ''
      for await (const chunk of Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream)) {
        const data = Buffer.from(chunk as Uint8Array)
        total += data.length
        if (total > MAX_RESPONSE_BYTES) throw new Error('模型响应超出上限')
        pending = (pending + data.toString('utf8')).slice(-256 * 1024)
        let end: number
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end)
          pending = pending.slice(end + 2)
          for (const line of frame.split(/\r?\n/)) {
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
            try { this.countUsage(JSON.parse(line.slice(6)) as Record<string, unknown>) } catch { /* usage 可选 */ }
          }
        }
        if (!res.write(data)) await once(res, 'drain')
      }
      res.end()
    } catch (error) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: String(error) } }))
      else res.destroy()
    } finally {
      this.active.delete(controller)
    }
  }

  private countUsage(json: Record<string, unknown>): void {
    const u = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
    if (!u) return
    this.usage.requests += 1
    if (typeof u.prompt_tokens === 'number') this.usage.inputTokens += u.prompt_tokens
    if (typeof u.completion_tokens === 'number') this.usage.outputTokens += u.completion_tokens
  }

  private async forward(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    return fetch(this.upstreamUrl('/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.upstream.apiKey}`,
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal
    })
  }
}

/** 把一次性 chat.completion 响应拆成标准 SSE chunk 序列，兼容忽略 stream 的上游 */
function toChunks(json: Record<string, unknown>): Record<string, unknown>[] {
  const base = {
    id: typeof json.id === 'string' ? json.id : `chatcmpl-${Date.now().toString(36)}`,
    object: 'chat.completion.chunk',
    created: typeof json.created === 'number' ? json.created : Math.floor(Date.now() / 1000),
    model: typeof json.model === 'string' ? json.model : 'unknown'
  }
  const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0] ?? {}
  const message = (choice.message ?? {}) as Record<string, unknown>
  const out: Record<string, unknown>[] = [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }
  ]
  const content = typeof message.content === 'string' ? message.content : ''
  if (content) out.push({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] })
  const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined
  if (Array.isArray(toolCalls)) {
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i]
      const fn = (call.function ?? {}) as Record<string, unknown>
      out.push({
        ...base,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              id: typeof call.id === 'string' ? call.id : `call_${i}`,
              type: 'function',
              function: {
                name: typeof fn.name === 'string' ? fn.name : '',
                arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
              }
            }]
          },
          finish_reason: null
        }]
      })
    }
  }
  out.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? (toolCalls?.length ? 'tool_calls' : 'stop') }]
  })
  if (json.usage) out.push({ ...base, choices: [], usage: json.usage })
  return out
}

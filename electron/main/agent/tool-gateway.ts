import net from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_WIRE_BYTES = 8 * 1024 * 1024

export type ToolHandler = (args: Record<string, unknown>, ctx: { sessionId: string; signal: AbortSignal }) => Promise<unknown>

interface GatewayRequest {
  token: string
  sessionId: string
  tool: string
  args: Record<string, unknown>
}

/**
 * agent 的工具网关：DSH 子进程通过本机 socket 调用主进程能力。
 * 和星云一样，宿主的 bash/fs 工具全部禁用，能力只从这里开。
 */
export class ToolGateway {
  private server: net.Server | null = null
  private readonly token = randomBytes(24).toString('hex')
  private readonly handlers = new Map<string, ToolHandler>()
  private readonly active = new Set<AbortController>()
  private socketPath = ''

  constructor(private readonly pipeDir: string, private readonly sessionId = randomBytes(4).toString('hex')) {}

  register(name: string, handler: ToolHandler): void {
    this.handlers.set(name, handler)
  }

  get address(): string { return this.socketPath }
  get authToken(): string { return this.token }

  async start(): Promise<{ socketPath: string; token: string }> {
    const isWin = process.platform === 'win32'
    this.socketPath = isWin
      ? `\\\\.\\pipe\\gewu-tool-${this.sessionId}-${Date.now().toString(36)}`
      : join(this.pipeDir, `gewu-${this.sessionId}.sock`)
    if (!isWin) await unlink(this.socketPath).catch(() => undefined)
    const server = net.createServer(socket => this.onConnection(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => { server.off('error', reject); resolve() })
    })
    this.server = server
    return { socketPath: this.socketPath, token: this.token }
  }

  async close(): Promise<void> {
    for (const c of this.active) c.abort()
    this.active.clear()
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (process.platform !== 'win32') await unlink(this.socketPath).catch(() => undefined)
  }

  private authorized(received: string): boolean {
    const a = Buffer.from(this.token)
    const b = Buffer.from(received)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private onConnection(socket: net.Socket): void {
    let received = ''
    let handled = false
    const controller = new AbortController()
    this.active.add(controller)
    const finish = (payload: Record<string, unknown>) => {
      if (handled) return
      handled = true
      socket.end(JSON.stringify(payload) + '\n')
      this.active.delete(controller)
    }
    socket.on('error', () => { this.active.delete(controller) })
    socket.on('close', () => { this.active.delete(controller) })
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (Buffer.byteLength(received) > MAX_WIRE_BYTES) return finish({ ok: false, error: '工具请求超出上限' })
      const end = received.indexOf('\n')
      if (end < 0) return
      let req: GatewayRequest
      try { req = JSON.parse(received.slice(0, end)) as GatewayRequest } catch { return finish({ ok: false, error: '工具请求格式无效' }) }
      if (!req || !this.authorized(String(req.token ?? ''))) return finish({ ok: false, error: '工具网关鉴权失败' })
      const handler = this.handlers.get(String(req.tool))
      if (!handler) return finish({ ok: false, error: `未知工具：${req.tool}` })
      void handler(req.args ?? {}, { sessionId: String(req.sessionId ?? ''), signal: controller.signal })
        .then(result => finish({ ok: true, result }))
        .catch(error => finish({ ok: false, error: error instanceof Error ? error.message : String(error) }))
    })
  }
}

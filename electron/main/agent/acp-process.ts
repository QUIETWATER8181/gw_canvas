import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_FRAME_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

type Pending = { method: string; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type AcpFrame = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: AcpError }
type AcpError = { message?: string; code?: number; data?: unknown }

/**
 * ACP 的错误帧里 `message` 往往只有一句「internal error」，真正有用的信息
 * 在 `data` 里（比如上游模型返回的 401 文本）。全都摊平给人看。
 */
function describeAcpError(error: AcpError | undefined): string {
  if (!error) return ''
  const parts: string[] = []
  if (typeof error.message === 'string' && error.message.trim()) parts.push(error.message.trim())
  if (error.data !== undefined && error.data !== null) {
    const raw = typeof error.data === 'string' ? error.data : JSON.stringify(error.data)
    if (raw && raw !== '{}' && !parts.some(p => p.includes(raw))) parts.push(raw.slice(0, 800))
  }
  if (!parts.length && typeof error.code === 'number') parts.push(`错误码 ${error.code}`)
  return parts.length ? `：${parts.join(' | ')}` : ''
}

export interface DshProcessOptions {
  runtimeRoot: string
  privateRoot: string
  modelPort: number
  modelToken: string
  modelId: string
  bridgeSocketPath: string
  bridgeToken: string
  workspace: string
  /** 我们的工具网关插件源码（会被同步到 runtimeRoot/gewu-tools.mjs） */
  pluginSource: string
  onUpdate?(params: unknown): void
  onPermissionRequest?(frame: { id: number; params: unknown }): void
  onProtocolFailure?(reason: string): void
  onExit?(code: number | null): void
  log?(text: string): void
}

/**
 * 拉起隔离的 DSH 运行时，通过 stdio 上的 JSON-RPC (ACP) 通信。
 * 结构参照星云的 DshAcpProcess：模型走本机代理，宿主工具全部关闭，
 * 只保留我们自己的工具网关。
 */
export class DshProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private stopping = false
  private stderr = ''
  private closed: Promise<number | null> | null = null
  private scratch = ''

  constructor(private readonly options: DshProcessOptions) {}

  get scratchDirectory() { return this.scratch }
  get lastStderr() { return this.stderr }

  async start(): Promise<void> {
    if (this.child) throw new Error('DSH 已启动')
    const runtimeRoot = await realpath(this.options.runtimeRoot)
    await mkdir(this.options.privateRoot, { recursive: true })
    const privateRoot = await realpath(this.options.privateRoot)
    this.scratch = join(privateRoot, 'scratch')
    const tempRoot = join(privateRoot, 'tmp')
    const dshHome = join(privateRoot, 'dsh-home')
    await Promise.all([mkdir(this.scratch, { recursive: true }), mkdir(tempRoot, { recursive: true }), mkdir(dshHome, { recursive: true })])

    const pkg = JSON.parse(await readFile(join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')) as { version?: string }
    const dynamicPatch = join(privateRoot, 'gewu-session.patch.yml')
    // 插件必须放在运行时根目录，才能解析到 @deepseek-ai/dsh-tools
    const pluginPath = join(runtimeRoot, 'gewu-tools.mjs')
    await syncPlugin(this.options.pluginSource, pluginPath)
    await writeFile(
      dynamicPatch,
      `- id: acp
  config:
    provider: deepseek-official
    model: ${JSON.stringify(this.options.modelId)}
- insert:
    - id: gewu-tool-gateway
      name: ${JSON.stringify(pluginPath)}
`,
      'utf8'
    )

    const nodeBin = join(runtimeRoot, 'node_modules/node/bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const dshBin = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    const safetyPatch = join(runtimeRoot, 'gewu-acp.patch.yml')

    const child = spawn(nodeBin, [dshBin, '--profile', 'acp', '--patch', safetyPatch, '--patch', dynamicPatch], {
      cwd: this.scratch,
      detached: false,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOME: privateRoot,
        TMPDIR: tempRoot,
        DSH_HOME: dshHome,
        DSH_TELEMETRY_DISABLED: '1',
        // 宿主工具全部禁用，文件沙箱对我们没有保护作用；用 danger-full-access
        // 避免 prompt 里出现「只读，无法修改文件」这种与事实相反的提示。
        DSH_PERMISSION_MODE: 'danger-full-access',
        DEEPSEEK_BASE_URL: `http://127.0.0.1:${this.options.modelPort}`,
        DEEPSEEK_API_KEY: this.options.modelToken,
        GEWU_BRIDGE_SOCKET: this.options.bridgeSocketPath,
        GEWU_BRIDGE_TOKEN: this.options.bridgeToken,
        GEWU_WORKSPACE: this.options.workspace,
        GEWU_RUNTIME_VERSION: pkg.version ?? 'unknown'
      }
    })
    this.child = child
    child.stdout.on('data', chunk => this.receive(chunk))
    child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-8000)
      this.options.log?.(`stderr: ${chunk.toString('utf8').slice(-500)}`)
    })
    this.closed = new Promise(resolve => child.once('close', code => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('DSH 进程已关闭')) }
      this.pending.clear()
      this.child = null
      if (!this.stopping) this.options.onExit?.(code)
      resolve(code)
    }))
    child.once('error', err => this.fail(`DSH 启动失败：${err.message}`))
    try {
      const result = await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'gewu-desktop', version: '0.1' }
      }) as { protocolVersion?: number }
      if (result.protocolVersion !== 1) throw new Error('DSH ACP 版本不匹配')
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  request(method: string, params: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (!this.child || this.stopping) return Promise.reject(new Error('DSH 进程不可用'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`DSH ${method} 超时`)) }, timeoutMs)
      this.pending.set(id, { method, resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    if (this.child && !this.stopping) this.send({ jsonrpc: '2.0', method, params })
  }

  async stop(): Promise<number | null> {
    const child = this.child
    if (!child || !this.closed) return null
    this.stopping = true
    child.stdin.end()
    const terminate = (hard: boolean) => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        try { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* ignore */ }
      } else {
        try { process.kill(-child.pid, hard ? 'SIGKILL' : 'SIGTERM') } catch { /* ignore */ }
      }
    }
    const timer = setTimeout(() => terminate(false), 2000)
    const hard = setTimeout(() => terminate(true), 5000)
    try { return await this.closed } finally { clearTimeout(timer); clearTimeout(hard); this.stopping = false }
  }

  private send(frame: AcpFrame): void {
    const data = JSON.stringify(frame) + '\n'
    if (Buffer.byteLength(data) > MAX_FRAME_BYTES) throw new Error('ACP 请求超出上限')
    this.child?.stdin.write(data)
  }

  private receive(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    if (Buffer.byteLength(this.buffer) > MAX_FRAME_BYTES) { this.fail('ACP 响应超出上限'); return }
    for (;;) {
      const end = this.buffer.indexOf('\n')
      if (end < 0) return
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      if (!line.trim()) continue
      let frame: AcpFrame
      try { frame = JSON.parse(line) as AcpFrame } catch { this.fail('ACP 协议帧无效'); return }
      if (frame.jsonrpc !== '2.0') { this.fail('ACP 协议版本无效'); return }
      if (typeof frame.id === 'number' && this.pending.has(frame.id)) {
        const pending = this.pending.get(frame.id)!
        this.pending.delete(frame.id)
        clearTimeout(pending.timer)
        if (frame.error) pending.reject(new Error(`DSH ${pending.method} 失败${describeAcpError(frame.error)}${this.stderr ? `：${this.stderr.slice(-1500)}` : ''}`))
        else pending.resolve(frame.result)
      } else if (frame.method === 'session/update') {
        this.options.onUpdate?.(frame.params)
      } else if (frame.method === 'session/request_permission' && typeof frame.id === 'number') {
        this.options.onPermissionRequest?.({ id: frame.id, params: frame.params })
      } else if (frame.method && typeof frame.id === 'number') {
        // 其他 host 请求一律拒绝
        this.send({ jsonrpc: '2.0', id: frame.id, result: { outcome: { outcome: 'cancelled' } } })
      }
    }
  }

  private fail(reason: string): void {
    this.options.onProtocolFailure?.(reason)
    const child = this.child
    if (child?.pid) {
      if (process.platform === 'win32') {
        try { spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { /* ignore */ }
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* ignore */ }
      }
    }
  }
}

/** 把插件源码同步到运行时根目录（内容一致时跳过写入） */
async function syncPlugin(source: string, target: string): Promise<void> {
  const next = await readFile(source, 'utf8')
  try {
    const current = await readFile(target, 'utf8')
    if (current === next) return
  } catch { /* 不存在则写入 */ }
  await writeFile(target, next, 'utf8')
}

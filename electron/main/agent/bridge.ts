import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DshProcess } from './acp-process'
import { ModelProxy } from './model-proxy'
import { ToolGateway } from './tool-gateway'
import { synthesize } from '../tts'
import type { AgentStatus, ChatMessage, ScenePatch, ToolInvocation, ToolResult } from '@shared/ipc'
import type { Scene } from '@shared/scene'

/**
 * ACP 把上游模型的报错层层包了一层壳（「DSH session/prompt 失败：Internal error: turn failed: …」），
 * 真正的信息在后面。剥掉前缀，让用户一眼看到该干什么。
 */
function humanizeAgentError(detail: string): string {
  const cleaned = detail
    .replace(/^DSH\s+session\/prompt\s*失败[：:]\s*/, '')
    .replace(/^Internal error:\s*turn failed:\s*/i, '')
    .replace(/^DSH\s+\S+\s*失败[：:]\s*/, '')
    .trim()
  return cleaned || detail
}

export interface BridgeOptions {
  runtimeRoot: string
  dataRoot: string
  pluginSource: string
  getConnection(): { id: string; name: string; kind: string; baseUrl: string; model: string; apiKey: string } | null
  getWorkspace(): string
  getScenePath(): string
  onChat(msg: ChatMessage): void
  onStatus(status: AgentStatus): void
  onSceneChanged(patch: ScenePatch): void
  invokeRendererTool(inv: { name: string; args: unknown }, timeoutMs?: number): Promise<unknown>
  log(level: string, text: string): void
}

export interface PromptUiContext {
  /** 播放头位置（秒） */
  time?: number
  /** 当前选中的图层 id */
  selectedLayerId?: string
  /** 画布上框选的设计坐标区域 */
  region?: { x: number; y: number; w: number; h: number }
}

/** 一次会话 = 一个 DSH 进程 + 一个模型代理 + 一个工具网关 */
export class AgentBridge {
  private dsh: DshProcess | null = null
  private proxy: ModelProxy | null = null
  private gateway: ToolGateway | null = null
  private sessionId: string | null = null
  private status: AgentStatus = { phase: 'idle' }
  private busy = false
  private startPromise: Promise<void> | null = null
  private assistantBuffer = ''
  private assistantId: string | null = null
  private toolCalls = new Map<string, { msgId: string; call: NonNullable<ChatMessage['tools']>[number] }>()

  /** 本轮某条 assistant 消息已经跑过的工具（文字分片回传时要带上，否则工具条会消失） */
  private toolsFor(msgId: string): NonNullable<ChatMessage['tools']> | undefined {
    const list = [...this.toolCalls.values()].filter(v => v.msgId === msgId).map(v => v.call)
    return list.length ? list : undefined
  }
  private lastUserText = ''

  constructor(private readonly o: BridgeOptions) {}

  getStatus(): AgentStatus { return this.status }

  private setStatus(s: AgentStatus): void {
    this.status = s
    this.o.onStatus(s)
  }

  private chat(msg: Omit<ChatMessage, 'id' | 'at'> & { id?: string }): string {
    const id = msg.id ?? randomUUID()
    this.o.onChat({ ...msg, id, at: Date.now() })
    return id
  }

  async start(): Promise<void> {
    if (this.dsh && this.sessionId) return
    if (!this.startPromise) {
      this.startPromise = this.doStart().finally(() => { this.startPromise = null })
    }
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    if (this.dsh) return
    const conn = this.o.getConnection()
    if (!conn) {
      this.setStatus({ phase: 'idle', detail: '未配置模型连接' })
      throw new Error('未配置模型连接：请先在右上角「模型设置」里添加一个可用的模型')
    }
    this.setStatus({ phase: 'starting', detail: `正在启动 ${conn.name}` })
    try {
      this.proxy = new ModelProxy({ baseUrl: conn.baseUrl, apiKey: conn.apiKey, model: conn.model })
      const model = await this.proxy.start()

      const privateRoot = join(this.o.dataRoot, 'sessions', randomUUID())
      await mkdir(privateRoot, { recursive: true })

      this.gateway = new ToolGateway(privateRoot)
      this.registerTools()
      const bridge = await this.gateway.start()

      this.dsh = new DshProcess({
        runtimeRoot: this.o.runtimeRoot,
        privateRoot,
        modelPort: model.port,
        modelToken: model.token,
        modelId: conn.model,
        bridgeSocketPath: bridge.socketPath,
        bridgeToken: bridge.token,
        workspace: this.o.getWorkspace(),
        pluginSource: this.o.pluginSource,
        onUpdate: params => this.onUpdate(params),
        onPermissionRequest: () => { /* 宿主工具已禁用，不应出现 */ },
        onProtocolFailure: reason => this.setStatus({ phase: 'error', detail: reason }),
        onExit: code => {
          if (this.dsh) this.setStatus({ phase: 'error', detail: `agent 进程退出（${code ?? '未知'}）` })
          this.busy = false
        },
        log: (t) => this.o.log('dsh', t)
      })
      await this.dsh.start()
      await this.openSession()
      this.setStatus({ phase: 'ready', sessionId: this.sessionId ?? undefined })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.o.log('bridge', `start failed: ${detail}`)
      this.setStatus({ phase: 'error', detail })
      await this.teardown()
      throw new Error(detail)
    }
  }

  private async openSession(): Promise<void> {
    if (!this.dsh) throw new Error('agent 未启动')
    const workspace = this.o.getWorkspace()
    const opened = await this.dsh.request('session/new', { cwd: workspace, mcpServers: [] }, 60_000) as { sessionId?: string }
    if (!opened?.sessionId) throw new Error('agent 未创建会话')
    this.sessionId = opened.sessionId
  }

  async newSession(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    await this.teardown()
    this.setStatus({ phase: 'idle' })
  }

  private async teardown(): Promise<void> {
    await this.dsh?.stop().catch(() => undefined)
    await this.gateway?.close().catch(() => undefined)
    await this.proxy?.close().catch(() => undefined)
    this.dsh = null
    this.gateway = null
    this.proxy = null
    this.sessionId = null
    this.busy = false
  }

  async prompt(text: string, ui?: PromptUiContext): Promise<void> {
    if (!this.dsh || !this.sessionId) {
      await this.start()
      if (!this.dsh || !this.sessionId) throw new Error(this.status.detail ?? 'agent 未就绪')
    }
    if (this.busy) throw new Error('agent 正在处理上一条消息')
    this.busy = true
    this.lastUserText = text
    this.assistantBuffer = ''
    this.toolCalls.clear()
    this.setStatus({ phase: 'running', sessionId: this.sessionId })

    const sceneContext = await this.buildSceneContext(ui)
    const body = `${text}\n\n${sceneContext}`
    this.chat({ role: 'user', text })
    const assistantId = this.chat({ role: 'assistant', text: '' })
    this.assistantBuffer = ''
    this.assistantId = assistantId

    try {
      const result = await this.dsh.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: body }]
      }, 30 * 60_000) as { stopReason?: string }
      this.o.log('bridge', `prompt finished: ${result?.stopReason ?? 'unknown'}`)
      if (this.assistantBuffer.trim().length === 0) {
        this.o.onChat({
          id: assistantId, role: 'assistant', at: Date.now(),
          text: '（本轮没有文字输出，可能只执行了工具）',
          tools: this.toolsFor(assistantId)
        })
      }
      this.setStatus({ phase: 'ready', sessionId: this.sessionId })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      this.o.log('bridge', `prompt failed: ${detail}`)
      const human = humanizeAgentError(detail)
      this.o.onChat({ id: assistantId, role: 'assistant', text: human, at: Date.now(), error: true, tools: this.toolsFor(assistantId) })
      this.setStatus({ phase: 'error', detail: human, sessionId: this.sessionId })
    } finally {
      this.busy = false
    }
  }

  cancel(): void {
    if (this.dsh && this.sessionId) {
      this.dsh.notify('session/cancel', { sessionId: this.sessionId })
    }
  }

  private async buildSceneContext(ui?: PromptUiContext): Promise<string> {
    let scene: Scene
    try {
      scene = JSON.parse(await readFile(this.o.getScenePath(), 'utf8')) as Scene
    } catch {
      return '<scene-state>场景文件暂不可读</scene-state>'
    }
    const layerLines = scene.layers.map((l, i) => {
      const range = `${l.start ?? 0}–${l.end ?? scene.canvas.duration}s`
      const bounds = l.bounds ? ` bounds=${JSON.stringify(l.bounds)}` : ''
      const note = l.note ? ` note=${JSON.stringify(l.note)}` : ''
      const picked = ui?.selectedLayerId && ui.selectedLayerId === l.id ? '  ← 用户当前选中' : ''
      return `  ${i + 1}. id=${l.id} name=${JSON.stringify(l.name)} time=${range}${bounds}${note}${picked}`
    })
    const uiLines: string[] = []
    if (ui?.time !== undefined && Number.isFinite(ui.time)) {
      uiLines.push(`用户播放头停在 t=${ui.time.toFixed(2)}s（说「这里/这一帧/现在」指的就是这个时刻）`)
    }
    if (ui?.selectedLayerId) {
      const picked = scene.layers.find(l => l.id === ui.selectedLayerId)
      uiLines.push(`用户选中的图层：${ui.selectedLayerId}${picked ? `（${picked.name}）` : ''}`)
    }
    if (ui?.region) {
      const r = ui.region
      uiLines.push(`用户在画布上框选了设计坐标区域 x=${Math.round(r.x)} y=${Math.round(r.y)} w=${Math.round(r.w)} h=${Math.round(r.h)}`)
    }
    return [
      '<scene-state>',
      `文件：scene.json（工作区根目录）`,
      `标题：${scene.meta.title}${scene.meta.brief ? `｜主题：${scene.meta.brief}` : ''}`,
      `画布：${scene.canvas.width}×${scene.canvas.height} @ ${scene.canvas.fps}fps，时长 ${scene.canvas.duration}s`,
      `图层（${scene.layers.length}）：`,
      layerLines.length ? layerLines.join('\n') : '  （空）',
      `音频：${scene.audio.length} 条｜字幕：${scene.subtitles.length} 条`,
      ...uiLines,
      '改动请用 scene_set_layer / scene_write 工具，不要直接编辑文件。',
      '</scene-state>'
    ].join('\n')
  }

  private onUpdate(params: unknown): void {
    const update = (params as { update?: Record<string, unknown> })?.update
    if (!update) return
    const kind = update.sessionUpdate as string
    if (kind === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined
      if (content?.type === 'text' && content.text) {
        this.assistantBuffer += content.text
        const id = this.assistantId
        if (id) {
          this.o.onChat({
            id, role: 'assistant', text: this.assistantBuffer, at: Date.now(),
            tools: this.toolsFor(id)
          })
        }
      }
    } else if (kind === 'agent_thought_chunk') {
      // 思考内容不进对话流，避免干扰
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (process.env.GEWU_DUMP_TOOLCALL) this.o.log('tool', `RAW ${JSON.stringify(update).slice(0, 500)}`)
      const callId = String(update.toolCallId ?? update.tool_call_id ?? '')
      // tool_call_update 往往只带 status，没有 title。以前这里会退化成「工具调用」，
      // 然后又把已有的 scene_write 覆盖掉，界面上就永远显示「工具调用」。
      const explicitTitle = typeof update.title === 'string' && update.title ? update.title : ''
      const title = explicitTitle || '工具调用'
      const statusRaw = String(update.status ?? '')
      const status = statusRaw === 'completed' ? 'done' : statusRaw === 'failed' ? 'error' : statusRaw === 'pending' ? 'pending' : 'running'
      const existing = this.toolCalls.get(callId)
      if (!existing) {
        const msgId = this.assistantId ?? randomUUID()
        const call = { id: callId || randomUUID(), title, status } as NonNullable<ChatMessage['tools']>[number]
        this.toolCalls.set(callId, { msgId, call })
        this.o.onChat({
          id: msgId, role: 'assistant', text: this.assistantBuffer, at: Date.now(),
          tools: this.toolsFor(msgId)
        })
      } else {
        if (explicitTitle) existing.call.title = explicitTitle
        existing.call.status = status
        this.o.onChat({
          id: existing.msgId, role: 'assistant', text: this.assistantBuffer, at: Date.now(),
          tools: this.toolsFor(existing.msgId)
        })
      }
    }
  }

  // ---------- 工具实现 ----------

  private registerTools(): void {
    const g = this.gateway
    if (!g) return
    const wrap = (name: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => {
      g.register(name, async (args, ctx) => {
        this.o.log('tool', `${name} ${JSON.stringify(args).slice(0, 300)}`)
        try {
          const result = await fn(args)
          return result
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          this.o.log('tool', `${name} 失败：${msg}`)
          throw new Error(`${name} 失败：${msg}`)
        }
      })
    }

    wrap('scene_read', async () => {
      const raw = await readFile(this.o.getScenePath(), 'utf8')
      return raw
    })

    wrap('scene_inspect', async () => {
      return await this.buildSceneContext()
    })

    wrap('scene_write', async (args) => {
      const scene = args.scene
      if (!scene || typeof scene !== 'object') throw new Error('scene 必须是对象')
      const { normalizeScene, auditSceneInput } = await import('../scene-store')
      const warnings = auditSceneInput(scene)
      const normalized = normalizeScene(scene)
      // 空场景几乎总是模型把参数写坏了（layers 拼错、只给了 meta……）。
      // 直接写进去会清空用户正在编辑的内容，宁可拒绝并让它重来。
      if (normalized.layers.length === 0) {
        throw new Error(
          'layers 为空，已拒绝写入，当前场景保持不变。' +
          'scene_write 必须带一个非空的 layers 数组，每层至少要有 id 和 draw（函数体字符串）。' +
          (warnings.length ? `\n检查结果：\n${warnings.map(w => `- ${w}`).join('\n')}` : '')
        )
      }
      if (normalized.layers.every(l => !l.draw.trim())) {
        throw new Error('所有图层的 draw 都是空的，已拒绝写入。至少给一层写绘制代码。')
      }
      await writeFile(this.o.getScenePath(), JSON.stringify(normalized, null, 2), 'utf8')
      this.o.onSceneChanged({ scene: normalized, source: 'agent' })
      return { ok: true, layers: normalized.layers.length, duration: normalized.canvas.duration, warnings }
    })

    wrap('scene_set_layer', async (args) => {
      const id = String(args.id ?? '')
      if (!id) throw new Error('缺少图层 id')
      const { normalizeScene } = await import('../scene-store')
      const scene = normalizeScene(JSON.parse(await readFile(this.o.getScenePath(), 'utf8')))
      const layer = scene.layers.find(l => l.id === id)
      if (!layer) throw new Error(`图层 ${id} 不存在；现有：${scene.layers.map(l => l.id).join(', ')}`)
      const patch = (args.patch ?? {}) as Record<string, unknown>
      for (const key of ['name', 'draw', 'x', 'y', 'opacity', 'blend', 'visible', 'locked', 'note', 'bounds'] as const) {
        if (patch[key] !== undefined) (layer as unknown as Record<string, unknown>)[key] = patch[key]
      }
      if (patch.start !== undefined) layer.start = Number(patch.start)
      if (patch.end !== undefined) layer.end = Number(patch.end)
      if (args.canvas && typeof args.canvas === 'object') Object.assign(scene.canvas, args.canvas)
      const normalized = normalizeScene(scene)
      await writeFile(this.o.getScenePath(), JSON.stringify(normalized, null, 2), 'utf8')
      this.o.onSceneChanged({ scene: normalized, source: 'agent' })
      return { ok: true, layer: id }
    })

    wrap('scene_add_layer', async (args) => {
      const { normalizeScene, auditSceneInput } = await import('../scene-store')
      const scene = normalizeScene(JSON.parse(await readFile(this.o.getScenePath(), 'utf8')))
      const layer = args.layer as Record<string, unknown>
      if (!layer || typeof layer.draw !== 'string') throw new Error('layer.draw 必须是字符串')
      const id = String(layer.id ?? `layer_${scene.layers.length + 1}`)
      if (scene.layers.some(l => l.id === id)) throw new Error(`图层 id ${id} 已存在；现有：${scene.layers.map(l => l.id).join(', ')}`)
      scene.layers.push({
        id,
        name: String(layer.name ?? id),
        draw: layer.draw,
        x: Number(layer.x) || 0,
        y: Number(layer.y) || 0,
        opacity: layer.opacity === undefined ? 1 : Number(layer.opacity),
        start: layer.start === undefined ? undefined : Number(layer.start),
        end: layer.end === undefined ? undefined : Number(layer.end),
        visible: layer.visible !== false,
        note: layer.note ? String(layer.note) : undefined
      })
      const warnings = auditSceneInput({ layers: [layer] })
      const normalized = normalizeScene(scene)
      await writeFile(this.o.getScenePath(), JSON.stringify(normalized, null, 2), 'utf8')
      this.o.onSceneChanged({ scene: normalized, source: 'agent' })
      return { ok: true, id, count: normalized.layers.length, warnings }
    })

    wrap('scene_delete_layer', async (args) => {
      const id = String(args.id ?? '')
      const { normalizeScene } = await import('../scene-store')
      const scene = normalizeScene(JSON.parse(await readFile(this.o.getScenePath(), 'utf8')))
      const before = scene.layers.length
      scene.layers = scene.layers.filter(l => l.id !== id)
      if (scene.layers.length === before) throw new Error(`图层 ${id} 不存在`)
      const normalized = normalizeScene(scene)
      await writeFile(this.o.getScenePath(), JSON.stringify(normalized, null, 2), 'utf8')
      this.o.onSceneChanged({ scene: normalized, source: 'agent' })
      return { ok: true, count: normalized.layers.length }
    })

    wrap('scene_render_frame', async (args) => {
      const times = Array.isArray(args.times) ? (args.times as unknown[]).map(Number).filter(Number.isFinite) : []
      if (times.length > 1) {
        const payload = { times: times.slice(0, 4), cols: args.cols }
        return await this.o.invokeRendererTool({ name: 'render_frame', args: payload }, 240_000) as string
      }
      const t = Number(times[0] ?? args.t ?? 0)
      const result = await this.o.invokeRendererTool(
        { name: 'render_frame', args: { t, cols: args.cols } }, 120_000
      ) as {
        path: string; errors: { layerId: string; error: string }[]; preview: string; size: number
      }
      const lines = [
        `已渲染 t=${t.toFixed(2)}s 的帧，PNG 已保存到工作区：${result.path}`,
        `分辨率 ${result.size}px 宽。下面是这一帧的字符预览 + 各图层实际占据范围，用它们判断构图：`,
        result.preview
      ]
      if (result.errors.length) {
        lines.push('', '⚠ 本帧有图层报错，必须修复：')
        for (const e of result.errors) lines.push(`- 图层 ${e.layerId}: ${e.error}`)
      } else {
        lines.push('', '✓ 本帧所有图层执行无报错。')
      }
      return lines.join('\n')
    })

    wrap('check_scene', async (args) => {
      const samples = Number(args.samples ?? 8)
      const runtime = await this.o.invokeRendererTool({ name: 'check_scene', args: { samples } }, 180_000) as string
      const { normalizeScene, auditSceneInput } = await import('../scene-store')
      const scene = normalizeScene(JSON.parse(await readFile(this.o.getScenePath(), 'utf8')))
      const warnings = auditSceneInput(scene)
      if (!warnings.length) return runtime
      return `${runtime}\n\n【静态检查】\n${warnings.map(w => `- ${w}`).join('\n')}`
    })

    wrap('scene_export_video', async (args) => {
      const outName = String(args.name ?? `export-${Date.now()}.mp4`).replace(/[\\/:*?"<>|]/g, '_')
      const result = await this.o.invokeRendererTool({
        name: 'export_video',
        args: { name: outName, from: args.from, to: args.to }
      }, 30 * 60_000) as { path: string; frames: number; seconds: number }
      return `已导出视频：${result.path}（${result.frames} 帧 / ${result.seconds.toFixed(1)}s）`
    })

    // 离线配音：系统 SAPI，不需要 Key。返回的 path 直接写进 scene.audio[].src
    wrap('tts_speak', async (args) => {
      const text = String(args.text ?? '').trim()
      if (!text) throw new Error('缺少 text')
      const { wav, durationSec } = await synthesize(text, {
        voice: typeof args.voice === 'string' ? args.voice : undefined,
        rate: Number.isFinite(Number(args.rate)) ? Number(args.rate) : undefined
      })
      const assetsDir = join(this.o.getWorkspace(), 'assets')
      await mkdir(assetsDir, { recursive: true })
      const base = String(args.name ?? `tts-${Date.now()}`).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').replace(/\.wav$/i, '')
      const fileName = `${base}.wav`
      await writeFile(join(assetsDir, fileName), wav)
      return {
        ok: true,
        path: `assets/${fileName}`,
        durationSec,
        bytes: wav.length,
        hint: '把它写进 scene.audio：[{ id, name, src: path, start: 秒, volume: 1 }]'
      }
    })

    wrap('image_inspect', async (args) => {
      const path = String(args.path ?? '')
      if (!path) throw new Error('缺少 path')
      const cols = Math.max(24, Math.min(120, Number(args.cols ?? 64)))
      return await this.o.invokeRendererTool({ name: 'image_inspect', args: { path, cols } }, 60_000) as string
    })

    wrap('image_compare', async (args) => {
      const first = String(args.first ?? '')
      const last = String(args.last ?? '')
      if (!first || !last) throw new Error('需要 first 和 last 两个路径')
      return await this.o.invokeRendererTool({ name: 'image_compare', args: { first, last } }, 60_000) as string
    })

    wrap('asset_import', async (args) => {
      const sourcePath = String(args.path ?? '')
      if (!sourcePath) throw new Error('缺少 path')
      const { copyFile, stat } = await import('node:fs/promises')
      const { basename } = await import('node:path')
      const assetsDir = join(this.o.getWorkspace(), 'assets')
      await mkdir(assetsDir, { recursive: true })
      const name = basename(sourcePath).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
      const dest = join(assetsDir, name)
      await copyFile(sourcePath, dest)
      const st = await stat(dest)
      return { ok: true, path: `assets/${name}`, size: st.size, url: `gewu://workspace/assets/${encodeURIComponent(name)}` }
    })

    wrap('ask_user', async (args) => {      const question = String(args.question ?? '')
      const options = Array.isArray(args.options) ? args.options.map(String) : []
      this.chat({ role: 'system', text: `❓ ${question}${options.length ? `\n可选：${options.join(' / ')}` : ''}` })
      return '问题已展示给用户，等待用户回复。请结束本轮，不要自行假设答案。'
    })
  }
}

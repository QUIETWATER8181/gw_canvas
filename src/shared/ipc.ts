/** 主进程 <-> 渲染进程的契约。 */
import type { Scene } from './scene'

export type ProviderKind = 'deepseek' | 'openai-compatible'

export interface ModelConnection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  model: string
  /** 是否已保存密钥（密钥本身永不出主进程） */
  hasKey: boolean
  /** 该连接可用的模型列表（来自 /models，或手动填写） */
  models?: string[]
  contextWindow?: number
}

export interface AgentStatus {
  phase: 'idle' | 'starting' | 'ready' | 'running' | 'error'
  sessionId?: string
  detail?: string
}

export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatToolCall {
  id: string
  title: string
  status: 'pending' | 'running' | 'done' | 'error'
  detail?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  at: number
  tools?: ChatToolCall[]
  error?: boolean
}

export interface AppState {
  workspace: string
  scenePath: string
  connections: ModelConnection[]
  activeConnectionId: string | null
  agent: AgentStatus
}

export interface ScenePatch {
  scene: Scene
  /** 变更来源，用来避免把 agent 的写入再回写给 agent */
  source: 'agent' | 'user' | 'system'
}

export interface ExportRequest {
  /** 建议文件名 */
  name: string
  /** 渲染范围（秒），缺省整段 */
  from?: number
  to?: number
  fps?: number
  /** 导出完成后是否在文件夹中显示 */
  reveal?: boolean
}

export interface ExportProgress {
  jobId: string
  phase: 'prepare' | 'render' | 'encode' | 'mux' | 'done' | 'error'
  frame: number
  total: number
  message?: string
  outPath?: string
}

export interface ToolInvocation {
  id: string
  name: string
  args: unknown
}

export interface ToolResult {
  ok: boolean
  result?: unknown
  error?: string
}

/** 发消息时附带的编辑器上下文，让 agent 知道「这里」指哪儿 */
export interface PromptContext {
  /** 播放头位置（秒） */
  time?: number
  /** 当前选中的图层 id */
  selectedLayerId?: string
  /** 画布上框选的设计坐标区域 */
  region?: { x: number; y: number; w: number; h: number }
}

/** preload 暴露给渲染进程的 API */
export interface GewuApi {
  getState(): Promise<AppState>
  saveConnection(input: { id?: string; name: string; kind: ProviderKind; baseUrl: string; model: string; apiKey?: string }): Promise<AppState>
  deleteConnection(id: string): Promise<AppState>
  setActiveConnection(id: string): Promise<AppState>
  testConnection(input: { baseUrl: string; model: string; apiKey?: string; id?: string }): Promise<{ ok: boolean; detail: string; models?: string[] }>
  listRemoteModels(input: { baseUrl: string; apiKey?: string; id?: string }): Promise<string[]>

  readScene(): Promise<Scene>
  writeScene(scene: Scene, source?: ScenePatch['source']): Promise<{ ok: boolean; error?: string }>
  pickImage(): Promise<{ name: string; path: string; dataUrl: string } | null>
  importAsset(): Promise<{ name: string; path: string; kind: string } | null>
  revealPath(path: string): Promise<void>
  listAssets(): Promise<{ name: string; path: string; size: number }[]>

  sendPrompt(text: string, context?: PromptContext): Promise<void>
  cancelPrompt(): Promise<void>
  newSession(): Promise<void>

  /** 弹出保存对话框，返回用户选择的 mp4 路径 */
  chooseExportPath(req: ExportRequest): Promise<{ ok: boolean; outPath?: string; error?: string }>
  /** 把渲染好的 mp4 字节写入磁盘 */
  saveExport(outPath: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>
  /** agent 触发的导出：直接写进工作区 exports/，不弹对话框 */
  saveWorkspaceExport(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path: string; error?: string }>
  /** 把预览帧等二进制写入工作区 assets/ */
  writeAsset(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path: string; error?: string }>

  onChat(cb: (msg: ChatMessage) => void): () => void
  onAgentStatus(cb: (status: AgentStatus) => void): () => void
  onSceneChanged(cb: (patch: ScenePatch) => void): () => void
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onToolInvoke(cb: (inv: ToolInvocation) => Promise<unknown>): () => void
}

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
  phase: 'idle' | 'starting' | 'ready' | 'running' | 'paused' | 'error'
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

/** 当前打开的草稿 */
export interface ActiveDraft {
  id: string
  name: string
  /** 草稿目录绝对路径（每个草稿是一个自包含的工作区） */
  dir: string
}

/**
 * 草稿库里的一张卡片。
 * 借鉴剪映「草稿箱」和达芬奇「项目管理器」：缩略图 + 名字 + 时长 + 修改时间，
 * 可搜索、可置顶、可复制、可删除。
 */
export interface DraftSummary {
  id: string
  name: string
  /** scene.meta.title（agent 起的标题，通常比草稿名更具体） */
  title: string
  createdAt: number
  updatedAt: number
  /** 最后打开时间（0 = 没打开过） */
  openedAt: number
  durationSec: number
  layerCount: number
  assetCount: number
  exportCount: number
  /** gewu://draft/<id>/previews/cover.png?v=…；没截过封面就是 null */
  coverUrl: string | null
  pinned: boolean
  /** 是否就是主窗口现在打开的那个 */
  active: boolean
  dir: string
}

export interface DraftOpResult {
  ok: boolean
  error?: string
  draft?: DraftSummary
  /** 操作后的完整草稿列表，省一次往返 */
  drafts?: DraftSummary[]
}

/**
 * 导出位置设置。
 * 作者要的是「视频想放哪就放哪」：固定目录、每次问、最近用过的一键切换。
 */
export interface ExportSettings {
  /** 固定导出目录；null = 用 resolvedDir（最近目录或系统视频目录） */
  dir: string | null
  /** 每次导出都弹选择框（导出对话框里仍可改） */
  askEveryTime: boolean
  /** 导出完成后在资源管理器里定位文件 */
  revealAfterExport: boolean
  /** 最近用过的目录，最近的在前 */
  recentDirs: string[]
  /** 主进程算好的「这次默认存哪」 */
  resolvedDir: string
  /** 「恢复默认」用的目录（系统视频目录） */
  systemDir: string
  /** 自动化测试用：--export-path 指定的完整文件路径（正常使用时为 null） */
  forcedPath?: string | null
}

export interface AppState {
  workspace: string
  scenePath: string
  connections: ModelConnection[]
  activeConnectionId: string | null
  /** 看图用的连接；null 表示跟随 activeConnectionId */
  visionConnectionId?: string | null
  agent: AgentStatus
  /** 当前草稿；老版本升级上来时也会有一个 */
  draft: ActiveDraft | null
  exportSettings: ExportSettings
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
  /** 输出分辨率（缺省用场景设计尺寸） */
  width?: number
  height?: number
  /** 目标码率（bps） */
  bitrate?: number
  quality?: 'high' | 'balanced' | 'small'
  /** 导出完成后是否在文件夹中显示 */
  reveal?: boolean
}

/** 导出画质设置：对话框里选，存在本地（不写进草稿） */
export interface ExportFormat {
  /** 'source' 表示跟场景设计尺寸走 */
  resolution: 'source' | '4k' | '2k' | '1080p' | '720p' | '480p'
  fps: number
  /** 'auto' 按分辨率/帧率估；也可以直接给 bps */
  quality: 'high' | 'balanced' | 'small' | 'custom'
  bitrateMbps?: number
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

/** 配音结果：wav 已写进工作区 assets/ */
export interface TtsResult {
  ok: boolean
  path?: string
  durationSec?: number
  bytes?: number
  error?: string
}

export interface TtsVoice {
  name: string
  culture: string
}

/** 视觉模型返回的一段描述 */
export interface VisionResult {
  ok: boolean
  text?: string
  model?: string
  ms?: number
  error?: string
}

/** ---- 素材检索（主进程联网，渲染进程只拿结果） ---- */
export type AssetSearchSource = 'commons' | 'openverse'

export interface AssetSearchItem {
  id: string
  title: string
  /** 已缓存到本机的缩略图（gewu://cache/…），可能为 null */
  thumbUrl: string | null
  /** 原图地址，仅用于下载 */
  fullUrl: string
  width: number
  height: number
  mime: string
  license: string
  artist: string
  sourceUrl: string
  source: AssetSearchSource
  downloadable: boolean
}

export interface AssetSearchResponse {
  ok: boolean
  query: string
  source: AssetSearchSource
  items: AssetSearchItem[]
  error?: string
}

export interface AssetCredit {
  file: string
  title: string
  author: string
  license: string
  source: string
  downloadedAt: string
}

export interface AssetDownloadResult {
  ok: boolean
  path?: string
  name?: string
  bytes?: number
  width?: number
  height?: number
  credit?: AssetCredit
  error?: string
}

/** 音效预设（和 shared/sfx.ts 保持一致，这里只放界面需要的字段） */
export interface SfxPresetInfo {
  id: string
  label: string
  category: 'transition' | 'ui' | 'impact' | 'music'
  duration: number
  desc: string
}

/** ---- 本地知识库（物理 / 数学 / 分镜） ---- */
export type KnowledgeTopic = 'physics' | 'math' | 'storyboard'

export interface KnowledgeHit {
  topic: KnowledgeTopic
  title: string
  keywords: string
  body: string
  score: number
}

export interface KnowledgeSearchResult {
  ok: boolean
  query: string
  topic?: KnowledgeTopic
  hits: KnowledgeHit[]
  /** 没命中时给可用目录 */
  catalog?: string
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
  /** 用资源管理器打开一个目录（不选中） */
  openFolder(path: string): Promise<{ ok: boolean; error?: string }>
  listAssets(): Promise<{ name: string; path: string; size: number }[]>

  /** 系统里可用的 TTS 音色 */
  ttsVoices(): Promise<{ ok: boolean; voices: TtsVoice[]; error?: string }>
  /** 把文字合成成 wav 存到 assets/，用于字幕配音 */
  tts(input: { text: string; name?: string; voice?: string; rate?: number; volume?: number }): Promise<TtsResult>

  /** 指定「看图」用哪条连接（null = 跟随当前对话连接） */
  setVisionConnection(id: string | null): Promise<AppState>
  /** 让视觉模型描述一张图：path 相对工作区，或直接给 dataUrl */
  visionDescribe(input: { path?: string; dataUrl?: string; question?: string }): Promise<VisionResult>

  sendPrompt(text: string, context?: PromptContext): Promise<void>
  cancelPrompt(): Promise<void>
  /** 暂停生成：立刻停止花 token，保留已生成的部分；用 resumePrompt 接着写 */
  pausePrompt(): Promise<void>
  resumePrompt(): Promise<void>
  /** 本会话累计 token 用量（代理统计） */
  getUsage(): Promise<{ inputTokens: number; outputTokens: number; requests: number }>
  newSession(): Promise<void>

  /** 把渲染进程生成的二进制（音效 wav 等）写进 assets/ */
  saveAsset(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path?: string; error?: string }>
  /** 联网检索图片素材（Wikimedia Commons / Openverse） */
  searchAssets(input: { query: string; source?: AssetSearchSource; limit?: number }): Promise<AssetSearchResponse>
  /** 把检索结果下载进当前草稿的 assets/，并记录署名 */
  downloadAsset(item: AssetSearchItem): Promise<AssetDownloadResult>
  /** 已下载素材的署名清单（发布时标注用） */
  listCredits(): Promise<AssetCredit[]>
  /** 本地知识库检索（物理/数学/分镜），也供 agent 的 knowledge_search 使用 */
  knowledgeSearch(input: { query: string; topic?: KnowledgeTopic; limit?: number }): Promise<KnowledgeSearchResult>

  /** 弹出保存对话框，返回用户选择的 mp4 路径 */
  chooseExportPath(req: ExportRequest): Promise<{ ok: boolean; outPath?: string; error?: string }>
  /** 把渲染好的 mp4 字节写入磁盘 */
  saveExport(outPath: string, bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>
  /** agent 触发的导出：写进「设置里的导出目录」，没设置就落到当前草稿的 exports/ */
  saveWorkspaceExport(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path: string; error?: string }>
  /** 用户选的导出：目录 + 文件名，主进程负责拼接、去重、记住位置 */
  saveExportTo(input: { dir: string; name: string }, bytes: Uint8Array, opts?: { reveal?: boolean; overwrite?: boolean }): Promise<{ ok: boolean; path?: string; error?: string }>
  /** 把预览帧等二进制写入工作区 assets/ */
  writeAsset(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path: string; error?: string }>
  /** 把当前画面存成草稿封面（草稿库卡片用） */
  writeCover(bytes: Uint8Array): Promise<{ ok: boolean; error?: string }>

  /** 导出位置设置 */
  getExportSettings(): Promise<ExportSettings>
  setExportSettings(patch: Partial<Pick<ExportSettings, 'dir' | 'askEveryTime' | 'revealAfterExport'>>): Promise<ExportSettings>
  /** 系统文件夹选择框（只选目录），选完自动记进最近目录 */
  chooseExportFolder(input?: { defaultPath?: string }): Promise<{ ok: boolean; dir?: string; error?: string }>

  /** ---- 草稿 ---- */
  listDrafts(): Promise<DraftSummary[]>
  createDraft(input?: { name?: string; template?: 'blank' | 'demo'; fromId?: string }): Promise<DraftOpResult>
  openDraft(id: string): Promise<DraftOpResult>
  renameDraft(id: string, name: string): Promise<DraftOpResult>
  duplicateDraft(id: string): Promise<DraftOpResult>
  deleteDraft(id: string): Promise<DraftOpResult>
  setDraftPinned(id: string, pinned: boolean): Promise<DraftOpResult>
  revealDraft(id: string): Promise<void>
  /** 打开（或聚焦）草稿库窗口 */
  openDraftLibrary(): Promise<void>
  /** 当前草稿的对话记录（每个草稿各存一份） */
  readChat(): Promise<ChatMessage[]>

  onChat(cb: (msg: ChatMessage) => void): () => void
  onAgentStatus(cb: (status: AgentStatus) => void): () => void
  onSceneChanged(cb: (patch: ScenePatch) => void): () => void
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onToolInvoke(cb: (inv: ToolInvocation) => Promise<unknown>): () => void
  /** 草稿增删改后广播（两个窗口都收） */
  onDraftsChanged(cb: (drafts: DraftSummary[]) => void): () => void
  /** 主窗口切了草稿 */
  onDraftOpened(cb: (draft: ActiveDraft) => void): () => void
}

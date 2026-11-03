import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentStatus, ActiveDraft, AppState, ChatMessage, DraftOpResult, DraftSummary, ExportProgress,
  ExportSettings, GewuApi, ScenePatch, ToolInvocation, ToolResult
} from '@shared/ipc'
import type { Scene } from '@shared/scene'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: GewuApi = {
  getState: () => ipcRenderer.invoke('gewu:get-state') as Promise<AppState>,
  saveConnection: input => ipcRenderer.invoke('gewu:save-connection', input) as Promise<AppState>,
  deleteConnection: id => ipcRenderer.invoke('gewu:delete-connection', id) as Promise<AppState>,
  setActiveConnection: id => ipcRenderer.invoke('gewu:set-active-connection', id) as Promise<AppState>,
  testConnection: input => ipcRenderer.invoke('gewu:test-connection', input),
  listRemoteModels: input => ipcRenderer.invoke('gewu:list-models', input) as Promise<string[]>,

  readScene: () => ipcRenderer.invoke('gewu:read-scene') as Promise<Scene>,
  writeScene: (scene, source = 'user') => ipcRenderer.invoke('gewu:write-scene', { scene, source }),
  pickImage: () => ipcRenderer.invoke('gewu:pick-image'),
  importAsset: () => ipcRenderer.invoke('gewu:import-asset'),
  revealPath: path => ipcRenderer.invoke('gewu:reveal', path),
  openFolder: path => ipcRenderer.invoke('gewu:open-folder', path),
  listAssets: () => ipcRenderer.invoke('gewu:list-assets'),
  ttsVoices: () => ipcRenderer.invoke('gewu:tts-voices'),
  tts: input => ipcRenderer.invoke('gewu:tts', input),
  setVisionConnection: id => ipcRenderer.invoke('gewu:set-vision-connection', id) as Promise<AppState>,
  visionDescribe: input => ipcRenderer.invoke('gewu:vision-describe', input),

  sendPrompt: (text, context) => ipcRenderer.invoke('gewu:send-prompt', text, context),
  cancelPrompt: () => ipcRenderer.invoke('gewu:cancel-prompt'),
  newSession: () => ipcRenderer.invoke('gewu:new-session'),

  chooseExportPath: req => ipcRenderer.invoke('gewu:choose-export-path', req),
  saveExport: (outPath, bytes) => ipcRenderer.invoke('gewu:save-export', outPath, bytes),
  saveWorkspaceExport: (name, bytes) => ipcRenderer.invoke('gewu:save-workspace-export', name, bytes),
  saveExportTo: (input, bytes, opts) => ipcRenderer.invoke('gewu:save-export-to', input, bytes, opts),
  writeAsset: (name, bytes) => ipcRenderer.invoke('gewu:write-asset', name, bytes),
  writeCover: bytes => ipcRenderer.invoke('gewu:write-cover', bytes),

  getExportSettings: () => ipcRenderer.invoke('gewu:get-export-settings') as Promise<ExportSettings>,
  setExportSettings: patch => ipcRenderer.invoke('gewu:set-export-settings', patch) as Promise<ExportSettings>,
  chooseExportFolder: input => ipcRenderer.invoke('gewu:choose-export-folder', input),

  listDrafts: () => ipcRenderer.invoke('gewu:list-drafts') as Promise<DraftSummary[]>,
  createDraft: input => ipcRenderer.invoke('gewu:create-draft', input) as Promise<DraftOpResult>,
  openDraft: id => ipcRenderer.invoke('gewu:open-draft', id) as Promise<DraftOpResult>,
  renameDraft: (id, name) => ipcRenderer.invoke('gewu:rename-draft', id, name) as Promise<DraftOpResult>,
  duplicateDraft: id => ipcRenderer.invoke('gewu:duplicate-draft', id) as Promise<DraftOpResult>,
  deleteDraft: id => ipcRenderer.invoke('gewu:delete-draft', id) as Promise<DraftOpResult>,
  setDraftPinned: (id, pinned) => ipcRenderer.invoke('gewu:set-draft-pinned', id, pinned) as Promise<DraftOpResult>,
  revealDraft: id => ipcRenderer.invoke('gewu:reveal-draft', id) as Promise<void>,
  openDraftLibrary: () => ipcRenderer.invoke('gewu:open-draft-library') as Promise<void>,
  readChat: () => ipcRenderer.invoke('gewu:read-chat') as Promise<ChatMessage[]>,

  onChat: cb => subscribe<ChatMessage>('gewu:chat', cb),
  onAgentStatus: cb => subscribe<AgentStatus>('gewu:agent-status', cb),
  onSceneChanged: cb => subscribe<ScenePatch>('gewu:scene-changed', cb),
  onExportProgress: cb => subscribe<ExportProgress>('gewu:export-progress', cb),
  onDraftsChanged: cb => subscribe<DraftSummary[]>('gewu:drafts-changed', cb),
  onDraftOpened: cb => subscribe<ActiveDraft>('gewu:draft-opened', cb),
  onToolInvoke: cb => {
    const listener = async (_e: Electron.IpcRendererEvent, inv: ToolInvocation) => {
      let result: ToolResult
      try {
        result = { ok: true, result: await cb(inv) }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      ipcRenderer.send('gewu:tool-result', { id: inv.id, ...result })
    }
    ipcRenderer.on('gewu:tool-invoke', listener)
    return () => ipcRenderer.off('gewu:tool-invoke', listener)
  }
}

contextBridge.exposeInMainWorld('gewu', api)

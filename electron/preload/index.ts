import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentStatus, AppState, ChatMessage, ExportProgress, GewuApi, ScenePatch, ToolInvocation, ToolResult
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
  listAssets: () => ipcRenderer.invoke('gewu:list-assets'),
  ttsVoices: () => ipcRenderer.invoke('gewu:tts-voices'),
  tts: input => ipcRenderer.invoke('gewu:tts', input),

  sendPrompt: (text, context) => ipcRenderer.invoke('gewu:send-prompt', text, context),
  cancelPrompt: () => ipcRenderer.invoke('gewu:cancel-prompt'),
  newSession: () => ipcRenderer.invoke('gewu:new-session'),

  chooseExportPath: req => ipcRenderer.invoke('gewu:choose-export-path', req),
  saveExport: (outPath, bytes) => ipcRenderer.invoke('gewu:save-export', outPath, bytes),
  saveWorkspaceExport: (name, bytes) => ipcRenderer.invoke('gewu:save-workspace-export', name, bytes),
  writeAsset: (name, bytes) => ipcRenderer.invoke('gewu:write-asset', name, bytes),

  onChat: cb => subscribe<ChatMessage>('gewu:chat', cb),
  onAgentStatus: cb => subscribe<AgentStatus>('gewu:agent-status', cb),
  onSceneChanged: cb => subscribe<ScenePatch>('gewu:scene-changed', cb),
  onExportProgress: cb => subscribe<ExportProgress>('gewu:export-progress', cb),
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

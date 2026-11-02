import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Scene, SceneLayer } from '../shared/scene'
import { emptyScene } from '../shared/scene'

export interface EditorState {
  scene: Scene
  selectedLayerId: string | null
  time: number
  playing: boolean
  dirty: boolean
  saving: boolean
  lastSavedAt: number | null
}

interface HistoryEntry { scene: Scene; label: string }

export interface EditorApi {
  state: EditorState
  select(id: string | null): void
  setTime(t: number): void
  setPlaying(p: boolean): void
  updateScene(updater: (scene: Scene) => Scene, opts?: { label?: string; persist?: boolean }): void
  updateLayer(id: string, patch: Partial<SceneLayer>, opts?: { label?: string }): void
  addLayer(layer: SceneLayer): void
  removeLayer(id: string): void
  reorderLayer(from: number, to: number): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  save(): Promise<void>
  replaceScene(scene: Scene, opts?: { label?: string; persist?: boolean }): void
}

const Ctx = createContext<EditorApi | null>(null)

export function useEditor(): EditorApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useEditor 必须在 EditorProvider 内使用')
  return v
}

export const EditorContext = Ctx

export function useEditorState(initial: Scene): EditorApi {
  const [scene, setScene] = useState<Scene>(initial)
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(initial.layers[0]?.id ?? null)
  const [time, setTimeState] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const undoStack = useRef<HistoryEntry[]>([])
  const redoStack = useRef<HistoryEntry[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  /** agent 一轮里可能连续改好几次，合并成一条撤销记录 */
  const aiEditAt = useRef(0)

  const refreshFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  const persist = useCallback(async (s: Scene) => {
    setSaving(true)
    try {
      await window.gewu.writeScene(s, 'user')
      setLastSavedAt(Date.now())
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [])

  const scheduleSave = useCallback((s: Scene) => {
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(s) }, 600)
  }, [persist])

  const updateScene = useCallback((updater: (scene: Scene) => Scene, opts?: { label?: string; persist?: boolean }) => {
    setScene(prev => {
      const next = updater(prev)
      if (next === prev) return prev
      undoStack.current.push({ scene: prev, label: opts?.label ?? '编辑' })
      if (undoStack.current.length > 80) undoStack.current.shift()
      redoStack.current = []
      refreshFlags()
      if (opts?.persist !== false) scheduleSave(next)
      return next
    })
  }, [refreshFlags, scheduleSave])

  const replaceScene = useCallback((next: Scene, opts?: { label?: string; persist?: boolean }) => {
    const now = Date.now()
    const isAi = opts?.label === 'AI 修改'
    const coalesce = isAi && now - aiEditAt.current < 6000
    aiEditAt.current = isAi ? now : 0
    setScene(prev => {
      if (!coalesce) {
        undoStack.current.push({ scene: prev, label: opts?.label ?? '外部更新' })
        if (undoStack.current.length > 80) undoStack.current.shift()
        redoStack.current = []
        refreshFlags()
      }
      if (opts?.persist !== false) scheduleSave(next)
      return next
    })
  }, [refreshFlags, scheduleSave])

  const updateLayer = useCallback((id: string, patch: Partial<SceneLayer>, opts?: { label?: string }) => {
    updateScene(s => ({ ...s, layers: s.layers.map(l => (l.id === id ? { ...l, ...patch } : l)) }), opts)
  }, [updateScene])

  const addLayer = useCallback((layer: SceneLayer) => {
    updateScene(s => ({ ...s, layers: [...s.layers, layer] }), { label: '新增图层' })
    setSelectedLayerId(layer.id)
  }, [updateScene])

  const removeLayer = useCallback((id: string) => {
    updateScene(s => ({ ...s, layers: s.layers.filter(l => l.id !== id) }), { label: '删除图层' })
    setSelectedLayerId(prev => (prev === id ? null : prev))
  }, [updateScene])

  const reorderLayer = useCallback((from: number, to: number) => {
    updateScene(s => {
      if (from === to || from < 0 || to < 0 || from >= s.layers.length || to >= s.layers.length) return s
      const layers = [...s.layers]
      const [moved] = layers.splice(from, 1)
      layers.splice(to, 0, moved)
      return { ...s, layers }
    }, { label: '调整图层顺序' })
  }, [updateScene])

  const undo = useCallback(() => {
    const entry = undoStack.current.pop()
    if (!entry) return
    setScene(prev => {
      redoStack.current.push({ scene: prev, label: entry.label })
      return entry.scene
    })
    refreshFlags()
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(entry.scene) }, 300)
  }, [persist, refreshFlags])

  const redo = useCallback(() => {
    const entry = redoStack.current.pop()
    if (!entry) return
    setScene(prev => {
      undoStack.current.push({ scene: prev, label: entry.label })
      return entry.scene
    })
    refreshFlags()
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(entry.scene) }, 300)
  }, [persist, refreshFlags])

  const save = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await persist(sceneRef.current)
  }, [persist])

  const setTime = useCallback((t: number) => {
    setTimeState(Math.max(0, Math.min(sceneRef.current.canvas.duration, t)))
  }, [])

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
        return
      }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, save, undo])

  return useMemo<EditorApi>(() => ({
    state: { scene, selectedLayerId, time, playing, dirty, saving, lastSavedAt },
    select: setSelectedLayerId,
    setTime,
    setPlaying,
    updateScene,
    updateLayer,
    addLayer,
    removeLayer,
    reorderLayer,
    undo,
    redo,
    canUndo,
    canRedo,
    save,
    replaceScene
  }), [scene, selectedLayerId, time, playing, dirty, saving, lastSavedAt, setTime, updateScene, updateLayer, addLayer, removeLayer, reorderLayer, undo, redo, canUndo, canRedo, save, replaceScene])
}

export function newLayerId(scene: Scene): string {
  let i = scene.layers.length + 1
  const ids = new Set(scene.layers.map(l => l.id))
  let id = `layer_${i}`
  while (ids.has(id)) id = `layer_${++i}`
  return id
}

export { emptyScene }

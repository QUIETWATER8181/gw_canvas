import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Scene, SceneGuides, SceneLayer } from '../shared/scene'
import { applyAutoDuration, contentEnd, emptyScene, extendDurationTo } from '../shared/scene'
import {
  cloneTree, collectIds, findLayer, getAt, insertAt, moveAt, nextLayerId,
  removeAt, removeMany, replaceAt, selfBox, unionBox, updateAt
} from '../shared/layers'
import { computeReparent } from '../components/layer-ops'

export interface EditorState {
  scene: Scene
  /** 主选中（最后点的那个），兼容老代码 */
  selectedLayerId: string | null
  /** 多选；顺序 = 选择先后 */
  selection: string[]
  time: number
  playing: boolean
  dirty: boolean
  saving: boolean
  lastSavedAt: number | null
}

interface HistoryEntry { scene: Scene; label: string; at: number }

export interface EditorApi {
  state: EditorState
  select(id: string | null): void
  selectMany(ids: string[]): void
  toggleSelect(id: string): void
  setTime(t: number): void
  setPlaying(p: boolean): void
  updateScene(updater: (scene: Scene) => Scene, opts?: { label?: string; persist?: boolean; mergeMs?: number; transient?: boolean; noExtend?: boolean }): void
  updateLayer(id: string, patch: Partial<SceneLayer>, opts?: { label?: string; mergeMs?: number; transient?: boolean }): void
  addLayer(layer: SceneLayer, parentId?: string | null): void
  removeLayer(id: string): void
  removeLayers(ids: string[]): void
  duplicate(ids: string[]): { created: string[]; map: Record<string, string> }
  group(ids: string[]): string | null
  ungroup(id: string): void
  /** 在兄弟节点里上下移动（-1 下移一层 / +1 上移一层） */
  reorder(id: string, dir: -1 | 1): void
  /** 把节点移到新父级（null=根）的指定位置；坐标会换算，画面不跳 */
  moveTo(id: string, parentId: string | null, index: number): void
  /** 复制到内部剪贴板（保留父级路径，粘贴回原组合） */
  copy(ids: string[]): number
  /** 粘贴剪贴板；返回新元素 id */
  paste(): string[]
  setGuides(guides: SceneGuides): void
  reorderLayer(from: number, to: number): void
  /** 时长跟随素材（打开 autoDuration 并立即对齐） */
  fitDuration(): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  save(): Promise<void>
  replaceScene(scene: Scene, opts?: { label?: string; persist?: boolean; resetHistory?: boolean }): void
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
  const [selection, setSelection] = useState<string[]>(() => {
    const first = initial.layers[0]?.id
    return first ? [first] : []
  })
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
  const timeRef = useRef(time)
  timeRef.current = time
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  /** agent 一轮里可能连续改好几次，合并成一条撤销记录 */
  const aiEditAt = useRef(0)
  /** 内部剪贴板：连同父级路径一起存，粘贴回原组合而不是掉到根 */
  const clipboard = useRef<{ layer: SceneLayer; parentIds: string[] }[]>([])

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

  const updateScene = useCallback((updater: (scene: Scene) => Scene, opts?: { label?: string; persist?: boolean; mergeMs?: number; transient?: boolean; noExtend?: boolean }) => {
    setScene(prev => {
      let next = updater(prev)
      if (next === prev) return prev
      if (!opts?.transient) {
        // 时长跟素材走：autoDuration 打开时对齐到内容；没打开时内容超长也自动延长
        next = applyAutoDuration(next)
        if (!opts?.noExtend) {
          const end = contentEnd(next)
          if (end > next.canvas.duration + 0.05) next = extendDurationTo(next, end)
        }
      }
      const label = opts?.label ?? '编辑'
      const now = Date.now()
      // 同一次连续操作（如拖拽剪辑块）合并成一条撤销记录：
      // 保留第一次快照（拖拽开始前的值），只刷新时间戳。
      const last = undoStack.current[undoStack.current.length - 1]
      if (last && opts?.mergeMs && last.label === label && now - last.at < opts.mergeMs) {
        last.at = now
      } else {
        undoStack.current.push({ scene: prev, label, at: now })
        if (undoStack.current.length > 80) undoStack.current.shift()
      }
      redoStack.current = []
      refreshFlags()
      if (opts?.persist !== false) scheduleSave(next)
      return next
    })
  }, [refreshFlags, scheduleSave])

  const replaceScene = useCallback((next: Scene, opts?: { label?: string; persist?: boolean; resetHistory?: boolean }) => {
    const now = Date.now()
    const isAi = opts?.label === 'AI 修改'
    const coalesce = isAi && now - aiEditAt.current < 6000
    aiEditAt.current = isAi ? now : 0
    setScene(prev => {
      if (opts?.resetHistory) {
        // 切草稿：撤销栈属于上一个草稿，不能带过来（否则 Ctrl+Z 会把旧场景写进新草稿）
        undoStack.current = []
        redoStack.current = []
        refreshFlags()
      } else if (!coalesce) {
        undoStack.current.push({ scene: prev, label: opts?.label ?? '外部更新', at: now })
        if (undoStack.current.length > 80) undoStack.current.shift()
        redoStack.current = []
        refreshFlags()
      }
      if (opts?.persist !== false) scheduleSave(next)
      return next
    })
  }, [refreshFlags, scheduleSave])

  const updateLayer = useCallback((id: string, patch: Partial<SceneLayer>, opts?: { label?: string; mergeMs?: number; transient?: boolean }) => {
    updateScene(s => {
      const hit = findLayer(s.layers, id)
      if (!hit) return s
      return { ...s, layers: updateAt(s.layers, hit.path, patch) }
    }, opts)
  }, [updateScene])

  const select = useCallback((id: string | null) => {
    setSelection(id ? [id] : [])
  }, [])

  const selectMany = useCallback((ids: string[]) => {
    setSelection([...new Set(ids.filter(Boolean))])
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelection(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]))
  }, [])

  const addLayer = useCallback((layer: SceneLayer, parentId?: string | null) => {
    updateScene(s => {
      const hit = parentId ? findLayer(s.layers, parentId) : null
      if (hit) {
        const kids = hit.layer.children ?? []
        return { ...s, layers: updateAt(s.layers, hit.path, { children: [...kids, layer] }) }
      }
      return { ...s, layers: [...s.layers, layer] }
    }, { label: '新增图层' })
    setSelection([layer.id])
  }, [updateScene])

  const removeLayers = useCallback((ids: string[]) => {
    if (!ids.length) return
    updateScene(s => {
      const paths = ids.map(id => findLayer(s.layers, id)?.path).filter((p): p is string[] => Boolean(p))
      if (!paths.length) return s
      return { ...s, layers: removeMany(s.layers, paths) }
    }, { label: ids.length > 1 ? '删除多个图层' : '删除图层' })
    setSelection(prev => prev.filter(id => !ids.includes(id)))
  }, [updateScene])

  const removeLayer = useCallback((id: string) => removeLayers([id]), [removeLayers])

  const duplicate = useCallback((ids: string[]): { created: string[]; map: Record<string, string> } => {
    // 注意：新 id 必须在这里同步算好（React 的 setScene 回调是延后执行的，
    // 在回调里 push 出来的 id 返回给调用方时还是空的——Alt+拖复制会因此拖错对象）
    const s = sceneRef.current
    const used = new Set(collectIds(s.layers))
    const map: Record<string, string> = {}
    const makeId = (oldId?: string) => {
      let i = used.size + 1
      let id = `copy_${i}`
      while (used.has(id)) id = `copy_${++i}`
      used.add(id)
      if (oldId) map[oldId] = id
      return id
    }
    const created: string[] = []
    const copies: { fromId: string; copy: SceneLayer }[] = []
    for (const id of ids) {
      const hit = findLayer(s.layers, id)
      if (!hit) continue
      const copy = cloneTree(hit.layer, makeId)
      copy.name = `${hit.layer.name} 副本`
      created.push(copy.id)
      copies.push({ fromId: id, copy })
    }
    if (copies.length) {
      updateScene(sc => {
        let layers = sc.layers
        for (const item of copies) {
          const hit = findLayer(layers, item.fromId)
          layers = hit ? insertAt(layers, hit.parentPath, hit.index + 1, item.copy) : [...layers, item.copy]
        }
        return { ...sc, layers }
      }, { label: '复制图层' })
      setSelection(created)
    }
    return { created, map }
  }, [updateScene])

  const copy = useCallback((ids: string[]): number => {
    const s = sceneRef.current
    const items: { layer: SceneLayer; parentIds: string[] }[] = []
    for (const id of ids) {
      const hit = findLayer(s.layers, id)
      if (!hit) continue
      items.push({ layer: JSON.parse(JSON.stringify(hit.layer)) as SceneLayer, parentIds: [...hit.parentPath] })
    }
    clipboard.current = items
    return items.length
  }, [])

  const paste = useCallback((): string[] => {
    const items = clipboard.current
    if (!items.length) return []
    // 同样：新 id 同步算好，别指望 setScene 回调里的副作用
    const s = sceneRef.current
    const used = new Set(collectIds(s.layers))
    const makeId = () => {
      let i = used.size + 1
      let id = `paste_${i}`
      while (used.has(id)) id = `paste_${++i}`
      used.add(id)
      return id
    }
    const created: string[] = []
    const planned = items.map(item => {
      const copyLayer = cloneTree(item.layer, makeId)
      copyLayer.x = Math.round(((Number(copyLayer.x) || 0) + 24) * 100) / 100
      copyLayer.y = Math.round(((Number(copyLayer.y) || 0) + 24) * 100) / 100
      created.push(copyLayer.id)
      return { copy: copyLayer, parentIds: item.parentIds }
    })
    updateScene(sc => {
      let layers = sc.layers
      for (const p of planned) {
        // 粘回原来的父级（组合内复制不会掉到根层级）
        const parentHit = p.parentIds.length ? findLayer(layers, p.parentIds[p.parentIds.length - 1]) : null
        if (parentHit) {
          layers = updateAt(layers, parentHit.path, { children: [...(parentHit.layer.children ?? []), p.copy] })
        } else {
          layers = [...layers, p.copy]
        }
      }
      return { ...sc, layers }
    }, { label: '粘贴元素' })
    setSelection(created)
    return created
  }, [updateScene])

  const setGuides = useCallback((guides: SceneGuides) => {
    updateScene(s => ({ ...s, guides: guides.v.length || guides.h.length ? guides : undefined }), { label: '参考线' })
  }, [updateScene])

  const group = useCallback((ids: string[]): string | null => {
    const s = sceneRef.current
    if (ids.length < 2) return null
    const hits = ids.map(id => findLayer(s.layers, id)).filter((h): h is NonNullable<typeof h> => Boolean(h))
    if (hits.length < 2) return null
    const parentPath = hits[0].parentPath
    const siblings = hits.filter(h => h.parentPath.join('/') === parentPath.join('/'))
    if (siblings.length < 2) return null
    const minIndex = Math.min(...siblings.map(h => h.index))
    const groupId = nextLayerId(s, 'group')
    // 组合要有自己的盒子，才能整体旋转/缩放；子元素坐标转成相对组合左上角
    const box = unionBox(siblings.map(h => selfBox(h.layer) ?? h.layer.bounds ?? null))
    const gx = box ? Math.round(box.x) : 0
    const gy = box ? Math.round(box.y) : 0
    const children = siblings
      .sort((a, b) => a.index - b.index)
      .map(h => ({
        ...h.layer,
        x: Math.round((Number(h.layer.x) || 0) - gx),
        y: Math.round((Number(h.layer.y) || 0) - gy)
      }))
    const groupLayer: SceneLayer = {
      id: groupId,
      name: '组合',
      kind: 'group',
      x: gx,
      y: gy,
      ...(box ? { w: Math.round(box.w), h: Math.round(box.h) } : {}),
      children
    }
    updateScene(sc => {
      let layers = removeMany(sc.layers, siblings.map(h => h.path))
      layers = insertAt(layers, parentPath, minIndex, groupLayer)
      return { ...sc, layers }
    }, { label: '成组' })
    setSelection([groupId])
    return groupId
  }, [updateScene])

  const ungroup = useCallback((id: string) => {
    const s = sceneRef.current
    const hit = findLayer(s.layers, id)
    if (!hit || !hit.layer.children?.length) return
    const g = hit.layer
    const kids = (g.children ?? []).map(kid => ({
      ...kid,
      x: (Number(kid.x) || 0) + (Number(g.x) || 0),
      y: (Number(kid.y) || 0) + (Number(g.y) || 0)
    }))
    updateScene(sc => {
      let layers = removeAt(sc.layers, hit.path)
      kids.forEach((kid, i) => {
        layers = insertAt(layers, hit.parentPath, hit.index + i, kid)
      })
      return { ...sc, layers }
    }, { label: '解组' })
    setSelection(kids.map(k => k.id))
  }, [updateScene])

  const reorder = useCallback((id: string, dir: -1 | 1) => {
    const s = sceneRef.current
    const hit = findLayer(s.layers, id)
    if (!hit) return
    const parent = hit.parentPath.length ? getAt(s.layers, hit.parentPath) : null
    const list = parent ? (parent.children ?? []) : s.layers
    const target = hit.index + dir
    if (target < 0 || target >= list.length) return
    updateScene(sc => ({ ...sc, layers: moveAt(sc.layers, hit.path, hit.parentPath, target) }), { label: '调整层级' })
  }, [updateScene])

  const moveTo = useCallback((id: string, parentId: string | null, index: number) => {
    const s = sceneRef.current
    const hit = findLayer(s.layers, id)
    if (!hit) return
    const parentPath = parentId ? (findLayer(s.layers, parentId)?.path ?? []) : []
    // 换父级时换算坐标：拖进有偏移/旋转的组合后，画面位置不能跳
    const sameParent = hit.parentPath.join('/') === parentPath.join('/')
    const patch = sameParent ? null : computeReparent(s, id, parentId)
    updateScene(sc => {
      let layers = moveAt(sc.layers, hit.path, parentPath, index)
      if (patch) {
        const moved = findLayer(layers, id)
        if (moved) layers = updateAt(layers, moved.path, { x: patch.x, y: patch.y, rotation: patch.rotation })
      }
      return { ...sc, layers }
    }, { label: '移动图层' })
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

  /** 一次性把时长对齐到素材结束（不强制打开「自动」） */
  const fitDuration = useCallback(() => {
    updateScene(s => {
      const end = contentEnd(s)
      if (end < 0.1) return s
      const next = Math.max(1, Math.round(end * 10) / 10)
      if (Math.abs(next - s.canvas.duration) < 0.05) return s
      return { ...s, canvas: { ...s.canvas, duration: next } }
    }, { label: '适配素材时长', noExtend: true })
  }, [updateScene])

  const undo = useCallback(() => {
    const entry = undoStack.current.pop()
    if (!entry) return
    setScene(prev => {
      redoStack.current.push({ scene: prev, label: entry.label, at: Date.now() })
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
      undoStack.current.push({ scene: prev, label: entry.label, at: Date.now() })
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

  // 时长变短（自动对齐/裁剪）时，播放头不能停在时间轴外面
  useEffect(() => {
    setTimeState(t => (t > scene.canvas.duration ? scene.canvas.duration : t))
  }, [scene.canvas.duration])

  // 全局快捷键（画布上的方向键/删除由 Stage 自己处理，这里只兜底时间轴操作）
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
      // 撤销/重做在画布聚焦时也要生效（画布自己处理方向键/删除，别抢）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      // 复制/粘贴放在画布守卫之前：点过画布之后 Ctrl+C/V 也要能用
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v')) {
        e.preventDefault()
        if (e.key === 'c') copy(selectionRef.current)
        else paste()
        return
      }
      if (target?.closest?.('[data-canvas]')) return
      // ←/→ 逐帧步进，Home/End 跳首尾（剪映同款）
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const fps = sceneRef.current.canvas.fps || 30
        const step = (e.shiftKey ? 10 : 1) / fps
        setTime(timeRef.current + (e.key === 'ArrowLeft' ? -step : step))
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setTime(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setTime(sceneRef.current.canvas.duration)
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copy, paste, redo, save, undo])

  return useMemo<EditorApi>(() => ({
    state: {
      scene,
      selectedLayerId: selection.length ? selection[selection.length - 1] : null,
      selection,
      time, playing, dirty, saving, lastSavedAt
    },
    select,
    selectMany,
    toggleSelect,
    setTime,
    setPlaying,
    updateScene,
    updateLayer,
    addLayer,
    removeLayer,
    removeLayers,
    duplicate,
    group,
    ungroup,
    reorder,
    moveTo,
    copy,
    paste,
    setGuides,
    reorderLayer,
    fitDuration,
    undo,
    redo,
    canUndo,
    canRedo,
    save,
    replaceScene
  }), [scene, selection, time, playing, dirty, saving, lastSavedAt, select, selectMany, toggleSelect, setTime, updateScene, updateLayer, addLayer, removeLayer, removeLayers, duplicate, group, ungroup, reorder, moveTo, copy, paste, setGuides, reorderLayer, fitDuration, undo, redo, canUndo, canRedo, save, replaceScene])
}

export function newLayerId(scene: Scene): string {
  return nextLayerId(scene)
}

export { emptyScene }

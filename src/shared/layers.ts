import type { Rect, Scene, SceneLayer } from './scene'
import { hasOwnBox, isGroup, layerKind } from './scene'

/**
 * 图层树的纯函数工具箱。
 *
 * 路径 = 从根到该节点的 id 数组。所有修改都返回新数组（不原地改），
 * 这样 React 的状态比较和撤销栈都简单。
 */

export interface FlatLayer {
  layer: SceneLayer
  path: string[]
  depth: number
  parentPath: string[]
  index: number
  hasChildren: boolean
}

export interface LayerHit {
  layer: SceneLayer
  path: string[]
  parentPath: string[]
  index: number
  depth: number
}

export function samePath(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function isPrefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => v === path[i])
}

export function pathKey(path: string[]): string {
  return path.join('/')
}

/** 深度优先展开；collapsed 里的组合不展开子节点 */
export function flatten(layers: SceneLayer[], collapsed?: Set<string>, basePath: string[] = [], depth = 0): FlatLayer[] {
  const out: FlatLayer[] = []
  layers.forEach((layer, index) => {
    const path = [...basePath, layer.id]
    const kids = layer.children ?? []
    const open = !collapsed?.has(layer.id)
    out.push({ layer, path, depth, parentPath: basePath, index, hasChildren: kids.length > 0 })
    if (kids.length && open) out.push(...flatten(kids, collapsed, path, depth + 1))
  })
  return out
}

export function findLayer(layers: SceneLayer[], id: string, basePath: string[] = [], depth = 0): LayerHit | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const path = [...basePath, layer.id]
    if (layer.id === id) return { layer, path, parentPath: basePath, index: i, depth }
    const kids = layer.children
    if (kids?.length) {
      const hit = findLayer(kids, id, path, depth + 1)
      if (hit) return hit
    }
  }
  return null
}

export function getAt(layers: SceneLayer[], path: string[]): SceneLayer | null {
  if (!path.length) return null
  const [head, ...rest] = path
  const layer = layers.find(l => l.id === head)
  if (!layer) return null
  if (!rest.length) return layer
  return getAt(layer.children ?? [], rest)
}

/** 返回从根到该节点的所有祖先（不含自身） */
export function ancestorsOf(layers: SceneLayer[], path: string[]): SceneLayer[] {
  const out: SceneLayer[] = []
  let list = layers
  for (const id of path) {
    const layer = list.find(l => l.id === id)
    if (!layer) break
    out.push(layer)
    list = layer.children ?? []
  }
  out.pop()
  return out
}

export function mapTree(layers: SceneLayer[], fn: (layer: SceneLayer, path: string[]) => SceneLayer, basePath: string[] = []): SceneLayer[] {
  return layers.map((layer, index) => {
    const path = [...basePath, layer.id]
    const mapped = fn(layer, path)
    void index
    if (!mapped.children?.length) return mapped
    const kids = mapTree(mapped.children, fn, path)
    return kids === mapped.children ? mapped : { ...mapped, children: kids }
  })
}

export function updateAt(layers: SceneLayer[], path: string[], patch: Partial<SceneLayer>): SceneLayer[] {
  if (!path.length) return layers
  const [head, ...rest] = path
  return layers.map(layer => {
    if (layer.id !== head) return layer
    if (!rest.length) return { ...layer, ...patch }
    const kids = layer.children ?? []
    const next = updateAt(kids, rest, patch)
    return next === kids ? layer : { ...layer, children: next }
  })
}

export function replaceAt(layers: SceneLayer[], path: string[], next: SceneLayer): SceneLayer[] {
  if (!path.length) return layers
  const [head, ...rest] = path
  return layers.map(layer => {
    if (layer.id !== head) return layer
    if (!rest.length) return next
    const kids = layer.children ?? []
    const replaced = replaceAt(kids, rest, next)
    return replaced === kids ? layer : { ...layer, children: replaced }
  })
}

export function removeAt(layers: SceneLayer[], path: string[]): SceneLayer[] {
  if (!path.length) return layers
  const [head, ...rest] = path
  if (!rest.length) return layers.filter(l => l.id !== head)
  return layers.map(layer => {
    if (layer.id !== head) return layer
    const kids = layer.children ?? []
    const next = removeAt(kids, rest)
    return next === kids ? layer : { ...layer, children: next }
  })
}

export function removeMany(layers: SceneLayer[], paths: string[][]): SceneLayer[] {
  // 先删深的，避免父路径被删后子路径失效
  const sorted = [...paths].sort((a, b) => b.length - a.length)
  return sorted.reduce((acc, path) => removeAt(acc, path), layers)
}

export function insertAt(layers: SceneLayer[], parentPath: string[], index: number, layer: SceneLayer): SceneLayer[] {
  if (!parentPath.length) {
    const out = [...layers]
    out.splice(Math.max(0, Math.min(index, out.length)), 0, layer)
    return out
  }
  const [head, ...rest] = parentPath
  return layers.map(l => {
    if (l.id !== head) return l
    const kids = l.children ?? []
    const next = insertAt(kids, rest, index, layer)
    return { ...l, children: next }
  })
}

/** 把 fromPath 的节点移到 toParentPath 的 toIndex（同父内移动也走这里） */
export function moveAt(layers: SceneLayer[], fromPath: string[], toParentPath: string[], toIndex: number): SceneLayer[] {
  const node = getAt(layers, fromPath)
  if (!node) return layers
  // 不能把组合挪进自己的子孙里
  if (isPrefix(fromPath, toParentPath)) return layers
  const fromParent = fromPath.slice(0, -1)
  const fromIndex = fromParent.length ? (getAt(layers, fromParent)?.children ?? []).findIndex(l => l.id === fromPath[fromPath.length - 1]) : layers.findIndex(l => l.id === fromPath[0])
  let target = toIndex
  if (samePath(fromParent, toParentPath) && fromIndex >= 0 && fromIndex < toIndex) target -= 1
  const without = removeAt(layers, fromPath)
  return insertAt(without, toParentPath, target, node)
}

export function descendantIds(layer: SceneLayer, out: string[] = []): string[] {
  for (const kid of layer.children ?? []) {
    out.push(kid.id)
    descendantIds(kid, out)
  }
  return out
}

export function collectIds(layers: SceneLayer[], out: string[] = []): string[] {
  for (const layer of layers) {
    out.push(layer.id)
    collectIds(layer.children ?? [], out)
  }
  return out
}

export function countLayers(layers: SceneLayer[]): number {
  let n = 0
  for (const layer of layers) n += 1 + countLayers(layer.children ?? [])
  return n
}

/** 深拷贝一棵子树，并给所有节点换新 id */
export function cloneTree(layer: SceneLayer, makeId: () => string): SceneLayer {
  const copy: SceneLayer = JSON.parse(JSON.stringify(layer))
  copy.id = makeId()
  copy.children = copy.children?.map(kid => cloneTree(kid, makeId))
  return copy
}

export function nextLayerId(scene: Scene, prefix = 'layer'): string {
  const used = new Set(collectIds(scene.layers))
  let i = used.size + 1
  let id = `${prefix}_${i}`
  while (used.has(id)) id = `${prefix}_${++i}`
  return id
}

/** typed 元素自身的盒子（不含 transform） */
export function selfBox(layer: SceneLayer): Rect | null {
  if (!hasOwnBox(layer)) return null
  return { x: layer.x ?? 0, y: layer.y ?? 0, w: layer.w ?? 0, h: layer.h ?? 0 }
}

export function unionBox(boxes: (Rect | null)[]): Rect | null {
  const valid = boxes.filter((b): b is Rect => Boolean(b && b.w > 0 && b.h > 0))
  if (!valid.length) return null
  const x = Math.min(...valid.map(b => b.x))
  const y = Math.min(...valid.map(b => b.y))
  const r = Math.max(...valid.map(b => b.x + b.w))
  const btm = Math.max(...valid.map(b => b.y + b.h))
  return { x, y, w: r - x, h: btm - y }
}

/** 组合在画布上的名义盒子：所有子元素盒子的并集（不含祖先 transform） */
export function groupBox(layer: SceneLayer): Rect | null {
  if (!layer.children?.length) return null
  return unionBox(layer.children.map(kid => {
    const own = selfBox(kid)
    if (own) return own
    return kid.bounds ?? null
  }))
}

/** 用于「是不是空壳组合」 */
export function isBlankGroup(layer: SceneLayer): boolean {
  return isGroup(layer) && !(layer.draw ?? '').trim()
}

export function kindOf(layer: SceneLayer) {
  return layerKind(layer)
}

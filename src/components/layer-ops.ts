import type { Rect, Scene, SceneLayer } from '../shared/scene'
import { ancestorsOf, findLayer, unionBox } from '../shared/layers'
import { layerMatrix, worldBox, worldMatrix } from './stage-geometry'

/**
 * 画布上的批量几何操作：对齐 / 等间距 / 换父级保位。
 *
 * 为什么放在组件层：需要和画布命中、渲染共用同一套矩阵（stage-geometry），
 * 而 `src/shared` 会被 electron 主进程的类型检查包含（没有 DOM lib，用不了 DOMMatrix）。
 */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist'

export const ALIGN_LABEL: Record<AlignMode, string> = {
  left: '左对齐',
  hcenter: '水平居中',
  right: '右对齐',
  top: '顶对齐',
  vcenter: '垂直居中',
  bottom: '底对齐',
  hdist: '水平等距',
  vdist: '垂直等距'
}

export interface AlignPatch {
  id: string
  /** 父坐标系位移 */
  dx: number
  dy: number
}

interface Item {
  layer: SceneLayer
  ancestors: SceneLayer[]
  box: Rect
}

const r2 = (v: number) => Math.round(v * 100) / 100

/** 世界坐标位移 → 父坐标系位移（祖先矩阵的线性部分） */
export function toParentDelta(ancestors: SceneLayer[], dx: number, dy: number): { dx: number; dy: number } {
  if (!dx && !dy) return { dx: 0, dy: 0 }
  const m = new DOMMatrix()
  for (const a of ancestors) m.multiplySelf(layerMatrix(a))
  const inv = m.inverse()
  const origin = inv.transformPoint(new DOMPoint(0, 0))
  const moved = inv.transformPoint(new DOMPoint(dx, dy))
  return { dx: moved.x - origin.x, dy: moved.y - origin.y }
}

/**
 * 元素在画布上的盒子：typed 元素和「有自己盒子的组合」都能算。
 * 组合的 w/h 是成组时记下的并集盒子，所以也能参与对齐（否则多选里混一个组合就被忽略）。
 */
function boxOf(ancestors: SceneLayer[], layer: SceneLayer): Rect | null {
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (w <= 0 || h <= 0) return worldBox(ancestors, layer) ?? layer.bounds ?? null
  const m = worldMatrix(ancestors, layer)
  const pts = [
    m.transformPoint(new DOMPoint(0, 0)),
    m.transformPoint(new DOMPoint(w, 0)),
    m.transformPoint(new DOMPoint(w, h)),
    m.transformPoint(new DOMPoint(0, h))
  ]
  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 收集可对齐的元素 */
function collect(scene: Scene, ids: string[]): Item[] {
  const out: Item[] = []
  for (const id of ids) {
    const hit = findLayer(scene.layers, id)
    if (!hit) continue
    const ancestors = ancestorsOf(scene.layers, hit.path)
    const box = boxOf(ancestors, hit.layer)
    if (!box || box.w <= 0 || box.h <= 0) continue
    out.push({ layer: hit.layer, ancestors, box })
  }
  return out
}

export function computeAlign(scene: Scene, ids: string[], mode: AlignMode): AlignPatch[] {
  const items = collect(scene, ids)
  if (items.length < 2) return []
  const bounds = unionBox(items.map(i => i.box))
  if (!bounds) return []

  const world = new Map<string, { dx: number; dy: number }>()
  const push = (item: Item, dx: number, dy: number) => {
    if (!dx && !dy) return
    const prev = world.get(item.layer.id)
    world.set(item.layer.id, prev ? { dx: prev.dx + dx, dy: prev.dy + dy } : { dx, dy })
  }

  if (mode === 'left') items.forEach(i => push(i, bounds.x - i.box.x, 0))
  else if (mode === 'hcenter') items.forEach(i => push(i, bounds.x + bounds.w / 2 - (i.box.x + i.box.w / 2), 0))
  else if (mode === 'right') items.forEach(i => push(i, bounds.x + bounds.w - (i.box.x + i.box.w), 0))
  else if (mode === 'top') items.forEach(i => push(i, 0, bounds.y - i.box.y))
  else if (mode === 'vcenter') items.forEach(i => push(i, 0, bounds.y + bounds.h / 2 - (i.box.y + i.box.h / 2)))
  else if (mode === 'bottom') items.forEach(i => push(i, 0, bounds.y + bounds.h - (i.box.y + i.box.h)))
  else if (mode === 'hdist') {
    // 两端不动，中间按「间隙相等」重排
    const sorted = [...items].sort((a, b) => a.box.x - b.box.x)
    const span = sorted[sorted.length - 1].box.x + sorted[sorted.length - 1].box.w - sorted[0].box.x
    const sumW = sorted.reduce((n, i) => n + i.box.w, 0)
    const gap = (span - sumW) / (sorted.length - 1)
    let cursor = sorted[0].box.x + sorted[0].box.w + gap
    for (let i = 1; i < sorted.length - 1; i++) {
      push(sorted[i], cursor - sorted[i].box.x, 0)
      cursor += sorted[i].box.w + gap
    }
  } else if (mode === 'vdist') {
    const sorted = [...items].sort((a, b) => a.box.y - b.box.y)
    const span = sorted[sorted.length - 1].box.y + sorted[sorted.length - 1].box.h - sorted[0].box.y
    const sumH = sorted.reduce((n, i) => n + i.box.h, 0)
    const gap = (span - sumH) / (sorted.length - 1)
    let cursor = sorted[0].box.y + sorted[0].box.h + gap
    for (let i = 1; i < sorted.length - 1; i++) {
      push(sorted[i], 0, cursor - sorted[i].box.y)
      cursor += sorted[i].box.h + gap
    }
  }

  return items
    .map(item => {
      const d = world.get(item.layer.id) ?? { dx: 0, dy: 0 }
      const local = toParentDelta(item.ancestors, d.dx, d.dy)
      return { id: item.layer.id, dx: r2(local.dx), dy: r2(local.dy) }
    })
    .filter(p => p.dx !== 0 || p.dy !== 0)
}

export interface ReparentPatch {
  x: number
  y: number
  rotation: number
}

/**
 * 换父级后保持画面位置不变：把世界坐标折回新父级的局部坐标，
 * 同时把旋转值按祖先累计旋转差补偿（否则拖进旋转过的组合会歪）。
 */
export function computeReparent(scene: Scene, id: string, parentId: string | null): ReparentPatch | null {
  const hit = findLayer(scene.layers, id)
  if (!hit) return null
  const toParent = parentId ? findLayer(scene.layers, parentId) : null
  if (parentId && !toParent) return null
  const fromAnc = ancestorsOf(scene.layers, hit.path)
  const toAnc = toParent ? ancestorsOf(scene.layers, toParent.path) : []

  const fromM = new DOMMatrix()
  for (const a of fromAnc) fromM.multiplySelf(layerMatrix(a))
  const toM = new DOMMatrix()
  for (const a of toAnc) toM.multiplySelf(layerMatrix(a))
  if (toParent) toM.multiplySelf(layerMatrix(toParent.layer))

  const world = fromM.transformPoint(new DOMPoint(Number(hit.layer.x) || 0, Number(hit.layer.y) || 0))
  const local = toM.inverse().transformPoint(world)
  const fromRot = fromAnc.reduce((n, a) => n + (Number(a.rotation) || 0), 0)
  const toRot = toAnc.reduce((n, a) => n + (Number(a.rotation) || 0), 0) + (toParent ? Number(toParent.layer.rotation) || 0 : 0)
  return {
    x: r2(local.x),
    y: r2(local.y),
    rotation: r2((Number(hit.layer.rotation) || 0) + fromRot - toRot)
  }
}

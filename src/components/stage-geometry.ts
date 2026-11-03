import type { Rect, SceneLayer } from '../shared/scene'
import { hasOwnBox } from '../shared/scene'

/** 画布视口：zoom=1 表示整幅画面刚好放进窗口（letterbox） */
export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

export const FIT_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0 }

export interface ViewMath {
  scale: number
  dx: number
  dy: number
  dw: number
  dh: number
}

/** 显示矩形（CSS px）→ 画布在其中的位置与缩放 */
export function viewMath(rectW: number, rectH: number, W: number, H: number, view: ViewState): ViewMath {
  const base = Math.min(rectW / W, rectH / H)
  const scale = base * (view.zoom || 1)
  const dw = W * scale
  const dh = H * scale
  return {
    scale,
    dx: (rectW - dw) / 2 + (view.panX || 0),
    dy: (rectH - dh) / 2 + (view.panY || 0),
    dw,
    dh
  }
}

/** 屏幕坐标 → 设计坐标（超出画布返回 null） */
export function screenToDesign(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  W: number,
  H: number,
  view: ViewState,
  clampOutside = false
): { x: number; y: number } | null {
  const m = viewMath(rect.width, rect.height, W, H, view)
  const x = (clientX - rect.left - m.dx) / m.scale
  const y = (clientY - rect.top - m.dy) / m.scale
  if (!clampOutside && (x < 0 || y < 0 || x > W || y > H)) return null
  return { x, y }
}

/** 设计坐标 → 显示矩形内的 CSS 像素 */
export function designToScreen(x: number, y: number, rect: DOMRect, W: number, H: number, view: ViewState): { x: number; y: number } {
  const m = viewMath(rect.width, rect.height, W, H, view)
  return { x: m.dx + x * m.scale, y: m.dy + y * m.scale }
}

/**
 * 单个图层的局部变换矩阵（与 render.ts 的 applyTransform 保持一致）。
 * 局部坐标系：typed 元素左上角为 (0,0)；code 图层原点为画布原点。
 */
export function layerMatrix(layer: SceneLayer): DOMMatrix {
  const m = new DOMMatrix()
  const x = Number(layer.x) || 0
  const y = Number(layer.y) || 0
  const rotation = Number(layer.rotation) || 0
  const scale = layer.scale === undefined ? 1 : Number(layer.scale) || 1
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
  if (hasOwnBox(layer)) {
    m.translateSelf(x + w / 2, y + h / 2)
    if (rotation) m.rotateSelf(rotation)
    if (scale !== 1) m.scaleSelf(scale, scale)
    m.translateSelf(-w / 2, -h / 2)
  } else {
    m.translateSelf(x, y)
    if (rotation || scale !== 1) {
      m.translateSelf(w / 2, h / 2)
      if (rotation) m.rotateSelf(rotation)
      if (scale !== 1) m.scaleSelf(scale, scale)
      m.translateSelf(-w / 2, -h / 2)
    }
  }
  return m
}

/** 从根到该图层的累计矩阵（ancestors 不含自身） */
export function worldMatrix(ancestors: SceneLayer[], layer: SceneLayer): DOMMatrix {
  const m = new DOMMatrix()
  for (const a of ancestors) m.multiplySelf(layerMatrix(a))
  m.multiplySelf(layerMatrix(layer))
  return m
}

/** 世界坐标 → 该图层局部坐标 */
export function worldToLocal(ancestors: SceneLayer[], layer: SceneLayer, p: { x: number; y: number }): { x: number; y: number } {
  const inv = worldMatrix(ancestors, layer).inverse()
  const pt = inv.transformPoint(new DOMPoint(p.x, p.y))
  return { x: pt.x, y: pt.y }
}

/** typed 元素在画布上的包围盒（考虑祖先与自身变换） */
export function worldBox(ancestors: SceneLayer[], layer: SceneLayer): Rect | null {
  if (!hasOwnBox(layer)) return null
  const m = worldMatrix(ancestors, layer)
  const w = Number(layer.w) || 0
  const h = Number(layer.h) || 0
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

/** 点是否落在 typed 元素里（考虑旋转，按局部矩形判定） */
export function pointInTyped(ancestors: SceneLayer[], layer: SceneLayer, p: { x: number; y: number }): boolean {
  if (!hasOwnBox(layer)) return false
  const local = worldToLocal(ancestors, layer, p)
  return local.x >= 0 && local.y >= 0 && local.x <= (layer.w ?? 0) && local.y <= (layer.h ?? 0)
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

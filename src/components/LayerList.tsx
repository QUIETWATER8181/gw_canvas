import { useEffect, useMemo, useState } from 'react'
import type { SceneLayer } from '../shared/scene'
import { KIND_LABEL, layerKind } from '../shared/scene'
import { useEditor, newLayerId } from '../state/editor'
import { flatten } from '../shared/layers'
import { SceneRenderer } from '../engine/preview'

interface Row {
  layer: SceneLayer
  path: string[]
  parentPath: string[]
  index: number
  depth: number
  hasChildren: boolean
}

export function LayerList() {
  const editor = useEditor()
  const { scene, selection } = editor.state
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [overPath, setOverPath] = useState<string | null>(null)

  const renderer = useMemo(() => new SceneRenderer(scene.canvas.width, scene.canvas.height), [scene.canvas.width, scene.canvas.height])

  /** 顶层在上：先深度优先展开，再按「同层倒序」排，保证上层覆盖下层 */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const walk = (layers: SceneLayer[], parentPath: string[], depth: number) => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i]
        const path = [...parentPath, layer.id]
        out.push({ layer, path, parentPath, index: i, depth, hasChildren: Boolean(layer.children?.length) })
        if (layer.children?.length && !collapsed.has(layer.id)) walk(layer.children, path, depth + 1)
      }
    }
    walk(scene.layers, [], 0)
    return out
  }, [scene.layers, collapsed])

  const thumbs = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) {
      try { map.set(r.layer.id, renderer.layerThumb(scene, r.layer, editor.state.time)) } catch { /* ignore */ }
    }
    return map
  }, [rows, scene, renderer, editor.state.time])

  // 从时间轴/画布选中时，把图层树里对应的行滚到可见处
  useEffect(() => {
    const id = selection[selection.length - 1]
    if (!id) return
    const el = document.querySelector(`.ll-item[data-id="${CSS.escape(id)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  function addLayer() {
    const id = newLayerId(scene)
    editor.addLayer({
      id,
      name: `图层 ${scene.layers.length + 1}`,
      draw: `// ${id}\n// 可用变量：ctx, t, p, duration, width, height, cx, cy, theme, ease, util, g, asset\n// 例：g.circle(cx, cy, 80, { fill: theme.accent })\n`,
      opacity: 1
    })
  }

  return (
    <div className="layer-list">
      <div className="ll-head">
        <span>图层（上层覆盖下层）</span>
        <button className="btn sm" onClick={addLayer}>＋ 新图层</button>
      </div>
      <div className="ll-scroll">
        {rows.map(row => {
          const layer = row.layer
          const sel = selection.includes(layer.id)
          const kind = layerKind(layer)
          return (
            <div
              key={layer.id}
              className={`ll-item ${sel ? 'sel' : ''} ${overPath === row.path.join('/') ? 'over' : ''}`}
              data-id={layer.id}
              style={{ paddingLeft: `${6 + row.depth * 14}px` }}
              draggable
              onDragStart={e => { setDragPath(row.path.join('/')); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => { e.preventDefault(); setOverPath(row.path.join('/')) }}
              onDragLeave={() => setOverPath(p => (p === row.path.join('/') ? null : p))}
              onDragEnd={() => { setDragPath(null); setOverPath(null) }}
              onDrop={e => {
                e.preventDefault()
                if (!dragPath) return
                const from = dragPath.split('/')
                const fromId = from[from.length - 1]
                if (fromId === layer.id) { setDragPath(null); setOverPath(null); return }
                // 拖到组合行上 = 变成它的子元素（坐标会换算，画面不跳）；否则插到目标的同级
                if (row.hasChildren) {
                  editor.moveTo(fromId, layer.id, (layer.children ?? []).length)
                } else {
                  editor.moveTo(fromId, row.parentPath.length ? row.parentPath[row.parentPath.length - 1] : null, row.index + 1)
                }
                setDragPath(null); setOverPath(null)
              }}
              onClick={e => {
                if (e.ctrlKey || e.metaKey) editor.toggleSelect(layer.id)
                else editor.select(layer.id)
              }}
            >
              {row.hasChildren ? (
                <button
                  className={`ll-chev ${collapsed.has(layer.id) ? 'closed' : ''}`}
                  onClick={e => {
                    e.stopPropagation()
                    setCollapsed(prev => {
                      const next = new Set(prev)
                      if (next.has(layer.id)) next.delete(layer.id)
                      else next.add(layer.id)
                      return next
                    })
                  }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l8 7-8 7z" /></svg>
                </button>
              ) : <span className="ll-chev-space" />}
              <div className="ll-thumb">
                {thumbs.get(layer.id) ? <img src={thumbs.get(layer.id)} alt="" /> : <span className="ll-thumb-empty" />}
              </div>
              <div className="ll-meta">
                <div className="ll-name">
                  <span className="kind-pill tiny-pill">{KIND_LABEL[kind]}</span>
                  {layer.name}
                </div>
                <div className="ll-sub mono">
                  {layer.start !== undefined || layer.end !== undefined
                    ? `${(layer.start ?? 0).toFixed(1)}–${(layer.end ?? scene.canvas.duration).toFixed(1)}s`
                    : '整段'}
                  {layer.opacity !== undefined && layer.opacity !== 1 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
                  {layer.children?.length ? ` · ${layer.children.length} 元素` : ''}
                </div>
              </div>
              <button
                className={`ll-eye ${layer.visible === false ? 'off' : ''}`}
                title={layer.visible === false ? '显示' : '隐藏'}
                onClick={e => { e.stopPropagation(); editor.updateLayer(layer.id, { visible: layer.visible === false }, { label: '切换可见' }) }}
              >
                {layer.visible === false ? '◌' : '◉'}
              </button>
              <button
                className="ll-del"
                title="删除图层"
                onClick={e => { e.stopPropagation(); editor.removeLayer(layer.id) }}
              >
                ×
              </button>
            </div>
          )
        })}
        {scene.layers.length === 0 && <div className="ll-empty">还没有图层。点「新图层」或让 AI 生成。</div>}
      </div>
    </div>
  )
}

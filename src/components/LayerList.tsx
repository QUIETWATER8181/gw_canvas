import { useMemo, useState } from 'react'
import { useEditor, newLayerId } from '../state/editor'
import { SceneRenderer } from '../engine/preview'

export function LayerList() {
  const editor = useEditor()
  const { scene, selectedLayerId } = editor.state
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  const renderer = useMemo(() => new SceneRenderer(scene.canvas.width, scene.canvas.height), [scene.canvas.width, scene.canvas.height])
  const thumbs = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of scene.layers) {
      try { map.set(l.id, renderer.layerThumb(scene, l, editor.state.time)) } catch { /* ignore */ }
    }
    return map
  }, [scene, renderer, editor.state.time])

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
        {[...scene.layers].reverse().map((layer, revIdx) => {
          const idx = scene.layers.length - 1 - revIdx
          const sel = layer.id === selectedLayerId
          return (
            <div
              key={layer.id}
              className={`ll-item ${sel ? 'sel' : ''} ${overIdx === idx ? 'over' : ''}`}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={e => { e.preventDefault(); setOverIdx(idx) }}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null) }}
              onDrop={() => {
                if (dragIdx !== null && dragIdx !== idx) editor.reorderLayer(dragIdx, idx)
                setDragIdx(null); setOverIdx(null)
              }}
              onClick={() => editor.select(layer.id)}
            >
              <div className="ll-thumb">
                {thumbs.get(layer.id) ? <img src={thumbs.get(layer.id)} alt="" /> : <span className="ll-thumb-empty" />}
              </div>
              <div className="ll-meta">
                <div className="ll-name">{layer.name}</div>
                <div className="ll-sub mono">
                  {layer.start !== undefined || layer.end !== undefined
                    ? `${(layer.start ?? 0).toFixed(1)}–${(layer.end ?? scene.canvas.duration).toFixed(1)}s`
                    : '整段'}
                  {layer.opacity !== undefined && layer.opacity !== 1 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
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

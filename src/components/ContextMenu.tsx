import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** 分隔线（label 忽略） */
  separator?: boolean
  onClick?(): void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}

/** 通用右键菜单：定位在鼠标处，自动避开窗口边缘，点空白/按 Esc 关闭 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - r.width - 8)
    const ny = Math.min(y, window.innerHeight - r.height - 8)
    setPos({ x: Math.max(6, nx), y: Math.max(6, ny) })
  }, [x, y, items.length])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {items.map(item => item.separator ? (
        <div key={item.id} className="ctx-sep" />
      ) : (
        <button
          key={item.id}
          className={`ctx-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          onClick={() => { onClose(); item.onClick?.() }}
        >
          <span>{item.label}</span>
          {item.hint && <kbd>{item.hint}</kbd>}
        </button>
      ))}
    </div>
  )
}

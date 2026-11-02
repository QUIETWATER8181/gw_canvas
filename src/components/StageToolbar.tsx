import { useEditor } from '../state/editor'

interface Props {
  onToast(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
  showBounds: boolean
  onToggleBounds(): void
  zoom: 'fit' | number
  onZoom(z: 'fit' | number): void
  exportJob: { running: boolean; frame: number; total: number; phase: string } | null
}

export function StageToolbar({ showBounds, onToggleBounds, zoom, onZoom, exportJob }: Props) {
  const editor = useEditor()
  const { scene, saving, dirty } = editor.state
  return (
    <div className="stage-toolbar">
      <div className="st-title">
        <input
          className="st-title-input"
          value={scene.meta.title}
          onChange={e => editor.updateScene(s => ({ ...s, meta: { ...s.meta, title: e.target.value } }), { label: '改标题' })}
          spellCheck={false}
        />
        <span className={`st-save ${dirty ? 'dirty' : ''}`}>{saving ? '保存中…' : dirty ? '未保存' : '已保存'}</span>
      </div>
      <div className="spacer" />
      {exportJob?.running && (
        <div className="st-exporting">
          <span className="spin-dot" />
          {exportJob.phase === 'render' ? `渲染 ${exportJob.frame}/${exportJob.total}` : exportJob.phase === 'encode' ? '编码中' : exportJob.phase === 'mux' ? '封装中' : '准备中'}
        </div>
      )}
      <div className="st-tools">
        <button className={`tb-chip ${showBounds ? 'on' : ''}`} onClick={onToggleBounds} title="显示选中图层的边界">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
          边界
        </button>
        <div className="zoom-group">
          <button className={`tb-chip ${zoom === 'fit' ? 'on' : ''}`} onClick={() => onZoom('fit')}>适应</button>
          <button className={`tb-chip ${zoom === 1 ? 'on' : ''}`} onClick={() => onZoom(1)}>100%</button>
        </div>
      </div>
    </div>
  )
}

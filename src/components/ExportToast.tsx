interface Props {
  job: { running: boolean; frame: number; total: number; phase: string }
}

const LABEL: Record<string, string> = {
  prepare: '准备导出',
  render: '渲染帧',
  encode: '编码',
  mux: '封装 MP4',
  done: '完成',
  error: '出错'
}

export function ExportToast({ job }: Props) {
  const pct = job.total > 0 ? Math.round((job.frame / job.total) * 100) : 0
  return (
    <div className="export-toast">
      <div className="et-head">
        <span className="spin-dot" />
        <span>{LABEL[job.phase] ?? job.phase}</span>
        <span className="spacer" />
        <span className="mono tiny">{job.total > 0 ? `${job.frame}/${job.total}` : ''}</span>
      </div>
      <div className="et-bar">
        <div className="et-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

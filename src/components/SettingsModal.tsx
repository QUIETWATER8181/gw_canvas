import { useEffect, useState } from 'react'
import type { AppState, ExportSettings, ModelConnection, ProviderKind } from '../shared/ipc'

interface Props {
  open: boolean
  state: AppState
  onClose(): void
  onChanged(next: AppState): void
  onToast?(t: { text: string; kind: 'ok' | 'err' | 'info' }): void
}

const PRESETS: { label: string; kind: ProviderKind; baseUrl: string; model: string }[] = [
  { label: 'DeepSeek 官方', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'DeepSeek 推理', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner' },
  { label: 'GPT-4o（能看图）', kind: 'openai-compatible', baseUrl: '', model: 'gpt-4o' },
  { label: 'Qwen-VL（能看图）', kind: 'openai-compatible', baseUrl: '', model: 'qwen-vl-max' },
  { label: '同济网关', kind: 'openai-compatible', baseUrl: '', model: '' },
  { label: '中转站 / 其他', kind: 'openai-compatible', baseUrl: '', model: '' }
]

export function SettingsModal({ open, state, onClose, onChanged, onToast }: Props) {
  const [section, setSection] = useState<'model' | 'export'>('model')
  const [editing, setEditing] = useState<ModelConnection | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ProviderKind>('deepseek')
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [model, setModel] = useState('deepseek-chat')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [exportSettings, setExportSettings] = useState<ExportSettings | null>(null)

  useEffect(() => {
    if (!open) return
    const c = editing ?? state.connections.find(x => x.id === state.activeConnectionId) ?? null
    if (c) {
      setEditing(c)
      setName(c.name); setKind(c.kind); setBaseUrl(c.baseUrl); setModel(c.model)
      setApiKey('')
      setModels(c.models ?? [])
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || section !== 'export') return
    let alive = true
    void window.gewu.getExportSettings().then(s => { if (alive) setExportSettings(s) }).catch(() => undefined)
    return () => { alive = false }
  }, [open, section])

  if (!open) return null

  function newConnection() {
    setEditing(null)
    setName(''); setKind('deepseek'); setBaseUrl('https://api.deepseek.com'); setModel('deepseek-chat')
    setApiKey(''); setModels([]); setTestResult(null)
  }

  function applyPreset(p: typeof PRESETS[number]) {
    setKind(p.kind)
    if (p.baseUrl) setBaseUrl(p.baseUrl)
    if (p.model) setModel(p.model)
    if (!name) setName(p.label)
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.gewu.testConnection({ baseUrl, model, apiKey: apiKey || undefined, id: editing?.id })
      setTestResult({ ok: r.ok, detail: r.detail })
      if (r.models?.length) setModels(r.models)
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      setTestResult({ ok: false, detail: '名称、接口地址、模型名都要填' })
      return
    }
    setSaving(true)
    try {
      const next = await window.gewu.saveConnection({
        id: editing?.id, name: name.trim(), kind, baseUrl: baseUrl.trim(), model: model.trim(),
        apiKey: apiKey.trim() || undefined
      })
      onChanged(next)
      onClose()
    } catch (e) {
      setTestResult({ ok: false, detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: ModelConnection) {
    const next = await window.gewu.deleteConnection(c.id)
    onChanged(next)
    if (editing?.id === c.id) newConnection()
  }

  async function pickVision(id: string) {
    const next = await window.gewu.setVisionConnection(id || null)
    onChanged(next)
  }

  async function patchExport(patch: Partial<Pick<ExportSettings, 'dir' | 'askEveryTime' | 'revealAfterExport'>>) {
    try {
      const next = await window.gewu.setExportSettings(patch)
      setExportSettings(next)
      onToast?.({ text: '导出设置已保存', kind: 'ok' })
    } catch (e) {
      onToast?.({ text: e instanceof Error ? e.message : String(e), kind: 'err' })
    }
  }

  async function pickExportDir() {
    try {
      const r = await window.gewu.chooseExportFolder({ defaultPath: exportSettings?.resolvedDir })
      if (r.ok && r.dir) await patchExport({ dir: r.dir })
    } catch (e) {
      onToast?.({ text: e instanceof Error ? e.message : String(e), kind: 'err' })
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>{section === 'model' ? '模型连接' : '导出与保存'}</h2>
            <p className="tiny muted">
              {section === 'model'
                ? '密钥用系统安全存储加密，只留在本机。agent 通过本机代理调用，不会泄露给运行时。'
                : '视频想放哪就放哪：这里定默认目录，导出时还能临时改。'}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          <button className={section === 'model' ? 'on' : ''} onClick={() => setSection('model')}>模型连接</button>
          <button className={section === 'export' ? 'on' : ''} onClick={() => setSection('export')}>导出与保存</button>
        </div>

        {section === 'export' ? (
          <div className="xset">
            <div className="field">
              <label>默认导出位置</label>
              <div className="xdlg-path">
                <span className="mono" title={exportSettings?.dir ?? exportSettings?.resolvedDir}>
                  {exportSettings?.dir ?? exportSettings?.resolvedDir ?? '读取中…'}
                </span>
                <button className="btn sm" onClick={() => void pickExportDir()}>选择文件夹…</button>
                {exportSettings?.dir && (
                  <button className="link" onClick={() => void patchExport({ dir: null })}>恢复默认</button>
                )}
              </div>
              <span className="hint">
                固定后：导出对话框默认填这里，agent 自己导出的成片也放这里。
                没固定时按「最近一次用过的目录 → 系统视频文件夹」走。
              </span>
            </div>

            <label className="xdlg-check">
              <input
                type="checkbox"
                checked={exportSettings?.askEveryTime ?? true}
                onChange={e => void patchExport({ askEveryTime: e.target.checked })}
              />
              <span>每次导出都弹位置选择（关掉就一直用上面的目录）</span>
            </label>

            <label className="xdlg-check">
              <input
                type="checkbox"
                checked={exportSettings?.revealAfterExport ?? true}
                onChange={e => void patchExport({ revealAfterExport: e.target.checked })}
              />
              <span>导出完成后在文件夹中显示</span>
            </label>

            <div className="field">
              <label>最近用过的目录</label>
              {exportSettings?.recentDirs.length
                ? (
                  <div className="xdlg-recent">
                    {exportSettings.recentDirs.map(d => (
                      <button key={d} className="xdlg-chip" title={d} onClick={() => void patchExport({ dir: d })}>
                        {d}
                      </button>
                    ))}
                  </div>
                )
                : <span className="hint">还没有导出过。第一次导出时选的目录会记在这里。</span>}
              <div className="row">
                <button className="link" onClick={() => void window.gewu.openFolder(exportSettings?.resolvedDir ?? '')} disabled={!exportSettings}>
                  打开当前导出目录
                </button>
                <button className="link" onClick={() => void window.gewu.openFolder(state.workspace)}>打开当前草稿目录</button>
              </div>
            </div>

            <div className="xset-note">
              草稿本身存在 <code className="mono">{state.workspace.replace(/[\\/][^\\/]+$/, '')}</code>，
              每个草稿一个文件夹，含 <code>scene.json</code>、<code>assets/</code>、<code>exports/</code> 和对话记录。
              删除的草稿会挪进 <code>trash/</code>。
            </div>
          </div>
        ) : (
        <div className="modal-body">
          <div className="conn-list">
            <div className="conn-list-head">
              <span>已保存</span>
              <button className="btn sm" onClick={newConnection}>＋ 新增</button>
            </div>
            {state.connections.map(c => (
              <div key={c.id} className={`conn-item ${editing?.id === c.id ? 'sel' : ''}`} onClick={() => {
                setEditing(c); setName(c.name); setKind(c.kind); setBaseUrl(c.baseUrl); setModel(c.model); setApiKey(''); setTestResult(null)
              }}>
                <div className="conn-main">
                  <div className="conn-name">
                    {c.name}
                    {state.activeConnectionId === c.id && <span className="badge accent">使用中</span>}
                  </div>
                  <div className="conn-sub mono">{c.model} · {c.baseUrl}</div>
                </div>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); void remove(c) }}>×</button>
              </div>
            ))}
            {state.connections.length === 0 && <div className="conn-empty">还没有连接。填下面的表单保存一个。</div>}
          </div>

          <div className="conn-form">
            <div className="vision-pick">
              <div className="conn-list-head">
                <span>视觉模型（agent 用它「看图」）</span>
              </div>
              <select
                className="select vision-select"
                value={state.visionConnectionId ?? ''}
                onChange={e => void pickVision(e.target.value)}
              >
                <option value="">跟随当前对话连接</option>
                {state.connections.map(c => (
                  <option key={c.id} value={c.id}>{c.name} · {c.model}</option>
                ))}
              </select>
              <span className="hint">
                主模型不能看图也没关系：这里指一个多模态接口（gpt-4o / qwen-vl-max / glm-4v），
                agent 就能用 <code>image_describe</code> 看懂参考图和自己的渲染结果。
                不填就一直跟随上面的「使用中」连接。
              </span>
            </div>

            <div className="preset-row">
              {PRESETS.map(p => (
                <button key={p.label} className="tb-chip" onClick={() => applyPreset(p)}>{p.label}</button>
              ))}
            </div>

            <div className="insp-row">
              <div className="field">
                <label>连接名称</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="例如：DeepSeek 主模型" />
              </div>
              <div className="field">
                <label>接口类型</label>
                <select className="select" value={kind} onChange={e => setKind(e.target.value as ProviderKind)}>
                  <option value="deepseek">DeepSeek 原生</option>
                  <option value="openai-compatible">OpenAI 兼容</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>接口地址</label>
              <input className="input mono" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com 或 https://xxx/v1" />
              <span className="hint">会自动补 /v1/chat/completions；如果填的是完整地址则原样使用。</span>
            </div>

            <div className="insp-row">
              <div className="field">
                <label>模型名</label>
                <input className="input mono" value={model} onChange={e => setModel(e.target.value)} placeholder="deepseek-chat" list="model-options" />
                <datalist id="model-options">
                  {models.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div className="field">
                <label>API Key {editing?.hasKey && <span className="badge green">已保存</span>}</label>
                <input
                  className="input mono" type="password" value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={editing?.hasKey ? '留空则保持不变' : 'sk-...'}
                />
              </div>
            </div>

            {testResult && (
              <div className={`test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.detail}</div>
            )}

            <div className="conn-actions">
              <button className="btn" onClick={() => void test()} disabled={testing || !baseUrl || !model}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <div className="spacer" />
              <button className="btn primary" onClick={() => void save()} disabled={saving}>
                {saving ? '保存中…' : '保存并启用'}
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

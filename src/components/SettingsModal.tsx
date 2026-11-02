import { useEffect, useState } from 'react'
import type { AppState, ModelConnection, ProviderKind } from '../shared/ipc'

interface Props {
  open: boolean
  state: AppState
  onClose(): void
  onChanged(next: AppState): void
}

const PRESETS: { label: string; kind: ProviderKind; baseUrl: string; model: string }[] = [
  { label: 'DeepSeek 官方', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { label: 'DeepSeek 推理', kind: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner' },
  { label: '同济网关', kind: 'openai-compatible', baseUrl: '', model: '' },
  { label: '中转站 / 其他', kind: 'openai-compatible', baseUrl: '', model: '' }
]

export function SettingsModal({ open, state, onClose, onChanged }: Props) {
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

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h2>模型连接</h2>
            <p className="tiny muted">密钥用系统安全存储加密，只留在本机。agent 通过本机代理调用，不会泄露给运行时。</p>
          </div>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

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
      </div>
    </div>
  )
}

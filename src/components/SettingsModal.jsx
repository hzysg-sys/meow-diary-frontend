import { useEffect, useState } from 'react'
import { CloseIcon } from './icons'
import { fetchSettings, updateSettings } from '../api'

const MODEL_OPTIONS = [
  { label: 'o46', value: 'claude-opus-4-6-thinking' },
  { label: 's46', value: 'claude-sonnet-4-6-thinking' },
  { label: 'o45', value: 'claude-opus-4-5-20251101-thinking' },
  { label: 's45', value: 'claude-sonnet-4-5-20250929-thinking' },
  { label: 'fable5', value: 'claude-fable-5' },
]

const THINKING_OPTIONS = [
  { label: '关闭', value: 'off' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

const DEFAULT_SETTINGS = {
  systemPrompt: '',
  temperature: 0.7,
  contextTurns: 20,
  maxTokens: 800,
  modelName: MODEL_OPTIONS[0].value,
  reasoningEffort: 'off',
}

export default function SettingsModal({ open, onClose }) {
  const [form, setForm] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setErrorMsg(null)
    setStatusMsg(null)
    fetchSettings()
      .then((data) => {
        if (cancelled) return
        const matched = MODEL_OPTIONS.some((o) => o.value === data.modelName)
        const validEffort = THINKING_OPTIONS.some((o) => o.value === data.reasoningEffort)
        setForm({
          ...data,
          modelName: matched ? data.modelName : MODEL_OPTIONS[0].value,
          reasoningEffort: validEffort ? data.reasoningEffort : 'off',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMsg(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  async function handleSave() {
    setSaving(true)
    setErrorMsg(null)
    setStatusMsg(null)
    try {
      const saved = await updateSettings(form)
      setForm(saved)
      setStatusMsg('已保存')
      setTimeout(() => {
        onClose()
      }, 500)
    } catch (err) {
      setErrorMsg(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="settings-modal" className={open ? 'show' : ''} onClick={handleOverlayClick}>
      <div className="modal-card">
        <div className="modal-header">
          <h2>设置</h2>
          <button onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {loading && <p style={{ textAlign: 'center', fontSize: 13, color: '#a8a29e' }}>正在加载设置...</p>}
        <div className="field">
          <label>模型</label>
          <select
            value={form.modelName}
            onChange={(e) => setForm({ ...form, modelName: e.target.value })}
          >
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>思考深度</label>
          <select
            value={form.reasoningEffort}
            onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}
          >
            {THINKING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>人设 / 系统提示词</label>
          <textarea
            rows={4}
            placeholder="描述一下你想要的 AI 是什么样的性格..."
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          />
        </div>
        <div className="field">
          <label>回复风格（temperature）</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={form.temperature}
            onChange={(e) => setForm({ ...form, temperature: parseFloat(e.target.value) })}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>上下文保留轮数</label>
            <input
              type="number"
              value={form.contextTurns}
              onChange={(e) => setForm({ ...form, contextTurns: e.target.value })}
            />
          </div>
          <div className="field">
            <label>最大回复长度</label>
            <input
              type="number"
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
            />
          </div>
        </div>
        {errorMsg && <p style={{ textAlign: 'center', fontSize: 13, color: '#c98a98' }}>{errorMsg}</p>}
        {statusMsg && <p style={{ textAlign: 'center', fontSize: 13, color: '#78716c' }}>{statusMsg}</p>}
        <button className="save-btn" onClick={handleSave} disabled={saving || loading}>
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}

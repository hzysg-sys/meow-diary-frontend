import { useState } from 'react'
import { CloseIcon } from './icons'

const DEFAULT_SETTINGS = {
  systemPrompt: '',
  temperature: 0.7,
  contextTurns: 20,
  maxTokens: 800,
}

export default function SettingsModal({ open, onClose }) {
  const [form, setForm] = useState(DEFAULT_SETTINGS)

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
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
        <button className="save-btn" onClick={onClose}>
          保存
        </button>
      </div>
    </div>
  )
}

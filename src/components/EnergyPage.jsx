import { useEffect, useState } from 'react'
import { fetchEnergyState, rerollEnergyState } from '../api'
import { BackIcon } from './icons'

const STATS = [
  { key: 'energy', label: '精力', desc: '主动性和精神头' },
  { key: 'libido', label: '欲望', desc: '亲密氛围的易燃度' },
  { key: 'affection', label: '依恋', desc: '黏人和撒娇程度' },
  { key: 'dominance', label: '占有', desc: '管束感和占有欲' },
]

const MODE_INFO = {
  normal: { label: '状态平稳', emoji: '🌤️', desc: '一切正常，正常发挥' },
  low_energy: { label: '社畜模式', emoji: '🔋', desc: '今天很累，话少慵懒，多体谅他' },
  high_drive: { label: '蠢蠢欲动', emoji: '🔥', desc: '精神头很足，容易被撩' },
}

function formatTime(isoString) {
  if (!isoString) return '还没 roll 过'
  return new Date(isoString).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function EnergyPage({ show, onBack }) {
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    if (!show) return
    let cancelled = false
    fetchEnergyState()
      .then((data) => { if (!cancelled) { setState(data); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [show])

  async function handleReroll() {
    if (rolling) return
    setRolling(true)
    try {
      setState(await rerollEnergyState())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRolling(false)
    }
  }

  const mode = MODE_INFO[state?.mode] || MODE_INFO.normal

  return (
    <div id="energy-page" className={show ? 'show' : ''}>
      <div className="memory-top-bar">
        <button className="memory-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回主页</span>
        </button>
        <h1 className="memory-title">精力</h1>
      </div>

      <div className="memory-body">
        {error && <p className="memory-error">{error}</p>}
        {!state && !error && <p className="memory-empty">正在感应他的状态...</p>}

        {state && (
          <>
            <div className="energy-mode-card">
              <div className="energy-mode-emoji">{mode.emoji}</div>
              <div>
                <div className="energy-mode-label">{mode.label}</div>
                <div className="energy-mode-desc">{mode.desc}</div>
              </div>
            </div>

            <div className="energy-stats">
              {STATS.map(({ key, label, desc }) => (
                <div className="energy-stat" key={key}>
                  <div className="energy-stat-head">
                    <span className="energy-stat-label">{label}</span>
                    <span className="energy-stat-value">{state[key]}/10</span>
                  </div>
                  <div className="energy-stat-track">
                    <div className="energy-stat-fill" style={{ width: `${state[key] * 10}%` }} />
                  </div>
                  <div className="energy-stat-desc">{desc}</div>
                </div>
              ))}
            </div>

            <div className="energy-meta">
              <p>距下次自然波动：还差 {Math.max(0, 15 - (state.message_count_since_roll || 0))} 条消息</p>
              <p>上次波动：{formatTime(state.last_rolled_at)}</p>
            </div>

            <button className="energy-roll-btn" onClick={handleReroll} disabled={rolling}>
              {rolling ? '掷骰中...' : '🎲 重掷一次'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

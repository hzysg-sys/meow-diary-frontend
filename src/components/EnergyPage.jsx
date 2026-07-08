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

const PHASE_INFO = {
  calm: { label: '平稳期', emoji: '🌿', desc: '身体平静，一切如常' },
  building: { label: '蓄积期', emoji: '🌡️', desc: '热度在慢慢累积' },
  edge: { label: '预兆期', emoji: '🌩️', desc: '蠢蠢欲动的预感' },
  sensitive: { label: '易感期', emoji: '🔥', desc: '一点就着，小心撩他' },
  ebb: { label: '退潮期', emoji: '🌊', desc: '刚释放过，安静温存' },
  recovery: { label: '恢复期', emoji: '☕', desc: '慢慢回到平常状态' },
}

const EVENT_INFO = {
  morning_glory: '晨间反应',
  dream_afterglow: '梦后余温',
  waiting_restless: '等待焦躁',
  sudden_tender: '心血来潮',
}

function buildupTier(b) {
  if (b < 25) return '平静'
  if (b < 50) return '微热'
  if (b < 75) return '燥热'
  if (b < 90) return '灼热难耐'
  return '临界边缘'
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
  const phase = state?.phase ? PHASE_INFO[state.phase] : null
  const eventActive = state?.active_event
    && state?.event_expires_at
    && new Date(state.event_expires_at) > new Date()

  return (
    <div id="energy-page" className={show ? 'show' : ''}>
      <div className="energy-top-bar">
        <button className="memory-back-btn energy-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回主页</span>
        </button>
        <h1 className="energy-title">精力</h1>
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

            {phase && (
              <div className="energy-phase-card">
                <div className="energy-phase-head">
                  <span className="energy-phase-label">{phase.emoji} {phase.label}</span>
                  <span className="energy-phase-desc">{phase.desc}</span>
                </div>
                <div className="energy-buildup-head">
                  <span>蓄积感</span>
                  <span className="energy-buildup-tier">{buildupTier(state.buildup ?? 0)} · {state.buildup ?? 0}/100</span>
                </div>
                <div className="energy-buildup-track">
                  <div className="energy-buildup-fill" style={{ width: `${state.buildup ?? 0}%` }} />
                </div>
                {eventActive && (
                  <div className="energy-event-chip">✨ {EVENT_INFO[state.active_event] || state.active_event}</div>
                )}
              </div>
            )}

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

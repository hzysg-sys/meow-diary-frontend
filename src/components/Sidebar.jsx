import { useEffect, useState } from 'react'
import { fetchSessions, createSession, deleteSession } from '../api'
import { CloseIcon, PlusIcon, TrashIcon, SettingsIcon } from './icons'

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatFriendlyTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const now = new Date()
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000)

  if (diffDays <= 0) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (diffDays === 1) return '昨天'
  return `${diffDays}天前`
}

export default function Sidebar({ open, currentSessionId, onSessionChange, onClose, onOpenSettings }) {
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchSessions()
      .then((data) => {
        if (!cancelled) setSessions(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleNewChat() {
    try {
      const session = await createSession()
      onSessionChange(session.id)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  function handleSelect(id) {
    onSessionChange(id)
    onClose()
  }

  async function handleDelete(id) {
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)

    try {
      await deleteSession(id)
    } catch (err) {
      setError(err.message)
      return
    }

    if (id !== currentSessionId) return

    if (remaining.length > 0) {
      onSessionChange(remaining[0].id)
      return
    }

    try {
      const session = await createSession()
      setSessions([session])
      onSessionChange(session.id)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div id="sidebar" className={open ? 'open' : ''}>
      <div className="sidebar-header">
        <span>Meow Diary</span>
        <button onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <button className="new-chat-btn" onClick={handleNewChat}>
        <PlusIcon />
        新建对话
      </button>
      <div id="session-list">
        {error && <div className="session-list-error">{error}</div>}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === currentSessionId ? 'active' : ''}`}
            onClick={() => handleSelect(s.id)}
          >
            <div style={{ minWidth: 0 }}>
              <div className="session-name">{s.name}</div>
              <div className="session-time">{formatFriendlyTime(s.updated_at)}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleDelete(s.id)
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onOpenSettings}>
          <SettingsIcon />
          设置
        </button>
      </div>
    </div>
  )
}

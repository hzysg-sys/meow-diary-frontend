import { useEffect, useState } from 'react'
import { fetchSessions, createSession, deleteSession } from '../api'
import { BackIcon, PlusIcon, TrashIcon } from './icons'

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatDateTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SessionListPage({ onSelectSession, onBack }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchSessions()
      .then((data) => {
        if (!cancelled) setSessions(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate() {
    try {
      const session = await createSession()
      onSelectSession(session.id)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    const prev = sessions
    setSessions((cur) => cur.filter((s) => s.id !== id))
    try {
      await deleteSession(id)
    } catch (err) {
      setSessions(prev)
      setError(err.message)
    }
  }

  return (
    <div id="session-list-page">
      <div className="top-bar">
        <button onClick={onBack}>
          <BackIcon />
        </button>
        <div className="chat-title">对话</div>
        <div className="top-bar-actions">
          <button onClick={handleCreate}>
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="session-list-body">
        {loading && <p className="session-list-empty">正在加载...</p>}
        {error && <p className="session-list-error">{error}</p>}
        {!loading && sessions.length === 0 && (
          <p className="session-list-empty">还没有对话，点右上角 + 开始</p>
        )}
        {sessions.map((s) => (
          <div className="session-list-item" key={s.id} onClick={() => onSelectSession(s.id)}>
            <div className="session-list-item-info">
              <div className="session-list-item-name">{s.name}</div>
              <div className="session-list-item-time">{formatDateTime(s.updated_at)}</div>
            </div>
            <button
              className="session-list-item-delete"
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
    </div>
  )
}

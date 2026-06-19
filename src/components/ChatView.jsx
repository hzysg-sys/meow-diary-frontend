import { useEffect, useRef, useState } from 'react'
import { FIXED_SESSION_ID } from '../constants'
import { fetchHistory, sendChatMessage } from '../api'
import Avatar from './Avatar'
import TypingIndicator from './TypingIndicator'
import { BackIcon, MenuIcon, SettingsIcon, SendIcon } from './icons'

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatTime(isoString) {
  const d = isoString ? new Date(isoString) : new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let localIdCounter = -1
function nextLocalId() {
  return localIdCounter--
}

export default function ChatView({ onBack, onOpenSidebar, onOpenSettings }) {
  const [messages, setMessages] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messagesRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchHistory(FIXED_SESSION_ID)
      .then((history) => {
        if (cancelled) return
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            time: formatTime(m.created_at),
          })),
        )
      })
      .catch((err) => {
        if (cancelled) return
        setHistoryError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isSending])

  async function handleSend() {
    const text = input.trim()
    if (!text || isSending) return

    setMessages((prev) => [...prev, { id: nextLocalId(), role: 'user', content: text, time: formatTime() }])
    setInput('')
    setIsSending(true)

    try {
      const reply = await sendChatMessage(FIXED_SESSION_ID, text)
      setMessages((prev) => [...prev, { id: nextLocalId(), role: 'assistant', content: reply, time: formatTime() }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextLocalId(), role: 'assistant', content: '消息没发出去，再试一次吧。', time: formatTime() },
      ])
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div id="main-panel">
      <div className="top-bar">
        <button onClick={onBack}>
          <BackIcon />
        </button>
        <div className="chat-title">Claude</div>
        <div className="top-bar-actions">
          <button onClick={onOpenSidebar}>
            <MenuIcon />
          </button>
          <button onClick={onOpenSettings}>
            <SettingsIcon />
          </button>
        </div>
      </div>

      <div id="messages" ref={messagesRef}>
        {loadingHistory && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#a8a29e' }}>正在加载历史消息...</p>
        )}
        {historyError && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#c98a98' }}>{historyError}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg-row ${m.role}`}>
            {m.role === 'assistant' && <Avatar role="assistant" />}
            <div className="msg-wrap">
              <div className="bubble">{m.content}</div>
              <div className="msg-time">{m.time}</div>
            </div>
            {m.role === 'user' && <Avatar role="user" />}
          </div>
        ))}
        {isSending && <TypingIndicator />}
      </div>

      <div className="input-bar">
        <div className="input-shell">
          <textarea
            id="msg-input"
            rows={1}
            placeholder="想说点什么..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button id="send-btn" onClick={handleSend} disabled={isSending || !input.trim()}>
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

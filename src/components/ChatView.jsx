import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHistory, sendChatMessage, regenerateMessage, editAndRegenerateMessage } from '../api'
import Avatar from './Avatar'
import TypingIndicator from './TypingIndicator'
import { BackIcon, MenuIcon, SettingsIcon, SendIcon } from './icons'

const PAGE_SIZE = 30
const LOAD_MORE_THRESHOLD = 60

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatTime(isoString) {
  const d = isoString ? new Date(isoString) : new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toUiMessage(m) {
  return { id: m.id, role: m.role, content: m.content, time: formatTime(m.created_at) }
}

let localIdCounter = -1
function nextLocalId() {
  return localIdCounter--
}

export default function ChatView({ active, sessionId, onBack, onOpenSidebar, onOpenSettings }) {
  const [messages, setMessages] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const [regeneratingId, setRegeneratingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const messagesRef = useRef(null)
  // 'instant' | 'smooth' | null —— 下一次 messages 变化后要不要滚到底部，以及用什么方式滚
  const pendingScrollRef = useRef(null)
  // 往上翻页（prepend）专用：记录插入前的 scrollHeight/scrollTop，插入后用差值修正，避免画面跳动
  const prependRestoreRef = useRef(null)

  useEffect(() => {
    if (sessionId == null) return
    let cancelled = false
    fetchHistory(sessionId, { limit: PAGE_SIZE })
      .then(({ messages: history, hasMore: more }) => {
        if (cancelled) return
        setMessages(history.map(toUiMessage))
        setHasMore(more)
        pendingScrollRef.current = 'instant'
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
  }, [sessionId])

  // 面板靠外层 #app 的 show class 控制显隐，ChatView 一直挂载着不会重新 mount——
  // 所以滚动要等 active 真正变 true（面板有了实际尺寸）才能生效，光靠 messages 变化触发会在隐藏时白跑一次
  useEffect(() => {
    if (!active) return
    const el = messagesRef.current
    if (!el) return

    if (prependRestoreRef.current) {
      const { scrollHeight: oldScrollHeight, scrollTop: oldScrollTop } = prependRestoreRef.current
      el.scrollTop = oldScrollTop + (el.scrollHeight - oldScrollHeight)
      prependRestoreRef.current = null
      return
    }

    if (pendingScrollRef.current === 'instant') {
      el.scrollTop = el.scrollHeight
      pendingScrollRef.current = null
    } else if (pendingScrollRef.current === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      pendingScrollRef.current = null
    }
  }, [active, messages])

  const loadMoreHistory = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const oldestId = messages[0]?.id
    if (oldestId == null) return

    const el = messagesRef.current
    setLoadingMore(true)
    prependRestoreRef.current = el ? { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop } : null

    try {
      const { messages: older, hasMore: more } = await fetchHistory(sessionId, {
        limit: PAGE_SIZE,
        before: oldestId,
      })
      setMessages((prev) => [...older.map(toUiMessage), ...prev])
      setHasMore(more)
    } catch {
      prependRestoreRef.current = null
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, messages, sessionId])

  function handleMessagesScroll(e) {
    if (e.target.scrollTop < LOAD_MORE_THRESHOLD) {
      loadMoreHistory()
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || isSending) return

    pendingScrollRef.current = 'smooth'
    setMessages((prev) => [...prev, { id: nextLocalId(), role: 'user', content: text, time: formatTime() }])
    setInput('')
    setIsSending(true)

    try {
      const reply = await sendChatMessage(sessionId, text)
      pendingScrollRef.current = 'smooth'
      setMessages((prev) => [...prev, { id: nextLocalId(), role: 'assistant', content: reply, time: formatTime() }])
    } catch {
      pendingScrollRef.current = 'smooth'
      setMessages((prev) => [
        ...prev,
        { id: nextLocalId(), role: 'assistant', content: '消息没发出去，再试一次吧。', time: formatTime() },
      ])
    } finally {
      setIsSending(false)
    }
  }

  const handleCopy = (id, content) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleRegenerate = async (id) => {
    if (regeneratingId) return
    setRegeneratingId(id)
    try {
      const content = await regenerateMessage(id)
      if (content) {
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content } : m)))
      }
    } catch (err) {
      console.error('重新生成失败', err)
    } finally {
      setRegeneratingId(null)
    }
  }

  const handleEditStart = (m) => {
    setEditingId(m.id)
    setEditText(m.content)
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditText('')
  }

  const handleEditConfirm = async (m) => {
    const trimmed = editText.trim()
    if (!trimmed || editLoading) return
    setEditLoading(true)
    try {
      const newMsg = await editAndRegenerateMessage(m.id, trimmed)
      setMessages((prev) => {
        const idx = prev.findIndex((msg) => msg.id === m.id)
        if (idx === -1) return prev
        const kept = prev.slice(0, idx + 1).map((msg) =>
          msg.id === m.id ? { ...msg, content: trimmed } : msg
        )
        return [...kept, toUiMessage(newMsg)]
      })
      pendingScrollRef.current = 'smooth'
      setEditingId(null)
      setEditText('')
    } catch (err) {
      console.error('编辑并重新生成失败', err)
    } finally {
      setEditLoading(false)
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

      <div id="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {loadingHistory && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#a8a29e' }}>正在加载历史消息...</p>
        )}
        {loadingMore && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#a8a29e', margin: '4px 0' }}>正在加载更早的消息...</p>
        )}
        {historyError && (
          <p style={{ textAlign: 'center', fontSize: 13, color: '#c98a98' }}>{historyError}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg-row ${m.role}`}>
            {m.role === 'assistant' && <Avatar role="assistant" />}
            <div className="msg-wrap">
              {editingId === m.id ? (
                <>
                  <div className="bubble edit-bubble">
                    <textarea
                      className="edit-textarea"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={Math.max(2, editText.split('\n').length)}
                      autoFocus
                    />
                    <div className="edit-actions">
                      <button
                        className={`edit-confirm-btn${editLoading ? ' loading' : ''}`}
                        onClick={() => handleEditConfirm(m)}
                        disabled={editLoading || !editText.trim()}
                        title="确认"
                      >
                        {editLoading ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                          </svg>
                        ) : '✓'}
                      </button>
                      <button
                        className="edit-cancel-btn"
                        onClick={handleEditCancel}
                        disabled={editLoading}
                        title="取消"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="msg-footer">
                    <div className="msg-time">{m.time}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bubble">{m.content}</div>
                  <div className="msg-footer">
                    <div className="msg-time">{m.time}</div>
                    <div className="msg-actions">
                      {m.role === 'user' && m.id > 0 && (
                        <button
                          className="msg-action-btn"
                          onClick={() => handleEditStart(m)}
                          disabled={!!editingId || !!regeneratingId}
                          title="编辑"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                      )}
                      <button
                        className={`msg-action-btn${copiedId === m.id ? ' copied' : ''}`}
                        onClick={() => handleCopy(m.id, m.content)}
                        title="复制"
                      >
                        {copiedId === m.id ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                      {m.role === 'assistant' && (
                        <button
                          className={`msg-action-btn${regeneratingId === m.id ? ' regenerating' : ''}`}
                          onClick={() => handleRegenerate(m.id)}
                          disabled={!!regeneratingId || !!editingId}
                          title="重新生成"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 .49-4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}
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

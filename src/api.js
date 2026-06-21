const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : 'https://meow-diary-backend.onrender.com')

export async function fetchHistory(sessionId, { limit = 30, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before != null) params.set('before', String(before))

  const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`加载历史消息失败 (${res.status})`)
  }
  return res.json()
}

export async function sendChatMessage(sessionId, message) {
  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`)
  }
  return data.reply
}

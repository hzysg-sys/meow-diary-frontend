const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : 'https://meow-diary-backend.onrender.com')

export async function fetchSessions() {
  const res = await fetch(`${API_BASE_URL}/api/sessions`)
  if (!res.ok) {
    throw new Error(`加载会话列表失败 (${res.status})`)
  }
  return res.json()
}

export async function createSession() {
  const res = await fetch(`${API_BASE_URL}/api/sessions`, { method: 'POST' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `创建会话失败 (${res.status})`)
  }
  return data
}

export async function deleteSession(id) {
  const res = await fetch(`${API_BASE_URL}/api/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `删除会话失败 (${res.status})`)
  }
}

export async function fetchHistory(sessionId, { limit = 30, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before != null) params.set('before', String(before))

  const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`加载历史消息失败 (${res.status})`)
  }
  return res.json()
}

export async function fetchSettings() {
  const res = await fetch(`${API_BASE_URL}/api/settings`)
  if (!res.ok) {
    throw new Error(`加载设置失败 (${res.status})`)
  }
  return res.json()
}

export async function updateSettings(settings) {
  const res = await fetch(`${API_BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `保存设置失败 (${res.status})`)
  }
  return data
}

export async function fetchMemories() {
  const res = await fetch(`${API_BASE_URL}/api/memories`)
  if (!res.ok) {
    throw new Error(`加载记忆文档失败 (${res.status})`)
  }
  return res.json()
}

export async function uploadMemory({ title, content }) {
  const res = await fetch(`${API_BASE_URL}/api/memories/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `上传失败 (${res.status})`)
  }
  return data
}

export async function deleteMemory(id) {
  const res = await fetch(`${API_BASE_URL}/api/memories/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `删除失败 (${res.status})`)
  }
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

export async function regenerateMessage(id) {
  const res = await fetch(`${API_BASE_URL}/api/messages/${id}/regenerate`, { method: 'POST' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `重新生成失败 (${res.status})`)
  }
  return data.content
}

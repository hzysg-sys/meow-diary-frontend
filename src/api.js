const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : 'https://meow-diary-backend.onrender.com')

const API_TOKEN = import.meta.env.VITE_API_TOKEN

// 后端 /api 接口统一走这个包装，自动带上鉴权 token。
// 只用于自家后端；Supabase Storage 等第三方 URL 仍用原生 fetch（带错 token 会被拒）
export function apiFetch(url, options = {}) {
  if (!API_TOKEN) return fetch(url, options)
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${API_TOKEN}` },
  })
}

export async function fetchSessions() {
  const res = await apiFetch(`${API_BASE_URL}/api/sessions`)
  if (!res.ok) {
    throw new Error(`加载会话列表失败 (${res.status})`)
  }
  return res.json()
}

export async function createSession() {
  const res = await apiFetch(`${API_BASE_URL}/api/sessions`, { method: 'POST' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `创建会话失败 (${res.status})`)
  }
  return data
}

export async function deleteSession(id) {
  const res = await apiFetch(`${API_BASE_URL}/api/sessions/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `删除会话失败 (${res.status})`)
  }
}

export async function fetchHistory(sessionId, { limit = 30, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before != null) params.set('before', String(before))

  const res = await apiFetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`加载历史消息失败 (${res.status})`)
  }
  return res.json()
}

export async function fetchSettings() {
  const res = await apiFetch(`${API_BASE_URL}/api/settings`)
  if (!res.ok) {
    throw new Error(`加载设置失败 (${res.status})`)
  }
  return res.json()
}

export async function updateSettings(settings) {
  const res = await apiFetch(`${API_BASE_URL}/api/settings`, {
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
  const res = await apiFetch(`${API_BASE_URL}/api/memories`)
  if (!res.ok) {
    throw new Error(`加载记忆文档失败 (${res.status})`)
  }
  return res.json()
}

export async function uploadMemory({ title, content }) {
  const res = await apiFetch(`${API_BASE_URL}/api/memories/upload`, {
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
  const res = await apiFetch(`${API_BASE_URL}/api/memories/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `删除失败 (${res.status})`)
  }
}

// 用户设备本地时间字符串（发消息时捎给后端，给 Elias 做时间感知）
function clientTimeString() {
  return new Date().toLocaleString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export async function sendChatMessage(sessionId, content, imageBase64 = null, imageType = null) {
  const body = { session_id: sessionId, content, client_time: clientTimeString() }
  if (imageBase64) {
    body.image_base64 = imageBase64
    body.image_type = imageType
  }
  const res = await apiFetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `请求失败 (${res.status})`)
  }
  if (data?.error === 'empty_response') {
    throw Object.assign(new Error(data.message || ''), {
      code: 'empty_response',
      userMessageId: data.userMessageId,
    })
  }
  return {
    reply: data.reply,
    replies: Array.isArray(data.replies) && data.replies.length ? data.replies : [data.reply],
    reasoning_content: data.reasoning_content || null,
  }
}

export async function regenerateMessage(id) {
  const res = await apiFetch(`${API_BASE_URL}/api/messages/${id}/regenerate`, { method: 'POST' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `重新生成失败 (${res.status})`)
  }
  if (data?.error === 'empty_response') {
    throw Object.assign(new Error(data.message || ''), { code: 'empty_response' })
  }
  return { content: data.content, reasoning_content: data.reasoning_content || null }
}

export async function pokeAssistant(sessionId) {
  const res = await apiFetch(`${API_BASE_URL}/api/poke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `戳一戳失败 (${res.status})`)
  }
  return data.message
}

export async function fetchHealthRecords(month) {
  const res = await apiFetch(`${API_BASE_URL}/api/health/records?month=${month}`)
  if (!res.ok) throw new Error(`加载健康记录失败 (${res.status})`)
  return res.json()
}

export async function saveHealthRecord(record) {
  const res = await apiFetch(`${API_BASE_URL}/api/health/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `保存失败 (${res.status})`)
  return data
}

export async function fetchPeriodPrediction() {
  const res = await apiFetch(`${API_BASE_URL}/api/health/period-prediction`)
  if (!res.ok) throw new Error(`加载预测失败 (${res.status})`)
  return res.json()
}

export async function discussBookPassage(bookId, payload) {
  const res = await apiFetch(`${API_BASE_URL}/api/books/${bookId}/discuss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, client_time: clientTimeString() }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `讨论请求失败 (${res.status})`)
  }
  if (data?.error === 'empty_response') {
    throw Object.assign(new Error(data.message || ''), { code: 'empty_response' })
  }
  return data
}


export async function fetchAnnotationDiscussion(highlightId) {
  const res = await apiFetch(`${API_BASE_URL}/api/annotations/${highlightId}/discussion`)
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `加载批注讨论失败 (${res.status})`)
  }
  return data
}

export async function discussAnnotation(highlightId, payload) {
  const res = await apiFetch(`${API_BASE_URL}/api/annotations/${highlightId}/discuss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, client_time: clientTimeString() }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `批注讨论请求失败 (${res.status})`)
  }
  if (data?.error === 'empty_response') {
    throw Object.assign(new Error(data.message || ''), { code: 'empty_response' })
  }
  return data
}
export async function fetchVapidPublicKey() {
  const res = await apiFetch(`${API_BASE_URL}/api/push/vapid-public-key`)
  if (!res.ok) throw new Error(`获取推送密钥失败 (${res.status})`)
  return res.json()
}

export async function savePushSubscription(subscription) {
  const res = await apiFetch(`${API_BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `保存订阅失败 (${res.status})`)
  return data
}

export async function fetchMoments(author) {
  const qs = author ? `?author=${author}` : ''
  const res = await apiFetch(`${API_BASE_URL}/api/moments${qs}`)
  if (!res.ok) throw new Error(`加载朋友圈失败 (${res.status})`)
  return res.json()
}

export async function postMoment({ content, imagesBase64 }) {
  const res = await apiFetch(`${API_BASE_URL}/api/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, images_base64: imagesBase64 || [] }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `发布失败 (${res.status})`)
  return data
}

export async function deleteMoment(id) {
  const res = await apiFetch(`${API_BASE_URL}/api/moments/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`删除失败 (${res.status})`)
}

export async function postMomentComment(id, content) {
  const res = await apiFetch(`${API_BASE_URL}/api/moments/${id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `评论失败 (${res.status})`)
  return data
}

export async function fetchDiary() {
  const res = await apiFetch(`${API_BASE_URL}/api/diary`)
  if (!res.ok) throw new Error(`加载日记失败 (${res.status})`)
  return res.json()
}

export async function deleteDiary(id) {
  const res = await apiFetch(`${API_BASE_URL}/api/diary/${id}`, { method: 'DELETE' })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `\u5220\u9664\u65e5\u8bb0\u5931\u8d25 (${res.status})`)
  return data
}

export async function fetchEnergyState() {
  const res = await apiFetch(`${API_BASE_URL}/api/energy`)
  if (!res.ok) throw new Error(`加载精力状态失败 (${res.status})`)
  return res.json()
}

export async function rerollEnergyState() {
  const res = await apiFetch(`${API_BASE_URL}/api/energy/roll`, { method: 'POST' })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `重掷失败 (${res.status})`)
  return data
}

export async function editAndRegenerateMessage(id, newContent) {
  const res = await apiFetch(`${API_BASE_URL}/api/messages/${id}/edit-and-regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newContent }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error || `编辑并重新生成失败 (${res.status})`)
  }
  if (data?.error === 'empty_response') {
    throw Object.assign(new Error(data.message || ''), { code: 'empty_response' })
  }
  return data
}

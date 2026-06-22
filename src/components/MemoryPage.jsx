import { useEffect, useRef, useState } from 'react'
import { fetchMemories, uploadMemory, deleteMemory } from '../api'
import { BackIcon, UploadIcon, DocumentIcon, TrashIcon } from './icons'

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatDateTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MemoryPage({ show, onBack }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchMemories()
      .then((data) => {
        if (!cancelled) setMemories(data)
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

  function handlePickFile() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const content = await file.text()
      const { id } = await uploadMemory({ title: file.name, content })
      setMemories((prev) => [{ id, title: file.name, content, created_at: new Date().toISOString() }, ...prev])
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(id) {
    const prev = memories
    setMemories((cur) => cur.filter((m) => m.id !== id))
    try {
      await deleteMemory(id)
    } catch (err) {
      setMemories(prev)
      setError(err.message)
    }
  }

  return (
    <div id="memory-page" className={show ? 'show' : ''}>
      <div className="memory-top-bar">
        <button className="memory-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回主页</span>
        </button>
        <h1 className="memory-title">记忆文档</h1>
      </div>

      <div className="memory-body">
        <button className="memory-upload-zone" onClick={handlePickFile} disabled={uploading}>
          <UploadIcon />
          <p>{uploading ? '正在上传...' : '上传 .md 文件'}</p>
        </button>
        <input ref={fileInputRef} type="file" accept=".md" style={{ display: 'none' }} onChange={handleFileChange} />

        {error && <p className="memory-error">{error}</p>}

        <div className="memory-list">
          {loading && <p className="memory-empty">正在加载...</p>}
          {!loading && memories.length === 0 && <p className="memory-empty">还没有上传任何记忆文档</p>}
          {memories.map((m) => (
            <div className="memory-card" key={m.id}>
              <div className="memory-card-icon">
                <DocumentIcon />
              </div>
              <div className="memory-card-info">
                <div className="memory-card-name">{m.title}</div>
                <div className="memory-card-meta">{formatDateTime(m.created_at)}</div>
                <div className="memory-card-preview">{(m.content || '').slice(0, 100)}</div>
              </div>
              <button className="memory-delete-btn" onClick={() => handleDelete(m.id)}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

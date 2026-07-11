import { useEffect, useRef, useState } from 'react'
import { fetchMoments, postMoment, deleteMoment, postMomentComment } from '../api'
import { compressImage } from '../utils/image'
import { AI_AVATAR_URL, USER_AVATAR_URL } from '../constants'
import { BackIcon } from './icons'

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

const nameOf = (author) => (author === 'ai' ? 'Elias' : '我')
const avatarOf = (author) => (author === 'ai' ? AI_AVATAR_URL : USER_AVATAR_URL)

export default function MomentsPage({ show, onBack }) {
  const [moments, setMoments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewAuthor, setViewAuthor] = useState(null) // null=全部，'user'/'ai'=个人主页

  const [composerOpen, setComposerOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftImages, setDraftImages] = useState([]) // { base64, previewUrl }
  const [posting, setPosting] = useState(false)

  const [commentingId, setCommentingId] = useState(null)
  const [commentText, setCommentText] = useState('')
  const [lightbox, setLightbox] = useState(null)
  const fileRef = useRef(null)

  const load = (author = viewAuthor) => {
    return fetchMoments(author)
      .then((data) => { setMoments(data); setError(null) })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!show) return
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, viewAuthor])

  // AI 评论/回复是异步生成的，操作后隔几秒各刷一次拿结果
  const refreshSoon = () => {
    setTimeout(() => load(), 4000)
    setTimeout(() => load(), 9000)
  }

  const handlePickImages = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    for (const f of files.slice(0, 9 - draftImages.length)) {
      try {
        const img = await compressImage(f)
        setDraftImages((prev) => [...prev, img])
      } catch { /* 单张失败忽略 */ }
    }
  }

  const handlePost = async () => {
    if ((!draft.trim() && draftImages.length === 0) || posting) return
    setPosting(true)
    try {
      await postMoment({ content: draft.trim(), imagesBase64: draftImages.map((i) => i.base64) })
      setDraft('')
      setDraftImages([])
      setComposerOpen(false)
      await load()
      refreshSoon()
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('删除这条朋友圈？')) return
    const prev = moments
    setMoments((cur) => cur.filter((m) => m.id !== id))
    try {
      await deleteMoment(id)
    } catch (err) {
      setMoments(prev)
      setError(err.message)
    }
  }

  const handleComment = async (momentId) => {
    const text = commentText.trim()
    if (!text) return
    setCommentText('')
    setCommentingId(null)
    // 乐观插入
    setMoments((cur) => cur.map((m) => m.id === momentId
      ? { ...m, comments: [...(m.comments || []), { id: `local-${Date.now()}`, author: 'user', content: text }] }
      : m))
    try {
      await postMomentComment(momentId, text)
      refreshSoon()
    } catch (err) {
      setError(err.message)
    }
  }

  const coverAuthor = viewAuthor || 'user'

  return (
    <div id="moments-page" className={show ? 'show' : ''}>
      <div className="moments-cover">
        <button className="moments-back" onClick={() => (viewAuthor ? setViewAuthor(null) : onBack())}>
          <BackIcon />
        </button>
        <button className="moments-camera" onClick={() => setComposerOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <div className="moments-cover-id">
          <span className="moments-cover-name">{viewAuthor ? nameOf(viewAuthor) : '朋友圈'}</span>
          <img className="moments-cover-avatar" src={avatarOf(coverAuthor)} alt="" onClick={() => setViewAuthor(viewAuthor ? null : 'user')} />
        </div>
      </div>

      <div className="moments-body">
        {loading && <p className="moments-hint">加载中...</p>}
        {error && <p className="moments-hint moments-error">{error}</p>}
        {!loading && moments.length === 0 && <p className="moments-hint">还没有动态，发一条吧～</p>}

        {moments.map((m) => (
          <div className="moment-item" key={m.id}>
            <img className="moment-avatar" src={avatarOf(m.author)} alt="" onClick={() => setViewAuthor(m.author)} />
            <div className="moment-main">
              <div className="moment-name" onClick={() => setViewAuthor(m.author)}>{nameOf(m.author)}</div>
              {m.content && <div className="moment-text">{m.content}</div>}
              {m.images && m.images.length > 0 && (
                <div className={`moment-images grid-${Math.min(m.images.length, 3) === m.images.length && m.images.length < 3 ? m.images.length : 3}`}>
                  {m.images.map((url, i) => (
                    <img key={i} src={url} alt="" onClick={() => setLightbox(url)} />
                  ))}
                </div>
              )}
              <div className="moment-foot">
                <span className="moment-time">{relTime(m.created_at)}</span>
                <div className="moment-foot-btns">
                  {m.author === 'user' && (
                    <button className="moment-del" onClick={() => handleDelete(m.id)}>删除</button>
                  )}
                  <button className="moment-comment-btn" onClick={() => { setCommentingId(commentingId === m.id ? null : m.id); setCommentText('') }}>
                    评论
                  </button>
                </div>
              </div>

              {(m.comments && m.comments.length > 0) && (
                <div className="moment-comments">
                  {m.comments.map((c) => (
                    <div className="moment-comment" key={c.id}>
                      <span className="moment-comment-name">{nameOf(c.author)}</span>
                      <span className="moment-comment-text">：{c.content}</span>
                    </div>
                  ))}
                </div>
              )}

              {commentingId === m.id && (
                <div className="moment-comment-bar">
                  <input
                    autoFocus
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="说点什么..."
                    onKeyDown={(e) => { if (e.key === 'Enter') handleComment(m.id) }}
                  />
                  <button onClick={() => handleComment(m.id)} disabled={!commentText.trim()}>发送</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {composerOpen && (
        <div className="composer-overlay" onClick={(e) => { if (e.target === e.currentTarget) setComposerOpen(false) }}>
          <div className="composer-card">
            <div className="composer-head">
              <button onClick={() => setComposerOpen(false)}>取消</button>
              <span>发朋友圈</span>
              <button className="composer-send" onClick={handlePost} disabled={posting || (!draft.trim() && draftImages.length === 0)}>
                {posting ? '发布中' : '发表'}
              </button>
            </div>
            <textarea
              className="composer-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="这一刻的想法..."
              autoFocus
            />
            <div className="composer-images">
              {draftImages.map((img, i) => (
                <div className="composer-img" key={i}>
                  <img src={img.previewUrl} alt="" />
                  <button onClick={() => setDraftImages((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
                </div>
              ))}
              {draftImages.length < 9 && (
                <button className="composer-add-img" onClick={() => fileRef.current?.click()}>＋</button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handlePickImages} />
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="lightbox-img" />
        </div>
      )}
    </div>
  )
}

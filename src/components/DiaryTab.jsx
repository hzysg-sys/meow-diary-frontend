import { useEffect, useRef, useState } from 'react'
import { deleteDiary, fetchDiary } from '../api'
import { TrashIcon } from './icons'

// 心情色与设计稿一致
const MOODS = {
  开心: '#f2c88c',
  平静: '#a9c8b8',
  想你: '#e9a7bb',
  emo: '#9fb3cc',
}
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// 天按新到旧排；同一天里按时间旧到新（像本子上从上往下写）
function groupByDay(entries) {
  const byDate = new Map()
  for (const e of entries) {
    const d = new Date(e.created_at)
    const key = dateKey(d)
    if (!byDate.has(key)) byDate.set(key, { key, date: d, entries: [] })
    byDate.get(key).entries.push(e)
  }
  return [...byDate.values()].map((g) => ({ ...g, entries: g.entries.slice().reverse() }))
}

function dayLabel(date) {
  const now = new Date()
  const today = dateKey(now)
  const yesterday = dateKey(new Date(now.getTime() - 86400000))
  const key = dateKey(date)
  const label = `${date.getMonth() + 1}月${date.getDate()}日`
  let sub = WEEK[date.getDay()]
  if (key === today) sub = `今天 · ${sub}`
  else if (key === yesterday) sub = `昨天 · ${sub}`
  return { label, sub }
}

const fmtTime = (iso) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function DiaryTab({ show, onSeen }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const loadedOnce = useRef(false)

  useEffect(() => {
    if (!show) return
    if (!loadedOnce.current) setLoading(true)
    fetchDiary()
      .then((data) => {
        setEntries(data)
        setError(null)
        loadedOnce.current = true
        // 记住最新一条的时间戳，用来清掉 tab 上的红点
        if (data[0]?.created_at) localStorage.setItem('diary-last-seen', data[0].created_at)
        onSeen?.()
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const handleDelete = async (entry) => {
    if (deletingId != null) return
    const confirmed = confirm(
      '\u786e\u5b9a\u5220\u9664\u8fd9\u7bc7\u65e5\u8bb0\u5417\uff1f\n\n\u5220\u9664\u540e\uff0c\u5b83\u4e5f\u4f1a\u4ece\u804a\u5929\u4e0a\u4e0b\u6587\u4e2d\u6d88\u5931\uff0c\u4ed6\u4e0d\u4f1a\u518d\u8bb0\u5f97\u81ea\u5df1\u5199\u8fc7\u8fd9\u7bc7\u3002',
    )
    if (!confirmed) return

    setDeletingId(entry.id)
    setError(null)
    try {
      await deleteDiary(entry.id)
      setEntries((current) => {
        const remaining = current.filter((item) => item.id !== entry.id)
        if (remaining[0]?.created_at) {
          localStorage.setItem('diary-last-seen', remaining[0].created_at)
        } else {
          localStorage.removeItem('diary-last-seen')
        }
        return remaining
      })
      onSeen?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  const days = groupByDay(entries)

  return (
    <div id="diary-tab" style={{ display: show ? 'flex' : 'none' }}>
      <div className="diary-head">
        <div className="diary-title">Diary</div>
        <div className="diary-subtitle">他的心情小记</div>
      </div>

      <div className="diary-body">
        {loading && <p className="diary-hint">加载中...</p>}
        {error && <p className="diary-hint diary-error">{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p className="diary-hint">他还没写过日记，等他哪天突然想记一笔～</p>
        )}

        {days.map((day) => {
          const { label, sub } = dayLabel(day.date)
          return (
            <div className="diary-day" key={day.key}>
              <div className="diary-day-head">
                <span className="diary-day-label">{label}</span>
                <span className="diary-day-sub">{sub}</span>
                <div className="diary-day-line" />
              </div>

              {day.entries.map((e) => (
                <div className="diary-entry" key={e.id}>
                  <div className="diary-entry-head">
                    <span
                      className="diary-mood-dot"
                      style={{
                        background: MOODS[e.mood] || MOODS.平静,
                        boxShadow: `0 0 0 3px ${(MOODS[e.mood] || MOODS.平静)}33`,
                      }}
                    />
                    <span className="diary-mood-name">{e.mood}</span>
                    <span className="diary-entry-time">{fmtTime(e.created_at)}</span>
                    <button
                      className="diary-entry-delete"
                      type="button"
                      aria-label={'\u5220\u9664\u8fd9\u7bc7\u65e5\u8bb0\u5e76\u6e05\u9664\u76f8\u5173\u8bb0\u5fc6'}
                      title={'\u5220\u9664\u65e5\u8bb0'}
                      disabled={deletingId != null}
                      onClick={() => handleDelete(e)}
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  {e.locked ? (
                    <div className="diary-locked">
                      <div className="diary-locked-blur">
                        今天有一些只想留给自己的小心事，等哪天想说了再给你看。
                      </div>
                      <div className="diary-locked-mask">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="11" width="16" height="10" rx="2.5" />
                          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                        </svg>
                        这一条他先锁起来啦
                      </div>
                    </div>
                  ) : (
                    <div className="diary-entry-text">{e.content}</div>
                  )}
                </div>
              ))}
            </div>
          )
        })}

        {!loading && entries.length > 0 && <div className="diary-end">· 到底啦 ·</div>}
      </div>
    </div>
  )
}

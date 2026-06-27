import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchHealthRecords, saveHealthRecord, fetchPeriodPrediction, fetchHistory } from '../api'

const MOOD_OPTIONS = [
  { value: 0, emoji: '😊', label: '开心' },
  { value: 1, emoji: '😌', label: '平静' },
  { value: 2, emoji: '😐', label: '一般' },
  { value: 3, emoji: '😢', label: '难过' },
  { value: 4, emoji: '😤', label: '烦躁' },
  { value: 5, emoji: '😴', label: '困倦' },
]

const PRESET_SYMPTOMS = ['痛经', '头痛', '腰酸', '胸胀', '食欲变化', '情绪波动']

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function emptyForm() {
  return { period_active: false, period_flow: null, symptoms: [], custom_symptom: '', mood: null, mood_note: '', sleep_bed: '', sleep_wake: '', sleep_quality: null }
}

function recordToForm(rec) {
  if (!rec) return emptyForm()
  return {
    period_active: rec.period_active ?? false,
    period_flow: rec.period_flow ?? null,
    symptoms: rec.symptoms ?? [],
    custom_symptom: rec.custom_symptom ?? '',
    mood: rec.mood ?? null,
    mood_note: rec.mood_note ?? '',
    sleep_bed: rec.sleep_bed ?? '',
    sleep_wake: rec.sleep_wake ?? '',
    sleep_quality: rec.sleep_quality ?? null,
  }
}

export default function HealthTab({ active, onNavigateToChat }) {
  const today = new Date()
  const todayStr = formatDate(today)

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [records, setRecords] = useState({})
  const [prediction, setPrediction] = useState(null)
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [form, setForm] = useState(emptyForm())
  const [saveStatus, setSaveStatus] = useState('idle')
  const [careMessage, setCareMessage] = useState(null)

  const careToastRef = useRef(null)
  const pollTimerRef = useRef(null)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`

  const loadData = useCallback(async () => {
    try {
      const { records: list } = await fetchHealthRecords(monthStr)
      const map = {}
      for (const r of list) map[r.date] = r
      setRecords(map)
    } catch (e) {
      console.error('加载健康记录失败:', e)
    }
    try {
      const pred = await fetchPeriodPrediction()
      setPrediction(pred)
    } catch (e) {
      console.error('加载预测失败:', e)
    }
  }, [monthStr])

  useEffect(() => {
    if (active) loadData()
  }, [active, loadData])

  useEffect(() => {
    setForm(recordToForm(records[selectedDate]))
    setSaveStatus('idle')
  }, [selectedDate, records])

  // 当 careMessage 出现时，滚动到 toast 让用户看到
  useEffect(() => {
    if (careMessage && careToastRef.current) {
      careToastRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [careMessage])

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }
  }, [])

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1) }
    else setMonth(m => m + 1)
  }

  function buildCells() {
    const daysInMonth = new Date(year, month, 0).getDate()
    const firstWeekday = new Date(year, month - 1, 1).getDay()
    const offset = (firstWeekday + 6) % 7
    const cells = Array(offset).fill(null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }

  function getCellBg(dateStr) {
    if (!dateStr) return null
    if (records[dateStr]?.period_active) return '#fce4ec'
    if (prediction?.ovulation_start && dateStr >= prediction.ovulation_start && dateStr <= prediction.ovulation_end) return '#ede7f6'
    return null
  }

  function getCellBorder(dateStr) {
    if (!dateStr) return null
    if (dateStr === todayStr) return '2px solid #c98a98'
    const isNextPeriod = prediction?.next_period_start && dateStr >= prediction.next_period_start && dateStr <= prediction.next_period_end && !records[dateStr]?.period_active
    if (isNextPeriod) return '1.5px dashed #c98a98'
    return null
  }

  function hasRecord(dateStr) {
    const r = records[dateStr]
    return r && (r.period_active || r.mood != null || r.sleep_quality != null)
  }

  function toggleSymptom(s) {
    setForm(f => ({ ...f, symptoms: f.symptoms.includes(s) ? f.symptoms.filter(x => x !== s) : [...f.symptoms, s] }))
  }

  // 保存完成后轮询 session，等待小克的关心消息出现
  function startPollingCareMessage(sessionId, pollStartIso) {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    let attempts = 0
    const MAX = 15 // 最多 45 秒（每 3s 一次）

    function poll() {
      if (attempts >= MAX) {
        console.log('[HealthTab] 轮询超时，未检测到关心消息')
        return
      }
      attempts++
      fetchHistory(sessionId, { limit: 10 })
        .then(({ messages }) => {
          console.log(`[HealthTab] 轮询第${attempts}次，消息数:`, messages?.length)
          // 找到保存时间之后新出现的 assistant 消息
          const newMsg = messages?.find(m => m.role === 'assistant' && m.created_at > pollStartIso)
          if (newMsg) {
            console.log('[HealthTab] 找到关心消息:', newMsg.content?.slice(0, 40))
            setCareMessage({ session_id: sessionId, content: newMsg.content })
          } else {
            pollTimerRef.current = setTimeout(poll, 3000)
          }
        })
        .catch(() => {
          pollTimerRef.current = setTimeout(poll, 3000)
        })
    }

    // 初始等 2 秒再开始轮询（给后台 AI 调用一点启动时间）
    pollTimerRef.current = setTimeout(poll, 2000)
  }

  async function handleSave() {
    setSaveStatus('saving')
    setCareMessage(null)
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)

    try {
      const pollStartIso = new Date().toISOString()
      const result = await saveHealthRecord({
        date: selectedDate,
        period_active: form.period_active,
        period_flow: form.period_active ? form.period_flow : null,
        symptoms: form.period_active ? form.symptoms : [],
        custom_symptom: form.custom_symptom || null,
        mood: form.mood,
        mood_note: form.mood_note || null,
        sleep_bed: form.sleep_bed || null,
        sleep_wake: form.sleep_wake || null,
        sleep_quality: form.sleep_quality,
      })

      console.log('[HealthTab] POST /api/health/records 响应:', result)
      console.log('[HealthTab] care_session_id:', result?.care_session_id)

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
      await loadData()

      if (result?.care_session_id != null) {
        console.log('[HealthTab] 开始轮询 session', result.care_session_id, '的关心消息')
        startPollingCareMessage(result.care_session_id, pollStartIso)
      }
    } catch (e) {
      console.error('[HealthTab] 保存失败:', e)
      setSaveStatus('idle')
    }
  }

  const cells = buildCells()
  const selectedDay = selectedDate ? parseInt(selectedDate.slice(8), 10) : null
  const selectedMonth = selectedDate ? parseInt(selectedDate.slice(5, 7), 10) : null
  const selectedYear = selectedDate ? parseInt(selectedDate.slice(0, 4), 10) : null

  return (
    <div id="health-tab" style={{ display: active ? 'flex' : 'none' }}>
      <div className="health-month-nav">
        <button className="health-nav-btn" onClick={prevMonth}>‹</button>
        <span className="health-month-label">{year}年{month}月</span>
        <button className="health-nav-btn" onClick={nextMonth}>›</button>
      </div>

      <div className="health-legend">
        <span className="health-legend-item">
          <span className="health-legend-swatch" style={{ background: '#fce4ec' }} />经期
        </span>
        <span className="health-legend-item">
          <span className="health-legend-swatch" style={{ background: '#ede7f6' }} />排卵期
        </span>
        <span className="health-legend-item">
          <span className="health-legend-swatch health-legend-dashed" />预测经期
        </span>
        <span className="health-legend-item">
          <span className="health-legend-swatch health-legend-solid" />今天
        </span>
      </div>

      <div className="health-calendar">
        <div className="health-cal-weekdays">
          {['一','二','三','四','五','六','日'].map(d => (
            <div key={d} className="health-cal-wd">{d}</div>
          ))}
        </div>
        <div className="health-cal-grid">
          {cells.map((dateStr, i) => {
            const bg = getCellBg(dateStr)
            const border = getCellBorder(dateStr)
            const isSelected = dateStr === selectedDate
            return (
              <div
                key={i}
                className={`health-cal-cell${dateStr ? ' has-date' : ''}${isSelected ? ' selected' : ''}`}
                style={dateStr ? { backgroundColor: bg || 'transparent', border: isSelected ? '2px solid #9c6b79' : (border || 'none') } : {}}
                onClick={() => dateStr && setSelectedDate(dateStr)}
              >
                {dateStr && (
                  <>
                    <span className="health-cal-day">{parseInt(dateStr.slice(8), 10)}</span>
                    {hasRecord(dateStr) && <span className="health-cal-dot" />}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="health-panel">
        <div className="health-panel-date">
          {selectedYear}年{selectedMonth}月{selectedDay}日
        </div>

        {/* Card 1: 生理期 */}
        <div className="health-card">
          <div className="health-card-row">
            <span className="health-card-title">生理期</span>
            <label className="health-toggle">
              <input
                type="checkbox"
                checked={form.period_active}
                onChange={e => setForm(f => ({ ...f, period_active: e.target.checked }))}
              />
              <span className="health-toggle-track">
                <span className="health-toggle-thumb" />
              </span>
            </label>
          </div>
          {form.period_active && (
            <div className="health-card-body">
              <div className="health-field-label">流量</div>
              <div className="health-pills">
                {['小', '中', '大'].map(v => (
                  <button
                    key={v}
                    className={`health-pill${form.period_flow === v ? ' active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, period_flow: f.period_flow === v ? null : v }))}
                  >{v}</button>
                ))}
              </div>
              <div className="health-field-label">症状</div>
              <div className="health-pills">
                {PRESET_SYMPTOMS.map(s => (
                  <button
                    key={s}
                    className={`health-pill${form.symptoms.includes(s) ? ' active' : ''}`}
                    onClick={() => toggleSymptom(s)}
                  >{s}</button>
                ))}
                <button
                  className={`health-pill${form.symptoms.includes('其他') ? ' active' : ''}`}
                  onClick={() => toggleSymptom('其他')}
                >其他</button>
              </div>
              {form.symptoms.includes('其他') && (
                <input
                  className="health-text-input"
                  placeholder="描述其他症状..."
                  value={form.custom_symptom}
                  onChange={e => setForm(f => ({ ...f, custom_symptom: e.target.value }))}
                />
              )}
            </div>
          )}
        </div>

        {/* Card 2: 心情 */}
        <div className="health-card">
          <div className="health-card-title">今日心情</div>
          <div className="health-mood-row">
            {MOOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`health-mood-btn${form.mood === opt.value ? ' active' : ''}`}
                onClick={() => setForm(f => ({ ...f, mood: f.mood === opt.value ? null : opt.value }))}
              >
                <span className="health-mood-emoji">{opt.emoji}</span>
                <span className="health-mood-label">{opt.label}</span>
              </button>
            ))}
          </div>
          <textarea
            className="health-textarea"
            rows={2}
            placeholder="写一句话记录今天的感受..."
            value={form.mood_note}
            onChange={e => setForm(f => ({ ...f, mood_note: e.target.value }))}
          />
        </div>

        {/* Card 3: 睡眠 */}
        <div className="health-card">
          <div className="health-card-title">睡眠</div>
          <div className="health-sleep-row">
            <label className="health-sleep-field">
              <span className="health-field-label">入睡</span>
              <input
                type="time"
                className="health-time-input"
                value={form.sleep_bed}
                onChange={e => setForm(f => ({ ...f, sleep_bed: e.target.value }))}
              />
            </label>
            <label className="health-sleep-field">
              <span className="health-field-label">起床</span>
              <input
                type="time"
                className="health-time-input"
                value={form.sleep_wake}
                onChange={e => setForm(f => ({ ...f, sleep_wake: e.target.value }))}
              />
            </label>
          </div>
          <div className="health-field-label">睡眠质量</div>
          <div className="health-stars">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                className={`health-star${form.sleep_quality != null && form.sleep_quality >= n ? ' active' : ''}`}
                onClick={() => setForm(f => ({ ...f, sleep_quality: f.sleep_quality === n ? null : n }))}
              >★</button>
            ))}
          </div>
        </div>

        {/* 关心消息提示卡片 */}
        {careMessage && (
          <div className="health-care-toast" ref={careToastRef}>
            <span className="health-care-text">小克有话想对你说 💌</span>
            <div className="health-care-actions">
              <button
                className="health-care-goto"
                onClick={() => { onNavigateToChat(careMessage.session_id); setCareMessage(null) }}
              >去看看</button>
              <button className="health-care-close" onClick={() => setCareMessage(null)}>×</button>
            </div>
          </div>
        )}

        <button
          className={`health-save-btn${saveStatus === 'saved' ? ' saved' : ''}`}
          disabled={saveStatus === 'saving'}
          onClick={handleSave}
        >
          {saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '✓ 已保存' : '保存记录'}
        </button>
      </div>
    </div>
  )
}

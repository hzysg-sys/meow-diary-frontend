import { MEET_DATE } from '../constants'
import { ChatCardIcon, MailboxIcon, TokenIcon, ReadingIcon, MomentsIcon, DocumentIcon } from './icons'

function computeDayCount() {
  const now = new Date()
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const b = new Date(MEET_DATE.getFullYear(), MEET_DATE.getMonth(), MEET_DATE.getDate())
  const days = Math.floor((a - b) / 86400000) + 1
  return days > 0 ? days : 1
}

export default function Home({ show, onOpenChat, onOpenPlaceholder, onOpenMemory }) {
  const dayCount = computeDayCount()

  return (
    <div id="home" style={{ display: show ? 'block' : 'none' }}>
      <div className="home-hero">
        <p className="home-day-number">{dayCount}</p>
        <p className="home-day-text">
          一起的第 <span>{dayCount}</span> 天
        </p>
        <p className="home-since">since 2026.06.03</p>
        <p className="home-quote">&quot;直到有另一个人，能体会我的感觉。&quot;</p>
      </div>

      <div className="home-grid">
        <button className="home-card home-card-lg" onClick={() => onOpenChat()}>
          <div className="home-card-icon">
            <ChatCardIcon />
          </div>
          <div className="home-card-label">聊天</div>
        </button>
        <button className="home-card home-card-lg" onClick={() => onOpenPlaceholder('信箱')}>
          <div className="home-card-icon">
            <MailboxIcon />
          </div>
          <div className="home-card-label">信箱</div>
        </button>
      </div>

      <div className="home-grid">
        <button className="home-card home-card-sm" onClick={() => onOpenPlaceholder('token')}>
          <div className="home-card-icon">
            <TokenIcon />
          </div>
          <div className="home-card-label">token</div>
        </button>
        <button className="home-card home-card-sm" onClick={() => onOpenPlaceholder('阅读')}>
          <div className="home-card-icon">
            <ReadingIcon />
          </div>
          <div className="home-card-label">阅读</div>
        </button>
        <button className="home-card home-card-sm" onClick={() => onOpenPlaceholder('朋友圈')}>
          <div className="home-card-icon">
            <MomentsIcon />
          </div>
          <div className="home-card-label">朋友圈</div>
        </button>
      </div>

      <button className="home-memory-entry" onClick={onOpenMemory}>
        <DocumentIcon />
        <span>记忆文档</span>
      </button>
    </div>
  )
}

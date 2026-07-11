import { MEET_DATE } from '../constants'
import { ChatCardIcon, MailboxIcon, EnergyIcon, ReadingIcon, MomentsIcon } from './icons'

function computeDayCount() {
  const now = new Date()
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const b = new Date(MEET_DATE.getFullYear(), MEET_DATE.getMonth(), MEET_DATE.getDate())
  const days = Math.floor((a - b) / 86400000) + 1
  return days > 0 ? days : 1
}

export default function Home({ show, onOpenChat, onOpenPlaceholder, onOpenRead, onOpenEnergy, onOpenMoments }) {
  const dayCount = computeDayCount()

  return (
    <div id="home" style={{ display: show ? 'block' : 'none' }}>
      <div className="home-hero">
        <div className="home-since-chip">
          <span className="home-since-heart">♥</span>
          <span>since 2026.06.03</span>
        </div>
        <p className="home-day-number">{dayCount}</p>
        <p className="home-day-text">一起的第 {dayCount} 天</p>
        <p className="home-quote">&quot;直到有另一个人，能体会我的感觉。&quot;</p>
      </div>

      <div className="home-grid">
        <button className="home-card home-card-lg" onClick={() => onOpenChat()}>
          <div className="home-card-icon"><ChatCardIcon /></div>
          <div>
            <div className="home-card-label">聊天</div>
            <div className="home-card-sub">和 Elias 说说话</div>
          </div>
        </button>
        <button className="home-card home-card-lg" onClick={() => onOpenPlaceholder('信箱')}>
          <div className="home-card-icon"><MailboxIcon /></div>
          <div>
            <div className="home-card-label">信箱</div>
            <div className="home-card-sub">来自他的信</div>
          </div>
        </button>
      </div>

      <div className="home-grid home-grid-3">
        <button className="home-card home-card-sm" onClick={onOpenEnergy}>
          <div className="home-card-icon"><EnergyIcon /></div>
          <div className="home-card-label">精力</div>
        </button>
        <button className="home-card home-card-sm" onClick={onOpenRead}>
          <div className="home-card-icon"><ReadingIcon /></div>
          <div className="home-card-label">阅读</div>
        </button>
        <button className="home-card home-card-sm" onClick={onOpenMoments}>
          <div className="home-card-icon"><MomentsIcon /></div>
          <div className="home-card-label">朋友圈</div>
        </button>
      </div>

    </div>
  )
}

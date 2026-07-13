const CEDAR_TOY_URL = 'https://toy.cedarstar.org/'

export default function Home({ show, onOpenMusic, onOpenEnergy, onOpenMoments }) {
  const apps = [
    {
      label: '音乐',
      onClick: onOpenMusic,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#b3839a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
        </svg>
      ),
    },
    {
      label: '精力',
      onClick: onOpenEnergy,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#b3839a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      label: '朋友圈',
      onClick: onOpenMoments,
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#b3839a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" />
        </svg>
      ),
    },
    {
      label: '游戏',
      onClick: () => window.open(CEDAR_TOY_URL, '_blank', 'noopener,noreferrer'),
      icon: (
        <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="#b3839a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="11" rx="5.5" />
          <line x1="7" y1="11" x2="7" y2="14" /><line x1="5.5" y1="12.5" x2="8.5" y2="12.5" />
          <circle cx="16" cy="11.5" r="1" /><circle cx="18.5" cy="14" r="1" />
        </svg>
      ),
    },
  ]

  return (
    <div id="home" style={{ display: show ? 'block' : 'none' }}>
      {/* 顶部情侣卡片：配图 + 磨砂面板 + 交界处双头像 */}
      <div className="home-couple-card">
        <div className="home-banner">
          <img src="/home/card-banner.jpg" alt="" />
        </div>
        <div className="home-panel">
          <div className="home-names">Yuen with Elias</div>
          <div className="home-line">爱是平淡&nbsp;&nbsp;是陪伴</div>
          <div className="home-line">是我和你一起无限循环</div>
        </div>
        <div className="home-avatars">
          <div className="home-avatar home-avatar-me" />
          <span className="home-amp">&amp;</span>
          <div className="home-avatar home-avatar-him" />
        </div>
      </div>

      {/* 下半部：旋转唱片 + 2x2 应用 */}
      <div className="home-deck">
        <div className="home-record-wrap">
          <div className="home-record">
            <div className="home-record-ring home-record-ring-1" />
            <div className="home-record-ring home-record-ring-2" />
            <div className="home-record-img" />
            <div className="home-record-dot" />
          </div>
          <div className="home-record-glare" />
        </div>

        <div className="home-apps">
          {apps.map((app) => (
            <button key={app.label} className="home-app" onClick={app.onClick}>
              <div className="home-app-icon">{app.icon}</div>
              <span className="home-app-label">{app.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

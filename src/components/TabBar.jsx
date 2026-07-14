const TABS = [
  {
    key: 'chat',
    label: '聊天',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: 'health',
    label: '健康',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    key: 'home',
    label: '猫窝',
    icon: null,
  },
  {
    key: 'diary',
    label: '日记',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
        <line x1="8" y1="2" x2="8" y2="22" />
        <line x1="12" y1="8" x2="17" y2="8" />
        <line x1="12" y1="12" x2="17" y2="12" />
      </svg>
    ),
  },
  {
    key: 'read',
    label: '阅读',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
]

export default function TabBar({ activeTab, onTabChange, diaryUnread }) {
  return (
    <div className="tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`tab-item${activeTab === tab.key ? ' active' : ''}${tab.key === 'home' ? ' tab-home' : ''}`}
          onClick={() => onTabChange(tab.key)}
          aria-label={tab.label}
          aria-current={activeTab === tab.key ? 'page' : undefined}
        >
          {tab.key === 'home' ? (
            <div className="cat-dock-btn"><div className="cat-paw-icon" /></div>
          ) : (
            tab.icon
          )}
          {tab.key !== 'home' && <span className="tab-label">{tab.label}</span>}
          {tab.key === 'diary' && diaryUnread && <span className="tab-dot" />}
        </button>
      ))}
    </div>
  )
}

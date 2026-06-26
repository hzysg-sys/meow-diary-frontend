export default function ChatListTab({ show }) {
  return (
    <div className="tab-placeholder" style={{ display: show ? 'flex' : 'none' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d4b8bc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <p className="tab-placeholder-text">聊天功能搭建中</p>
      <p className="tab-placeholder-emoji">🐾</p>
    </div>
  )
}

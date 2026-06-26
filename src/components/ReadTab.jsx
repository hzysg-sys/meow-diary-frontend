export default function ReadTab({ show }) {
  return (
    <div className="tab-placeholder" style={{ display: show ? 'flex' : 'none' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d4b8bc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
      <p className="tab-placeholder-text">阅读功能搭建中</p>
      <p className="tab-placeholder-emoji">🐾</p>
    </div>
  )
}

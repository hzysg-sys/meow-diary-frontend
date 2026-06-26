export default function MailTab({ show }) {
  return (
    <div className="tab-placeholder" style={{ display: show ? 'flex' : 'none' }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d4b8bc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <p className="tab-placeholder-text">信箱搭建中</p>
      <p className="tab-placeholder-emoji">🐾</p>
    </div>
  )
}

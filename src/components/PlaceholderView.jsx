import { BackIcon } from './icons'

export default function PlaceholderView({ show, title, onBack }) {
  return (
    <div id="placeholder" className={show ? 'show' : ''}>
      <div className="top-bar">
        <button onClick={onBack}>
          <BackIcon />
        </button>
        <div className="chat-title">{title}</div>
        <div style={{ width: 26 }} />
      </div>
      <div className="placeholder-body">
        <div className="placeholder-icon">✨</div>
        <p>这个板块正在搭建中，敬请期待</p>
      </div>
    </div>
  )
}

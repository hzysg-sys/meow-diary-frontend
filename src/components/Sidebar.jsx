import { FIXED_SESSION_ID, SIDEBAR_SESSIONS } from '../constants'
import { CloseIcon, PlusIcon, TrashIcon, SettingsIcon } from './icons'

export default function Sidebar({ open, onClose, onOpenSettings }) {
  return (
    <div id="sidebar" className={open ? 'open' : ''}>
      <div className="sidebar-header">
        <span>Meow Diary</span>
        <button onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <button className="new-chat-btn" onClick={onClose}>
        <PlusIcon />
        新建对话
      </button>
      <div id="session-list">
        {SIDEBAR_SESSIONS.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === FIXED_SESSION_ID ? 'active' : ''}`}
            onClick={onClose}
          >
            <div style={{ minWidth: 0 }}>
              <div className="session-name">{s.name}</div>
              <div className="session-time">{s.updatedAt}</div>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onOpenSettings}>
          <SettingsIcon />
          设置
        </button>
      </div>
    </div>
  )
}

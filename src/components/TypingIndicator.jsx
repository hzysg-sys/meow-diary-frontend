import Avatar from './Avatar'

export default function TypingIndicator() {
  return (
    <div className="msg-row assistant">
      <Avatar role="assistant" />
      <div className="msg-wrap">
        <div className="bubble">
          <div className="typing-dots">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { AI_AVATAR_URL, USER_AVATAR_URL } from '../constants'
import { AiAvatarFallback, UserAvatarFallback } from './icons'

export default function Avatar({ role }) {
  const isUser = role === 'user'
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div className={`avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`}>
      {!imgFailed && (
        <img
          className="avatar-img"
          alt=""
          referrerPolicy="no-referrer"
          src={isUser ? USER_AVATAR_URL : AI_AVATAR_URL}
          onError={() => setImgFailed(true)}
        />
      )}
      {imgFailed && (
        <div className="avatar-fallback" style={{ display: 'flex' }}>
          {isUser ? <UserAvatarFallback /> : <AiAvatarFallback />}
        </div>
      )}
    </div>
  )
}

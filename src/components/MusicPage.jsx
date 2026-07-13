import { useState } from 'react'
import { BackIcon } from './icons'

const MUSIC_URL = import.meta.env.VITE_MUSIC_URL || 'http://localhost:4183/pkg/index.html'

export default function MusicPage({ show, onBack }) {
  const [loaded, setLoaded] = useState(false)

  return (
    <div id="music-page" className={show ? 'show' : ''} aria-hidden={!show}>
      <div className="music-shell-bar">
        <button className="music-shell-back" onClick={onBack} aria-label="返回主页">
          <BackIcon />
          <span>主页</span>
        </button>
        <div className="music-shell-title">
          <strong>Duetto</strong>
          <span>和 Elias 一起听</span>
        </div>
        <a
          className="music-shell-open"
          href={MUSIC_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="在新窗口打开音乐页"
        >
          ↗
        </a>
      </div>

      {!loaded && <div className="music-shell-loading">正在把唱片放上去…</div>}
      <iframe
        className={`music-frame${loaded ? ' loaded' : ''}`}
        src={MUSIC_URL}
        title="Duetto 一起听"
        allow="autoplay; encrypted-media"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

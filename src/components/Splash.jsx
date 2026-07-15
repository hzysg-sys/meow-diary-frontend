import { useState } from 'react'
import { HeartIcon } from './icons'

export default function Splash({ onEnter }) {
  const [fadingOut, setFadingOut] = useState(false)

  function handleClick() {
    setFadingOut(true)
    setTimeout(onEnter, 500)
  }

  return (
    <div id="splash" className={fadingOut ? 'fade-out' : ''} onClick={handleClick}>
      <div className="petal p1" />
      <div className="petal p2" />
      <div className="petal p3" />
      <div className="petal p4" />
      <div className="dotted-line" style={{ position: 'absolute', top: 40 }} />
      <div className="splash-content">
        <HeartIcon />
        <p className="quote-en">I didn&apos;t call it fate until I met you.</p>
        <p className="quote-cn">直到和你相遇那刻，我才称之为命运。</p>
        <h1 className="brand-title">Meow Diary</h1>
        <p className="tap-hint">点击屏幕进入</p>
      </div>
      <div className="dotted-line" style={{ position: 'absolute', bottom: 40 }} />
    </div>
  )
}

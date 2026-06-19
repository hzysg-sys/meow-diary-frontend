import { useState } from 'react'
import './App.css'
import Splash from './components/Splash'
import Home from './components/Home'
import PlaceholderView from './components/PlaceholderView'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatView from './components/ChatView'

const VIEW = {
  SPLASH: 'splash',
  HOME: 'home',
  CHAT: 'chat',
  PLACEHOLDER: 'placeholder',
}

function App() {
  const [view, setView] = useState(VIEW.SPLASH)
  const [placeholderTitle, setPlaceholderTitle] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  function goHome() {
    setView(VIEW.HOME)
  }
  function goChat() {
    setView(VIEW.CHAT)
  }
  function goPlaceholder(title) {
    setPlaceholderTitle(title)
    setView(VIEW.PLACEHOLDER)
  }

  return (
    <>
      {view === VIEW.SPLASH && <Splash onEnter={goHome} />}

      <Home show={view === VIEW.HOME} onOpenChat={goChat} onOpenPlaceholder={goPlaceholder} />

      <PlaceholderView show={view === VIEW.PLACEHOLDER} title={placeholderTitle} onBack={goHome} />

      <div id="app" className={view === VIEW.CHAT ? 'show' : ''}>
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={() => {
            setSidebarOpen(false)
            setSettingsOpen(true)
          }}
        />
        <ChatView
          onBack={goHome}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <div id="overlay" className={sidebarOpen ? 'show' : ''} onClick={() => setSidebarOpen(false)} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

export default App

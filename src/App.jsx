import { useState } from 'react'
import './App.css'
import Splash from './components/Splash'
import Home from './components/Home'
import PlaceholderView from './components/PlaceholderView'
import MemoryPage from './components/MemoryPage'
import SessionListPage from './components/SessionListPage'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatView from './components/ChatView'
import { fetchSessions, createSession } from './api'

const VIEW = {
  SPLASH: 'splash',
  HOME: 'home',
  CHAT: 'chat',
  PLACEHOLDER: 'placeholder',
  MEMORY: 'memory',
  SESSIONS: 'sessions',
}

function App() {
  const [view, setView] = useState(VIEW.SPLASH)
  const [placeholderTitle, setPlaceholderTitle] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState(null)

  function goHome() {
    setView(VIEW.HOME)
  }
  async function goChat() {
    if (currentSessionId == null) {
      try {
        const sessions = await fetchSessions()
        const session = sessions[0] ?? (await createSession())
        setCurrentSessionId(session.id)
      } catch (err) {
        console.error('加载会话失败:', err)
        return
      }
    }
    setView(VIEW.CHAT)
  }
  function goPlaceholder(title) {
    setPlaceholderTitle(title)
    setView(VIEW.PLACEHOLDER)
  }
  function goMemory() {
    setView(VIEW.MEMORY)
  }

  return (
    <>
      {view === VIEW.SPLASH && <Splash onEnter={goHome} />}

      <Home show={view === VIEW.HOME} onOpenChat={goChat} onOpenPlaceholder={goPlaceholder} onOpenMemory={goMemory} />

      <PlaceholderView show={view === VIEW.PLACEHOLDER} title={placeholderTitle} onBack={goHome} />

      <MemoryPage show={view === VIEW.MEMORY} onBack={goHome} />

      {view === VIEW.SESSIONS && (
        <SessionListPage
          onSelectSession={(id) => {
            setCurrentSessionId(id)
            setView(VIEW.CHAT)
          }}
          onBack={goHome}
        />
      )}

      <div id="app" className={view === VIEW.CHAT ? 'show' : ''}>
        <Sidebar
          open={sidebarOpen}
          currentSessionId={currentSessionId}
          onSessionChange={(id) => setCurrentSessionId(id)}
          onClose={() => setSidebarOpen(false)}
          onOpenSettings={() => {
            setSidebarOpen(false)
            setSettingsOpen(true)
          }}
        />
        <ChatView
          key={currentSessionId}
          active={view === VIEW.CHAT}
          sessionId={currentSessionId}
          onBack={() => setView(VIEW.SESSIONS)}
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

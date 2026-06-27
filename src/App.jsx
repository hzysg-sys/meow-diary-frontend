import { useState } from 'react'
import './App.css'
import Splash from './components/Splash'
import Home from './components/Home'
import PlaceholderView from './components/PlaceholderView'
import MemoryPage from './components/MemoryPage'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatView from './components/ChatView'
import TabBar from './components/TabBar'
import ChatListTab from './components/ChatListTab'
import HealthTab from './components/HealthTab'
import MailTab from './components/MailTab'
import ReadTab from './components/ReadTab'
import { fetchSessions, createSession } from './api'

const VIEW = {
  SPLASH: 'splash',
  MAIN: 'main',
  CHAT: 'chat',
  PLACEHOLDER: 'placeholder',
  MEMORY: 'memory',
}

function App() {
  const [view, setView] = useState(VIEW.SPLASH)
  const [activeTab, setActiveTab] = useState('home')
  const [placeholderTitle, setPlaceholderTitle] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState(null)

  function goMain(tab = 'home') {
    setActiveTab(tab)
    setView(VIEW.MAIN)
  }

  async function goChat(sessionId) {
    if (sessionId != null) {
      setCurrentSessionId(sessionId)
      setView(VIEW.CHAT)
      return
    }
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

  const showMain = view === VIEW.MAIN

  return (
    <>
      {view === VIEW.SPLASH && <Splash onEnter={() => goMain('home')} />}

      {/* 主视图：Tab Bar + 各 tab 内容 */}
      <div id="main-view" className={showMain ? 'show' : ''}>
        <div className="main-content">
          <Home
            show={activeTab === 'home'}
            onOpenChat={goChat}
            onOpenPlaceholder={goPlaceholder}
            onOpenMemory={goMemory}
          />
          <ChatListTab show={activeTab === 'chat'} />
          <HealthTab active={activeTab === 'health'} onNavigateToChat={(sid) => goChat(sid)} />
          <MailTab show={activeTab === 'mail'} />
          <ReadTab show={activeTab === 'read'} />
        </div>
        <TabBar
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab === 'chat') {
              goChat()
            } else {
              setActiveTab(tab)
            }
          }}
        />
      </div>

      <PlaceholderView show={view === VIEW.PLACEHOLDER} title={placeholderTitle} onBack={() => goMain('home')} />

      <MemoryPage show={view === VIEW.MEMORY} onBack={() => goMain('home')} />

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
          onBack={() => goMain('home')}
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

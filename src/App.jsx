import { useState, useEffect, lazy, Suspense } from 'react'
import './App.css'
import Splash from './components/Splash'
import Home from './components/Home'
import EnergyPage from './components/EnergyPage'
import MomentsPage from './components/MomentsPage'
import Sidebar from './components/Sidebar'
import SettingsModal from './components/SettingsModal'
import ChatView from './components/ChatView'
import TabBar from './components/TabBar'
import ChatListTab from './components/ChatListTab'
import HealthTab from './components/HealthTab'
import MailTab from './components/MailTab'
// epub.js 体积大，阅读模块单独分包按需加载
const ReadTab = lazy(() => import('./components/ReadTab'))
// Duetto 只有第一次打开音乐模块时才加载；退出后保留 iframe，音乐可以继续播放。
const MusicPage = lazy(() => import('./components/MusicPage'))
import { fetchSessions, createSession } from './api'
import { resubscribeIfGranted } from './push'

const VIEW = {
  SPLASH: 'splash',
  MAIN: 'main',
  CHAT: 'chat',
  ENERGY: 'energy',
  MOMENTS: 'moments',
  MUSIC: 'music',
}

function App() {
  const [view, setView] = useState(VIEW.SPLASH)
  const [activeTab, setActiveTab] = useState('home')
  const [musicOpened, setMusicOpened] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState(null)

  // 已授权通知的设备静默续订推送
  useEffect(() => {
    resubscribeIfGranted()
  }, [])

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

  function goMusic() {
    setMusicOpened(true)
    setView(VIEW.MUSIC)
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
            onOpenMusic={goMusic}
            onOpenEnergy={() => setView(VIEW.ENERGY)}
            onOpenMoments={() => setView(VIEW.MOMENTS)}
          />
          <ChatListTab show={activeTab === 'chat'} />
          <HealthTab active={activeTab === 'health'} onNavigateToChat={(sid) => goChat(sid)} />
          <MailTab show={activeTab === 'mail'} />
          <Suspense fallback={null}>
            <ReadTab active={activeTab === 'read'} sessionId={currentSessionId} />
          </Suspense>
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

      <EnergyPage show={view === VIEW.ENERGY} onBack={() => goMain('home')} />

      <MomentsPage show={view === VIEW.MOMENTS} onBack={() => goMain('home')} />

      {musicOpened && (
        <Suspense fallback={null}>
          <MusicPage show={view === VIEW.MUSIC} onBack={() => goMain('home')} />
        </Suspense>
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

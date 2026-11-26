import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Landing from './pages/Landing'
import AuthPage from './pages/AuthPage'
import ChatApp from './pages/ChatApp'
import PwaInstallPrompt from './components/PwaInstallPrompt'

function LoadingScreen() {
  return (
    <div className="min-h-full flex items-center justify-center bg-[var(--bg)]">
      <div className="text-[var(--muted)]">Loading…</div>
    </div>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth()
  if (loading) return <LoadingScreen />
  if (!configured) return <Navigate to="/" replace />
  if (!user) return <Navigate to="/auth" replace />
  return <>{children}</>
}

/** Home: logged-in users go straight to chat; others see landing. */
function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user) return <Navigate to="/app" replace />
  return <Landing />
}

/** Auth page: already signed in → chat. */
function AuthRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (user) return <Navigate to="/app" replace />
  return <AuthPage />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/auth" element={<AuthRoute />} />
          <Route
            path="/app/*"
            element={
              <Protected>
                <ChatApp />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {/* Browser only — hidden automatically when opened as installed PWA */}
        <PwaInstallPrompt />
      </BrowserRouter>
    </AuthProvider>
  )
}

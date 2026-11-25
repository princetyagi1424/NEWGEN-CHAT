import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import Landing from './pages/Landing'
import AuthPage from './pages/AuthPage'
import ChatApp from './pages/ChatApp'
import PwaInstallPrompt from './components/PwaInstallPrompt'

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth()
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--muted)]">Loading…</div>
      </div>
    )
  }
  if (!configured) return <Navigate to="/" replace />
  if (!user) return <Navigate to="/auth" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<AuthPage />} />
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

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MessageCircle } from 'lucide-react'

export default function AuthPage() {
  const { signIn, signUp, configured, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) navigate('/app', { replace: true })

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') {
        const res = await signIn(email, password)
        if (res.error) setError(res.error)
        else navigate('/app')
      } else {
        const res = await signUp(username, email, password)
        if (res.error) setError(res.error)
        else navigate('/app')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold text-xl">
            <MessageCircle className="w-7 h-7 text-[var(--accent)]" />
            NEWGEN CHAT
          </Link>
          <p className="text-sm text-[var(--muted)] mt-2">
            {mode === 'signin' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>
        {!configured && (
          <div className="mb-4 p-3 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 text-sm text-[var(--warning)]">
            Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </div>
        )}
        <form onSubmit={onSubmit} className="space-y-4 p-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">Username</label>
              <input className="w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
            </div>
          )}
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Email</label>
            <input type="email" className="w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Password</label>
            <input type="password" className="w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <div className="text-sm text-[var(--danger)]">{error}</div>}
          <button type="submit" disabled={busy || !configured} className="w-full py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white font-medium">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-[var(--muted)] mt-6">
          {mode === 'signin' ? (
            <>No account? <button type="button" className="text-[var(--accent)]" onClick={() => setMode('signup')}>Sign up</button></>
          ) : (
            <>Have an account? <button type="button" className="text-[var(--accent)]" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  )
}

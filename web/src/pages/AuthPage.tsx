import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MessageCircle } from 'lucide-react'

export default function AuthPage() {
  const { signIn, signUp, configured, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup' | 'recover'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) navigate('/app', { replace: true })

  async function recoverAccount(username: string, answer: string, nextPassword: string) {
    const response = await fetch(`${((import.meta as any).env?.VITE_API_URL as string | undefined || '').replace(/\\/$/, '')}/api/auth/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim(), securityAnswer: answer, newPassword: nextPassword }) })
    const data = await response.json().catch(() => ({}))
    return { error: response.ok ? null : (data.error || 'Account recovery failed') }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      const result = mode === 'signin'
        ? await signIn(username, password)
        : mode === 'signup'
          ? await signUp(username, password, securityAnswer)
          : await recoverAccount(username, securityAnswer, newPassword)

      if (result.error) setError(result.error)
      else if (mode === 'recover') { setInfo('Password reset successfully. Sign in with your new password.'); setMode('signin'); setSecurityAnswer(''); setNewPassword('') }
      else navigate('/app')
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
            {mode === 'signin' ? 'Sign in with your username' : mode === 'signup' ? 'Create your NEWGEN CHAT account' : 'Recover your account'}
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 p-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Username</label>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={24}
              pattern="[A-Za-z0-9_]+"
              title="Use 3–24 letters, numbers, or underscores."
            />
            <p className="text-xs text-[var(--muted)] mt-1">3–24 characters: letters, numbers, and underscore.</p>
          </div>
          {mode !== 'recover' && <div>
            <label className="block text-xs text-[var(--muted)] mb-1.5">Password</label>
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
            />
          </div>}
          {mode !== 'signin' && (
            <div>
              <label className="block text-xs text-[var(--muted)] mb-1.5">Security question · Account recovery</label>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-sm">What was the name of your first school?</div>
              <input type="text" autoComplete="off" className="mt-2 w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" placeholder="Your answer" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} required minLength={2} maxLength={100} />
              <p className="text-xs text-[var(--muted)] mt-1">Your answer is hashed. It can reset your account password, not decrypt chats.</p>
              {mode === 'recover' && <input type="password" autoComplete="new-password" className="mt-2 w-full px-3 py-2.5 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" placeholder="New password (10+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={10} />}
            </div>
          )}
          {error && <div role="alert" className="text-sm text-[var(--danger)]">{error}</div>}
          {info && <div role="status" className="text-sm text-[var(--success)]">{info}</div>}
          <button type="submit" disabled={busy || !configured || (mode !== 'signin' && securityAnswer.trim().length < 2) || (mode === 'recover' && newPassword.length < 10)} className="w-full py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white font-medium">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
          </button>
        </form>
        <p className="text-center text-sm text-[var(--muted)] mt-6">
          {mode === 'signin' ? (
            <>No account? <button type="button" className="text-[var(--accent)]" onClick={() => { setError(null); setSecurityAnswer(''); setMode('signup') }}>Create account</button> · <button type="button" className="text-[var(--accent)]" onClick={() => { setError(null); setSecurityAnswer(''); setMode('recover') }}>Forgot password?</button></>
          ) : (
            <>Back to <button type="button" className="text-[var(--accent)]" onClick={() => { setError(null); setSecurityAnswer(''); setMode('signin') }}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  )
}

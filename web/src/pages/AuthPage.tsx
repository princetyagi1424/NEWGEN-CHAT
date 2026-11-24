import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MessageCircle, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react'

export default function AuthPage() {
  const { signIn, signUp, configured, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup' | 'recover'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) navigate('/app', { replace: true })

  async function recoverAccount(name: string, answer: string, nextPassword: string) {
    const response = await fetch('/api/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name.trim(), securityAnswer: answer, newPassword: nextPassword }) })
    const data = await response.json().catch(() => ({}))
    return { error: response.ok ? null : (data.error || 'Account recovery failed') }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setInfo(null); setBusy(true)
    try {
      const result = mode === 'signin' ? await signIn(username, password) : mode === 'signup' ? await signUp(username, password, securityAnswer) : await recoverAccount(username, securityAnswer, newPassword)
      if (result.error) setError(result.error)
      else if (mode === 'recover') { setInfo('Password reset successfully. Sign in with your new password.'); setMode('signin'); setSecurityAnswer(''); setNewPassword('') }
      else navigate('/app')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  const title = mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Recover your account'
  return (
    <div className="relative flex h-[100dvh] min-h-0 items-start justify-center overflow-y-auto bg-[#f8f5ff] p-4 py-8 text-[#211a35] sm:items-center sm:py-10">
      <div className="pointer-events-none absolute -left-28 top-0 h-80 w-80 rounded-full bg-fuchsia-200/50 blur-3xl"/>
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-violet-200/60 blur-3xl"/>
      <div className="relative grid w-full max-w-5xl shrink-0 overflow-hidden rounded-[24px] border border-white bg-white shadow-[0_24px_72px_rgba(73,42,125,.12)] sm:rounded-[32px] md:min-h-[620px] md:grid-cols-[.9fr_1.1fr]">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#30204f] via-violet-800 to-fuchsia-600 p-10 text-white md:flex">
          <div className="absolute -right-24 top-20 h-72 w-72 rounded-full border-[38px] border-white/5"/>
          <div className="relative"><Link to="/" className="inline-flex items-center gap-3 text-lg font-black tracking-tight"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/15"><MessageCircle className="h-5 w-5"/></span>NEWGEN CHAT</Link></div>
          <div className="relative"><p className="text-xs font-black uppercase tracking-[.24em] text-fuchsia-200">Your private circle</p><h1 className="mt-4 text-5xl font-black leading-[1.05] tracking-tight">Good chats.<br/>Great energy.</h1><p className="mt-5 max-w-sm text-sm leading-7 text-white/65">Connect with your people in a space designed around conversations, community and privacy.</p><div className="mt-9 flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur"><ShieldCheck className="h-6 w-6 shrink-0 text-fuchsia-200"/><span className="text-xs font-semibold leading-5 text-white/80">Your chats stay locked until you unlock them.</span></div></div>
          <p className="relative text-[10px] font-bold uppercase tracking-[.18em] text-white/40">A more personal way to message</p>
        </aside>
        <section className="flex flex-col justify-center p-6 sm:p-10 md:p-12">
          <Link to="/" className="mb-8 inline-flex w-fit items-center gap-2 text-xs font-bold text-slate-400 transition hover:text-violet-700"><ArrowLeft className="h-4 w-4"/>Back to home</Link>
          <div className="mb-8"><span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-lg shadow-fuchsia-200 md:hidden"><MessageCircle className="h-6 w-6"/></span><p className="text-xs font-black uppercase tracking-[.2em] text-violet-600">NEWGEN CHAT</p><h2 className="mt-2 text-3xl font-black tracking-tight">{title}</h2><p className="mt-2 text-sm text-slate-500">{mode === 'signin' ? 'Sign in with your username to continue.' : mode === 'signup' ? 'Set up your account and join your circle.' : 'Use your recovery answer to reset your password.'}</p></div>
          <form onSubmit={onSubmit} className="space-y-5">
            <div><label htmlFor="username" className="mb-2 block text-xs font-bold text-slate-600">Username</label><input id="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" value={username} onChange={e=>setUsername(e.target.value)} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" title="Use 3–24 letters, numbers, or underscores."/><p className="mt-2 text-[11px] text-slate-400">3–24 characters · letters, numbers and underscore</p></div>
            {mode !== 'recover' && <div><label htmlFor="password" className="mb-2 block text-xs font-bold text-slate-600">Password</label><div className="relative"><input id="password" type={showPassword?'text':'password'} autoComplete={mode==='signin'?'current-password':'new-password'} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 pr-12 text-sm outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" value={password} onChange={e=>setPassword(e.target.value)} required minLength={10}/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:bg-violet-50 hover:text-violet-700">{showPassword?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button></div></div>}
            {mode !== 'signin' && <div><label className="mb-2 block text-xs font-bold text-slate-600">Security question · Account recovery</label><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">What was the name of your first school?</div><input type="text" autoComplete="off" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" placeholder="Your answer" value={securityAnswer} onChange={e=>setSecurityAnswer(e.target.value)} required minLength={2} maxLength={100}/><p className="mt-2 text-[11px] leading-5 text-slate-400">Your answer is hashed. It can reset your account password, not decrypt chats.</p>{mode==='recover'&&<input type="password" autoComplete="new-password" className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100" placeholder="New password (10+ characters)" value={newPassword} onChange={e=>setNewPassword(e.target.value)} required minLength={10}/>}</div>}
            {error&&<div role="alert" className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">{error}</div>}
            {info&&<div role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">{info}</div>}
            {!configured&&<div role="status" className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">Supabase is not configured. Authentication is unavailable.</div>}
            <button type="submit" disabled={busy||!configured||(mode!=='signin'&&securityAnswer.trim().length<2)||(mode==='recover'&&newPassword.length<10)} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 py-4 text-sm font-extrabold text-white shadow-lg shadow-fuchsia-200/70 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0">{busy?'Please wait…':mode==='signin'?'Sign in':mode==='signup'?'Create account':'Reset password'}<ArrowUpRightIcon/></button>
          </form>
          <p className="mt-7 text-center text-xs text-slate-500">{mode==='signin'?<>No account? <button type="button" className="font-bold text-violet-700 hover:underline" onClick={()=>{setError(null);setInfo(null);setSecurityAnswer('');setMode('signup')}}>Create account</button> · <button type="button" className="font-bold text-violet-700 hover:underline" onClick={()=>{setError(null);setInfo(null);setSecurityAnswer('');setMode('recover')}}>Forgot password?</button></>:<>Back to <button type="button" className="font-bold text-violet-700 hover:underline" onClick={()=>{setError(null);setInfo(null);setSecurityAnswer('');setMode('signin')}}>Sign in</button></>}</p>
        </section>
      </div>
    </div>
  )
}

function ArrowUpRightIcon() {
  return <span aria-hidden="true" className="text-base">↗</span>
}

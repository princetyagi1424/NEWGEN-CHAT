import { useRef, useState } from 'react'
import { ArrowLeft, Camera, KeyRound, LogOut, ShieldCheck, Trash2 } from 'lucide-react'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import { AVATAR_OPTIONS, imageFileToDataUrl } from '../lib/image'

interface Props { onBack: () => void; onOpenPin: () => void }

export default function ProfilePanel({ onBack, onOpenPin }: Props) {
  const { profile, updateProfile, signOut, signOutAll } = useAuth()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [busy, setBusy] = useState<'name' | 'photo' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!profile) return null

  const trimmed = name.trim()
  const nameChanged = trimmed.length > 0 && trimmed !== profile.display_name

  async function saveName() {
    setBusy('name'); setMessage(null)
    try { await updateProfile({ display_name: trimmed }); setMessage({ kind: 'ok', text: 'Name updated.' }) }
    catch (cause) { setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Could not update your name.' }) }
    finally { setBusy(null) }
  }

  async function changePhoto(file: File | undefined) {
    if (!file) return
    setBusy('photo'); setMessage(null)
    try {
      const avatar = await imageFileToDataUrl(file, AVATAR_OPTIONS)
      await updateProfile({ avatar })
      setMessage({ kind: 'ok', text: 'Profile photo updated.' })
    } catch (cause) { setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Could not update your photo.' }) }
    finally { setBusy(null) }
  }

  async function removePhoto() {
    setBusy('photo'); setMessage(null)
    try { await updateProfile({ avatar: null }); setMessage({ kind: 'ok', text: 'Photo removed.' }) }
    catch (cause) { setMessage({ kind: 'error', text: cause instanceof Error ? cause.message : 'Could not remove your photo.' }) }
    finally { setBusy(null) }
  }

  const row = 'flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition hover:bg-slate-50'

  return (
    <section className="flex flex-1 flex-col overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-[480px] px-5 pb-10 pt-4">
        <button type="button" onClick={onBack} className="mb-2 flex items-center gap-2 rounded-xl py-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Back</button>
        <h1 className="text-3xl font-extrabold tracking-tight">Profile</h1>

        <div className="mt-8 flex flex-col items-center">
          <div className="relative">
            <Avatar name={profile.display_name} src={profile.avatar} size={112} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'photo'} aria-label="Change photo" className="brand-gradient absolute bottom-0 right-0 grid h-10 w-10 place-items-center rounded-full border-4 border-white text-white shadow-md transition hover:scale-105 disabled:opacity-60"><Camera className="h-4 w-4" /></button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={event => { void changePhoto(event.target.files?.[0]); event.target.value = '' }} />
          </div>
          <p className="mt-4 text-xl font-extrabold tracking-tight">{profile.display_name}</p>
          <p className="text-sm text-slate-400">@{profile.username}</p>
          {profile.avatar ? <button type="button" onClick={() => void removePhoto()} disabled={busy === 'photo'} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /> Remove photo</button> : null}
        </div>

        <form className="mt-8" onSubmit={event => { event.preventDefault(); if (nameChanged) void saveName() }}>
          <label htmlFor="display-name" className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">Display name</label>
          <div className="mt-2 flex gap-2">
            <input id="display-name" value={name} onChange={event => setName(event.target.value)} maxLength={40} autoComplete="off" placeholder={profile.username} className="min-w-0 flex-1 rounded-2xl bg-[#F3F4F7] px-4 py-3.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-violet-200" />
            <button type="submit" disabled={!nameChanged || busy === 'name'} className="brand-gradient rounded-2xl px-5 text-sm font-extrabold text-white transition disabled:opacity-35">{busy === 'name' ? '…' : 'Save'}</button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Friends see this name. Your @username stays {profile.username}.</p>
        </form>

        {message ? <p role="status" className={`mt-4 rounded-xl px-3 py-2 text-xs font-semibold ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{message.text}</p> : null}

        <div className="mt-8 space-y-1 border-t border-slate-100 pt-4">
          <button type="button" onClick={onOpenPin} className={row}><span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600"><KeyRound className="h-4 w-4" /></span>Set or change chat PIN</button>
          <button type="button" onClick={() => { if (window.confirm('Log out this account on every device?')) void signOutAll().catch(cause => window.alert(cause instanceof Error ? cause.message : 'Could not revoke all sessions.')) }} className={row}><span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600"><ShieldCheck className="h-4 w-4" /></span>Log out of all devices</button>
          <button type="button" onClick={() => void signOut()} className={`${row} text-rose-600`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-500"><LogOut className="h-4 w-4" /></span>Log out</button>
        </div>
      </div>
    </section>
  )
}

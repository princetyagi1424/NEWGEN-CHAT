import { useEffect, useRef, useState } from 'react'
import { Camera, Check, ImagePlus, LoaderCircle, Pencil, UserRound, X } from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'

function fileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image'))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

async function compressAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not process this image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not compress image')), 'image/webp', 0.82)
  })
  if (blob.size > 1024 * 1024) throw new Error('Image is still too large. Choose a smaller image.')
  return fileAsDataUrl(blob)
}

export default function ProfileEditor() {
  const { user, profile, refreshProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [removeAvatar, setRemoveAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDisplayName(profile?.display_name || profile?.username || user?.username || '')
    setBio(profile?.bio || '')
    setPreview(profile?.avatar_url || null)
    setAvatarDataUrl(null)
    setRemoveAvatar(false)
    setError('')
  }, [open, profile, user?.username])

  async function chooseImage(file?: File) {
    if (!file) return
    try {
      const dataUrl = await compressAvatar(file)
      setAvatarDataUrl(dataUrl)
      setPreview(dataUrl)
      setRemoveAvatar(false)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use this image.')
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = displayName.trim()
    if (name.length < 2 || name.length > 40) {
      setError('Name must be between 2 and 40 characters.')
      return
    }
    if (bio.trim().length > 160) {
      setError('Bio must be 160 characters or fewer.')
      return
    }
    const token = getAuthToken()
    if (!token) {
      setError('Your session has expired. Sign in again.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          display_name: name,
          bio: bio.trim(),
          ...(avatarDataUrl ? { avatarDataUrl } : {}),
          ...(removeAvatar ? { removeAvatar: true } : {}),
        }),
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not update your profile.')
      await refreshProfile()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Edit profile" aria-label="Edit profile" className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
        <Pencil className="h-3.5 w-3.5" /> Edit profile
      </button>
      {open && (
        <div className="newgen-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="profile-editor-title" className="newgen-dialog-panel max-w-[440px] rounded-[24px] border border-white/70 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4 sm:px-6">
              <div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-emerald-600">Your identity</p><h2 id="profile-editor-title" className="mt-1 text-xl font-black tracking-tight text-slate-900">Edit profile</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close profile editor" className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={saveProfile} className="space-y-4 p-5 sm:space-y-5 sm:p-6">
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="grid h-24 w-24 overflow-hidden place-items-center rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700 ring-4 ring-emerald-50">
                    {preview ? <img src={preview} alt="Profile preview" className="h-full w-full object-cover" /> : <UserRound className="h-9 w-9" />}
                  </div>
                  <button type="button" onClick={() => pickerRef.current?.click()} aria-label="Choose profile photo" className="absolute bottom-0 right-0 grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-emerald-600 text-white shadow-lg transition hover:bg-emerald-700"><Camera className="h-4 w-4" /></button>
                </div>
                <input ref={pickerRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void chooseImage(e.target.files?.[0]); e.currentTarget.value = '' }} />
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <button type="button" onClick={() => pickerRef.current?.click()} className="font-bold text-emerald-700 hover:text-emerald-800"><ImagePlus className="mr-1 inline h-3.5 w-3.5" /> Change photo</button>
                  {preview && <button type="button" onClick={() => { setPreview(null); setAvatarDataUrl(null); setRemoveAvatar(true) }} className="font-semibold text-slate-400 hover:text-rose-600">Remove</button>}
                </div>
                <p className="mt-1 text-[10px] text-slate-400">JPG, PNG or WebP · optimized before upload</p>
              </div>
              <label className="block space-y-2"><span className="text-xs font-bold text-slate-600">Display name</span><input required minLength={2} maxLength={40} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your name" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50" /></label>
              <label className="block space-y-2"><span className="text-xs font-bold text-slate-600">About you <span className="font-normal text-slate-400">(optional)</span></span><textarea rows={3} maxLength={160} value={bio} onChange={e => setBio(e.target.value)} placeholder="A little about yourself…" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50" /><span className="block text-right text-[10px] text-slate-400">{bio.length}/160</span></label>
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2"><button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Cancel</button><button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-700 disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? 'Saving…' : 'Save changes'}</button></div>
            </form>
          </section>
        </div>
      )}
    </>
  )
}

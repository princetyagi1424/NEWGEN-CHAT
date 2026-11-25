import { useRef, useState } from 'react'
import { Image as ImageIcon, Type, X } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { imageFileToDataUrl, STORY_OPTIONS } from '../lib/image'

const COLORS = ['#7C5CFF', '#FF5C9D', '#FF8A3D', '#00B8A9', '#3D8BFF', '#111318']

interface Props { onClose: () => void; onPosted: () => void }

export default function StoryComposer({ onClose, onPosted }: Props) {
  const [mode, setMode] = useState<'photo' | 'text'>('photo')
  const [photo, setPhoto] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [bg, setBg] = useState(COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    setError('')
    try { setPhoto(await imageFileToDataUrl(file, STORY_OPTIONS)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not use this image.') }
  }

  async function share() {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/stories', {
        method: 'POST',
        body: JSON.stringify(mode === 'photo' ? { kind: 'image', media: photo, caption } : { kind: 'text', caption, bg }),
      })
      onPosted()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share your story.')
    } finally { setBusy(false) }
  }

  const ready = mode === 'photo' ? Boolean(photo) : caption.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 backdrop-blur-sm md:place-items-center" role="dialog" aria-label="Create story">
      <div className="w-full max-w-[460px] overflow-hidden rounded-t-[28px] bg-white shadow-2xl md:rounded-[28px]">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-lg font-extrabold tracking-tight">New story</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mx-5 mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#F3F4F7] p-1">
          {([['photo', 'Photo', ImageIcon], ['text', 'Text', Type]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setMode(key)} className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${mode === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Icon className="h-4 w-4" />{label}</button>
          ))}
        </div>

        <div className="p-5">
          {mode === 'photo' ? (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={event => { void choose(event.target.files?.[0]); event.target.value = '' }} />
              {photo ? (
                <div className="relative overflow-hidden rounded-3xl bg-black">
                  <img src={photo} alt="Story preview" className="mx-auto max-h-[46dvh] w-full object-contain" />
                  <button type="button" onClick={() => fileRef.current?.click()} className="absolute bottom-3 right-3 rounded-full bg-white/90 px-3.5 py-2 text-xs font-bold shadow">Change</button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="grid h-60 w-full place-items-center rounded-3xl border-2 border-dashed border-slate-200 bg-[#FAFAFC] text-slate-400 transition hover:border-violet-300 hover:text-violet-500">
                  <span className="text-center"><ImageIcon className="mx-auto h-8 w-8" /><span className="mt-2 block text-sm font-bold">Choose a photo</span><span className="block text-xs">It disappears after 24 hours</span></span>
                </button>
              )}
              <input value={caption} onChange={event => setCaption(event.target.value)} maxLength={220} placeholder="Add a caption (optional)" className="mt-3 w-full rounded-2xl bg-[#F3F4F7] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-200" />
            </>
          ) : (
            <>
              <div className="grid h-60 place-items-center overflow-hidden rounded-3xl p-6 text-center" style={{ background: `linear-gradient(160deg, ${bg}, ${bg}cc)` }}>
                <textarea value={caption} onChange={event => setCaption(event.target.value)} maxLength={220} placeholder="Type something…" rows={4} className="w-full resize-none bg-transparent text-center text-2xl font-extrabold leading-tight tracking-tight text-white outline-none placeholder:text-white/60" />
              </div>
              <div className="mt-3 flex items-center justify-center gap-2.5">
                {COLORS.map(color => (
                  <button key={color} type="button" onClick={() => setBg(color)} aria-label={`Background ${color}`} className={`h-8 w-8 rounded-full transition ${bg === color ? 'scale-110 ring-2 ring-offset-2 ring-slate-900' : ''}`} style={{ background: color }} />
                ))}
              </div>
            </>
          )}
          {error ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{error}</p> : null}
          <button type="button" onClick={() => void share()} disabled={!ready || busy} className="brand-gradient mt-4 w-full rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition disabled:opacity-40">{busy ? 'Sharing…' : 'Share to story'}</button>
        </div>
      </div>
    </div>
  )
}

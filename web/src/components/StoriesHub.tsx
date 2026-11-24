import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Camera, ChevronLeft, ChevronRight, Clock3, ImagePlus, LoaderCircle, Plus, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'

type StoryAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null; bio?: string | null }
type Story = { id: string; user_id: string; story_type: 'text' | 'image'; caption: string; media_url: string | null; created_at: string; expires_at: string; author: StoryAuthor }

async function compressStoryImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not process this image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not compress image')), 'image/webp', 0.8)
  })
  if (blob.size > 2 * 1024 * 1024) throw new Error('Image is still too large. Choose a smaller image.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read image'))
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(blob)
  })
}

function Avatar({ author, size = 'h-14 w-14' }: { author: StoryAuthor; size?: string }) {
  return <span className={size + ' grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 text-lg font-black text-emerald-700 ring-2 ring-white'}>{author.avatar_url ? <img src={author.avatar_url} alt="" className="h-full w-full object-cover" /> : (author.display_name || author.username || '?').slice(0, 1).toUpperCase()}</span>
}

export default function StoriesHub() {
  const { user, profile } = useAuth()
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  const apiRequest = useCallback(async (method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
    const token = getAuthToken()
    if (!token) throw new Error('Please sign in again.')
    const response = await fetch('/api/stories', {
      method,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Could not load stories.')
    return data
  }, [])

  const loadStories = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiRequest('GET')
      setStories(Array.isArray(data.stories) ? data.stories : [])
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load stories.')
    } finally {
      setLoading(false)
    }
  }, [apiRequest])

  useEffect(() => { void loadStories() }, [loadStories])

  const groups = useMemo(() => {
    const map = new Map<string, { author: StoryAuthor; stories: Story[] }>()
    for (const story of stories) {
      const current = map.get(story.user_id) || { author: story.author, stories: [] }
      current.stories.push(story)
      map.set(story.user_id, current)
    }
    return Array.from(map.entries()).map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => a.id === user?.id ? -1 : b.id === user?.id ? 1 : new Date(b.stories[0].created_at).getTime() - new Date(a.stories[0].created_at).getTime())
  }, [stories, user?.id])

  const flatStories = useMemo(() => groups.flatMap(group => group.stories.map(story => ({ ...story, groupId: group.id }))), [groups])
  const activeStory = activeIndex === null ? null : flatStories[activeIndex]

  async function chooseImage(file?: File) {
    if (!file) return
    try {
      const data = await compressStoryImage(file)
      setImageDataUrl(data)
      setImagePreview(data)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use this image.')
    }
  }

  async function publishStory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!caption.trim() && !imageDataUrl) { setError('Add a short note or choose a photo.'); return }
    setSaving(true)
    setError('')
    try {
      await apiRequest('POST', { caption: caption.trim(), ...(imageDataUrl ? { imageDataUrl } : {}) })
      setCaption('')
      setImageDataUrl(null)
      setImagePreview(null)
      setComposerOpen(false)
      await loadStories()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish story.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteStory(story: Story) {
    if (!window.confirm('Delete this story?')) return
    try {
      await apiRequest('DELETE', { id: story.id })
      setActiveIndex(null)
      await loadStories()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete story.')
    }
  }

  function resetComposer() {
    setComposerOpen(false)
    setCaption('')
    setImageDataUrl(null)
    setImagePreview(null)
    setError('')
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-extrabold uppercase tracking-[.2em] text-emerald-600">Your circle</p><h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Stories</h2><p className="mt-1 text-sm text-slate-400">Little moments, shared with your people.</p></div>
        <button type="button" onClick={() => { setComposerOpen(true); setError('') }} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-extrabold text-white shadow-lg shadow-emerald-100 transition hover:-translate-y-0.5 hover:bg-emerald-700"><Plus className="h-4 w-4" /> Add story</button>
      </div>

      <div className="mb-5 rounded-[24px] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4">
        <div className="flex items-center gap-3">
          <div className="relative"><Avatar author={{ id: user?.id || '', username: profile?.username || 'you', display_name: profile?.display_name || 'You', avatar_url: profile?.avatar_url || null }} /><span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-emerald-600 text-white"><Plus className="h-3.5 w-3.5" /></span></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-slate-800">Your story</p><p className="text-xs text-slate-500">Share a photo or a quick thought</p></div>
          <button type="button" onClick={() => { setComposerOpen(true); setError('') }} className="rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Create</button>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-extrabold text-slate-800">From your circle</h3><span className="text-[11px] text-slate-400">24-hour stories</span></div>
      {loading ? <div className="flex items-center justify-center gap-2 py-10 text-xs font-semibold text-slate-400"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading stories…</div> :
        groups.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-emerald-600 shadow-sm"><Camera className="h-5 w-5" /></div><p className="mt-3 text-sm font-bold text-slate-700">Your story space is quiet</p><p className="mx-auto mt-1 max-w-[240px] text-xs leading-5 text-slate-400">Share the first photo or thought. Stories from accepted connections will appear here too.</p></div> :
        <div className="grid grid-cols-2 gap-3">
          {groups.map(group => <button key={group.id} type="button" onClick={() => { const index = flatStories.findIndex(item => item.groupId === group.id); if (index >= 0) setActiveIndex(index) }} className="group rounded-[22px] border border-slate-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-100 hover:shadow-md">
            <div className="flex items-center gap-2"><span className="rounded-full bg-gradient-to-tr from-emerald-400 via-teal-400 to-cyan-400 p-[2px]"><Avatar author={group.author} size="h-10 w-10" /></span><span className="min-w-0"><span className="block truncate text-xs font-extrabold text-slate-800">{group.id === user?.id ? 'Your story' : group.author.display_name || group.author.username}</span><span className="block text-[10px] text-slate-400">{group.stories.length} moment{group.stories.length === 1 ? '' : 's'}</span></span></div>
            <div className="mt-3 h-28 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50">
              {group.stories[0].media_url ? <img src={group.stories[0].media_url} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center px-3 text-center text-sm font-semibold leading-5 text-emerald-800">{group.stories[0].caption}</div>}
            </div>
            <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400"><Clock3 className="h-3 w-3" /> {formatDistanceToNow(new Date(group.stories[0].created_at), { addSuffix: true })}</p>
          </button>)}
        </div>}
      {error && !composerOpen && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-3"><p className="flex items-center gap-2 text-[11px] font-bold text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Shared with accepted connections only</p><p className="mt-1 text-[10px] leading-4 text-slate-400">Stories expire after 24 hours. Story content is protected by friend-only access controls, but is not end-to-end encrypted in this browser version.</p></div>

      {composerOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) resetComposer() }}>
        <section role="dialog" aria-modal="true" aria-labelledby="story-composer-title" className="w-full max-w-[470px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-emerald-600">A little moment</p><h3 id="story-composer-title" className="mt-1 text-lg font-black text-slate-900">Create a story</h3></div><button type="button" onClick={resetComposer} aria-label="Close" className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
          <form onSubmit={publishStory} className="space-y-4 p-6">
            {imagePreview ? <div className="relative h-56 overflow-hidden rounded-2xl bg-slate-100"><img src={imagePreview} alt="Story preview" className="h-full w-full object-contain" /><button type="button" onClick={() => { setImagePreview(null); setImageDataUrl(null) }} aria-label="Remove photo" className="absolute right-3 top-3 rounded-full bg-slate-950/60 p-2 text-white"><X className="h-4 w-4" /></button></div> : <button type="button" onClick={() => pickerRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-8 text-emerald-700 transition hover:bg-emerald-50"><ImagePlus className="h-7 w-7" /><span className="text-sm font-bold">Add a photo</span><span className="text-[10px] text-emerald-600/70">Optional · JPG, PNG or WebP</span></button>}
            <input ref={pickerRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { void chooseImage(e.target.files?.[0]); e.currentTarget.value = '' }} />
            <label className="block space-y-2"><span className="text-xs font-bold text-slate-600">Add a note <span className="font-normal text-slate-400">(optional with a photo)</span></span><textarea rows={3} maxLength={280} value={caption} onChange={e => setCaption(e.target.value)} placeholder="What's happening today?" className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50" /><span className="block text-right text-[10px] text-slate-400">{caption.length}/280</span></label>
            {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2"><button type="button" onClick={resetComposer} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600">Cancel</button><button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-100 disabled:opacity-50">{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{saving ? 'Sharing…' : 'Share story'}</button></div>
          </form>
        </section>
      </div>}

      {activeStory && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setActiveIndex(null) }}>
        <section role="dialog" aria-modal="true" aria-label="Story viewer" className="relative flex h-[min(820px,92dvh)] w-full max-w-[430px] flex-col overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-2xl">
          <div className="absolute left-0 right-0 top-0 z-10 p-4">
            <div className="mb-4 flex gap-1">{groups.find(g => g.id === activeStory.groupId)?.stories.map((_, i) => <span key={i} className="h-1 flex-1 rounded-full bg-white/25" />)}</div>
            <div className="flex items-center gap-3"><Avatar author={activeStory.author} size="h-10 w-10" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{activeStory.author.display_name || activeStory.author.username}</p><p className="text-[10px] text-white/65">{formatDistanceToNow(new Date(activeStory.created_at), { addSuffix: true })}</p></div>{activeStory.user_id === user?.id && <button type="button" onClick={() => void deleteStory(activeStory)} aria-label="Delete story" className="rounded-full bg-white/15 p-2 hover:bg-white/25"><Trash2 className="h-4 w-4" /></button>}<button type="button" onClick={() => setActiveIndex(null)} aria-label="Close story" className="rounded-full bg-white/15 p-2 hover:bg-white/25"><X className="h-4 w-4" /></button></div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-950 via-slate-950 to-indigo-950">
            {activeStory.media_url ? <img src={activeStory.media_url} alt="Story" className="max-h-full max-w-full object-contain" /> : <p className="max-w-[330px] px-8 text-center text-2xl font-extrabold leading-relaxed">{activeStory.caption}</p>}
          </div>
          {activeStory.media_url && activeStory.caption && <div className="absolute bottom-16 left-5 right-5 rounded-2xl bg-slate-950/55 px-4 py-3 text-center text-sm font-medium backdrop-blur">{activeStory.caption}</div>}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between"><button type="button" onClick={() => setActiveIndex(index => index === null ? null : Math.max(0, index - 1))} disabled={activeIndex === 0} aria-label="Previous story" className="rounded-full bg-white/15 p-3 hover:bg-white/25 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button><span className="text-[10px] font-semibold text-white/65">{(activeIndex || 0) + 1} / {flatStories.length}</span><button type="button" onClick={() => setActiveIndex(index => index === null ? null : Math.min(flatStories.length - 1, index + 1))} disabled={activeIndex === flatStories.length - 1} aria-label="Next story" className="rounded-full bg-white/15 p-3 hover:bg-white/25 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button></div>
        </section>
      </div>}
    </div>
  )
}

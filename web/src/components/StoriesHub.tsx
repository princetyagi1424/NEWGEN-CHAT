import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Plus, X } from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'

type StoryAuthor = { id: string; username: string; display_name: string | null; avatar_url: string | null; bio?: string | null }
type Story = {
  id: string
  user_id: string
  story_type: 'text' | 'image'
  caption: string
  media_url: string | null
  created_at: string
  expires_at?: string
  author: StoryAuthor
}

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
  return (
    <span className={size + ' grid shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 text-sm font-black text-emerald-700'}>
      {author.avatar_url
        ? <img src={author.avatar_url} alt="" className="h-full w-full object-cover" />
        : (author.display_name || author.username || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

export default function StoriesHub() {
  const { user, profile } = useAuth()
  const [stories, setStories] = useState<Story[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [caption, setCaption] = useState('')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const apiRequest = useCallback(async (method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
    const token = getAuthToken()
    if (!token) throw new Error('Please sign in again.')
    const response = await fetch('/api/me?resource=stories', {
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

  const otherGroups = useMemo(() => groups.filter(g => g.id !== user?.id), [groups, user?.id])
  const ownGroup = useMemo(() => groups.find(g => g.id === user?.id) || null, [groups, user?.id])

  const flatStories = useMemo(
    () => groups.flatMap(group => group.stories.map(story => ({ ...story, groupId: group.id }))),
    [groups],
  )
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

  function openGroup(groupId: string) {
    const index = flatStories.findIndex(s => s.groupId === groupId)
    if (index >= 0) setActiveIndex(index)
  }

  const selfAuthor: StoryAuthor = {
    id: user?.id || '',
    username: profile?.username || 'you',
    display_name: profile?.display_name || profile?.username || 'You',
    avatar_url: profile?.avatar_url || null,
  }

  return (
    <div className="shrink-0 border-b border-slate-100 bg-white px-3 py-3 sm:px-4">
      <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: 'none' }}>
        {/* Own story / Add story — Instagram style */}
        <button
          type="button"
          onClick={() => {
            if (ownGroup) openGroup(ownGroup.id)
            else { setComposerOpen(true); setError('') }
          }}
          className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
        >
          <span className="relative">
            <span className={`grid place-items-center rounded-full p-[2.5px] ${ownGroup ? 'bg-gradient-to-tr from-emerald-500 via-teal-400 to-orange-400' : 'bg-slate-200'}`}>
              <span className="rounded-full bg-white p-[2px]">
                <Avatar author={selfAuthor} size="h-14 w-14" />
              </span>
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-emerald-600 text-white">
              <Plus className="h-3 w-3" strokeWidth={3} />
            </span>
          </span>
          <span className="w-full truncate text-center text-[11px] font-semibold text-slate-700">Your story</span>
        </button>

        {ownGroup && (
          <button
            type="button"
            onClick={() => { setComposerOpen(true); setError('') }}
            className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
            title="Add another story"
          >
            <span className="grid h-[64px] w-[64px] place-items-center rounded-full border-2 border-dashed border-slate-300 bg-slate-50 text-slate-400">
              <Plus className="h-6 w-6" />
            </span>
            <span className="w-full truncate text-center text-[11px] font-semibold text-slate-500">Add</span>
          </button>
        )}

        {loading && (
          <div className="flex items-center gap-2 px-2 text-xs text-slate-400">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {!loading && otherGroups.map(group => {
          const label = group.author.display_name || group.author.username || 'User'
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => openGroup(group.id)}
              className="flex w-[72px] shrink-0 flex-col items-center gap-1.5"
            >
              <span className="grid place-items-center rounded-full bg-gradient-to-tr from-emerald-500 via-fuchsia-500 to-orange-400 p-[2.5px]">
                <span className="rounded-full bg-white p-[2px]">
                  <Avatar author={group.author} size="h-14 w-14" />
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px] font-semibold text-slate-700">{label}</span>
            </button>
          )
        })}
      </div>

      {composerOpen && (
        <div className="newgen-dialog-backdrop z-[110]" onMouseDown={e => { if (e.target === e.currentTarget) resetComposer() }}>
          <section role="dialog" aria-modal="true" aria-label="Create story" className="newgen-dialog-panel w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-slate-900">New story</h2>
              <button type="button" onClick={resetComposer} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={e => void publishStory(e)} className="space-y-3">
              {imagePreview ? (
                <div className="relative overflow-hidden rounded-2xl bg-slate-100">
                  <img src={imagePreview} alt="" className="max-h-56 w-full object-contain" />
                  <button type="button" onClick={() => { setImageDataUrl(null); setImagePreview(null) }} className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-slate-500 hover:border-emerald-300 hover:bg-emerald-50/40">
                  <ImagePlus className="h-8 w-8" />
                  <span className="text-sm font-bold">Add a photo</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void chooseImage(e.target.files?.[0])} />
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Write a caption…"
                rows={3}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-300 focus:bg-white"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={resetComposer} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{saving ? 'Posting…' : 'Share'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {activeStory && (
        <div className="newgen-dialog-backdrop z-[110] !bg-slate-950/90" onMouseDown={e => { if (e.target === e.currentTarget) setActiveIndex(null) }}>
          <section role="dialog" aria-modal="true" aria-label="Story viewer" className="flex h-[min(820px,calc(100dvh-24px))] w-full max-w-[430px] min-h-0 flex-col overflow-hidden rounded-3xl bg-slate-950 text-white shadow-2xl">
            <div className="shrink-0 p-4 pb-3">
              <div className="mb-3 flex gap-1">
                {groups.find(g => g.id === activeStory.groupId)?.stories.map((_, i) => (
                  <span key={i} className="h-1 flex-1 rounded-full bg-white/30">
                    <span className={`block h-full rounded-full ${i <= (groups.find(g => g.id === activeStory.groupId)?.stories.findIndex(s => s.id === activeStory.id) ?? 0) ? 'bg-white' : 'bg-transparent'}`} />
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Avatar author={activeStory.author} size="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold">{activeStory.author.display_name || activeStory.author.username}</p>
                  <p className="text-[11px] text-white/55">{formatDistanceToNow(new Date(activeStory.created_at), { addSuffix: true })}</p>
                </div>
                {activeStory.user_id === user?.id && (
                  <button type="button" onClick={() => void deleteStory(activeStory)} aria-label="Delete story" className="rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">Delete</button>
                )}
                <button type="button" onClick={() => setActiveIndex(null)} aria-label="Close story" className="rounded-full bg-white/15 p-2 hover:bg-white/25"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-950 via-slate-950 to-indigo-950 px-4">
              {activeStory.media_url
                ? <img src={activeStory.media_url} alt="Story" className="max-h-full max-w-full object-contain" />
                : <p className="max-w-sm text-center text-xl font-bold leading-8">{activeStory.caption || 'Story'}</p>}
            </div>
            {activeStory.media_url && activeStory.caption && (
              <div className="shrink-0 px-5 py-3 text-center text-sm font-medium leading-6 text-white/90">{activeStory.caption}</div>
            )}
            <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-4 py-3">
              <button type="button" onClick={() => setActiveIndex(index => index === null ? null : Math.max(0, index - 1))} disabled={activeIndex === 0} aria-label="Previous story" className="rounded-full bg-white/15 p-3 hover:bg-white/25 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
              <span className="text-xs font-semibold text-white/65">{(activeIndex || 0) + 1} / {flatStories.length}</span>
              <button type="button" onClick={() => setActiveIndex(index => index === null ? null : Math.min(flatStories.length - 1, index + 1))} disabled={activeIndex === flatStories.length - 1} aria-label="Next story" className="rounded-full bg-white/15 p-3 hover:bg-white/25 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

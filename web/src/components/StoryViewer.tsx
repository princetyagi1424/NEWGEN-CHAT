import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { Trash2, X } from 'lucide-react'
import Avatar from './Avatar'
import { apiRequest } from '../lib/api'

export interface StoryItem {
  id: string
  user_id: string
  kind: 'image' | 'text'
  caption: string | null
  bg: string | null
  created_at: string
  seen: boolean
  author: { id: string; username: string; display_name: string; avatar: string | null }
}
export interface StoryGroup { userId: string; author: StoryItem['author']; stories: StoryItem[]; allSeen: boolean }

const DURATION_MS = 5000

interface Props {
  groups: StoryGroup[]
  startIndex: number
  meId: string
  onClose: () => void
  onSeen: (storyId: string) => void
  onDeleted: () => void
}

export default function StoryViewer({ groups, startIndex, meId, onClose, onSeen, onDeleted }: Props) {
  const [groupIndex, setGroupIndex] = useState(startIndex)
  const [storyIndex, setStoryIndex] = useState(() => {
    const first = groups[startIndex]?.stories.findIndex(story => !story.seen) ?? 0
    return first > 0 ? first : 0
  })
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [media, setMedia] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  const requested = useRef(new Set<string>())

  const group = groups[groupIndex]
  const story = group?.stories[storyIndex]
  const imageReady = story?.kind !== 'image' || Boolean(media[story.id])

  const next = useCallback(() => {
    if (!group) return
    if (storyIndex < group.stories.length - 1) { setStoryIndex(storyIndex + 1); return }
    if (groupIndex < groups.length - 1) { setGroupIndex(groupIndex + 1); setStoryIndex(0); return }
    onClose()
  }, [group, groupIndex, groups.length, onClose, storyIndex])

  const previous = useCallback(() => {
    if (storyIndex > 0) { setStoryIndex(storyIndex - 1); return }
    if (groupIndex > 0) {
      const target = groups[groupIndex - 1]
      setGroupIndex(groupIndex - 1)
      setStoryIndex(Math.max(0, target.stories.length - 1))
    }
  }, [groupIndex, groups, storyIndex])

  // Load the full image for the current story (and warm the next one).
  useEffect(() => {
    if (!story) return
    const ids = [story, group.stories[storyIndex + 1]].filter(Boolean).filter(item => item.kind === 'image')
    for (const item of ids) {
      if (requested.current.has(item.id)) continue
      requested.current.add(item.id)
      apiRequest(`/api/stories?id=${encodeURIComponent(item.id)}`)
        .then(result => { if (typeof result.media === 'string') setMedia(previousMedia => ({ ...previousMedia, [item.id]: result.media })) })
        .catch(() => { if (item.id === story.id) setFailed(true) })
    }
  }, [story, group, storyIndex])

  // Mark as seen once the story is actually on screen.
  useEffect(() => {
    if (!story || story.seen || story.user_id === meId || !imageReady) return
    onSeen(story.id)
    void apiRequest('/api/stories', { method: 'POST', body: JSON.stringify({ action: 'view', story_id: story.id }) }).catch(() => undefined)
  }, [story, meId, imageReady, onSeen])

  // Progress timer; pauses on hold and while an image is still loading.
  useEffect(() => {
    setProgress(0)
    setFailed(false)
  }, [groupIndex, storyIndex])
  useEffect(() => {
    if (!story || paused || !imageReady) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = now - last
      last = now
      setProgress(value => {
        const nextValue = value + delta / DURATION_MS
        return nextValue >= 1 ? 1 : nextValue
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [story, paused, imageReady])
  useEffect(() => { if (progress >= 1) next() }, [progress, next])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') next()
      if (event.key === 'ArrowLeft') previous()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, onClose, previous])

  if (!group || !story) return null
  const mine = story.user_id === meId
  const textBg = story.bg || '#7C5CFF'

  async function remove() {
    if (!window.confirm('Delete this story?')) return
    try {
      await apiRequest('/api/stories', { method: 'POST', body: JSON.stringify({ action: 'delete', story_id: story.id }) })
      onDeleted()
      if (group.stories.length <= 1) onClose(); else next()
    } catch { window.alert('Could not delete this story.') }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 backdrop-blur-sm" role="dialog" aria-label="Story viewer">
      <div className="relative h-full w-full max-w-[460px] overflow-hidden bg-black md:h-[min(92dvh,860px)] md:rounded-[28px]">
        {story.kind === 'image' ? (
          media[story.id]
            ? <img src={media[story.id]} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            : <div className="absolute inset-0 grid place-items-center text-sm text-white/70">{failed ? 'Could not load this story' : 'Loading…'}</div>
        ) : (
          <div className="absolute inset-0 grid place-items-center p-10 text-center" style={{ background: `linear-gradient(160deg, ${textBg}, ${textBg}cc)` }}>
            <p className="whitespace-pre-wrap break-words text-3xl font-extrabold leading-tight tracking-tight text-white">{story.caption}</p>
          </div>
        )}
        {story.kind === 'image' && story.caption ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pb-8 pt-16 text-center text-base font-semibold text-white">{story.caption}</div>
        ) : null}

        {/* Tap zones: left = back, right = next, hold = pause */}
        <div className="absolute inset-0 flex" onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)}>
          <button type="button" aria-label="Previous story" className="h-full w-1/3" onClick={previous} />
          <button type="button" aria-label="Next story" className="h-full w-2/3" onClick={next} />
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-3">
          <div className="flex gap-1">
            {group.stories.map((item, index) => (
              <span key={item.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <span className="block h-full rounded-full bg-white" style={{ width: `${index < storyIndex ? 100 : index === storyIndex ? progress * 100 : 0}%` }} />
              </span>
            ))}
          </div>
          <div className="pointer-events-auto mt-3 flex items-center gap-3">
            <Avatar name={group.author.display_name} src={group.author.avatar} size={36} />
            <div className="min-w-0 flex-1 text-white">
              <p className="truncate text-sm font-bold">{mine ? 'Your story' : group.author.display_name}</p>
              <p className="text-[11px] text-white/70">{formatDistanceToNowStrict(new Date(story.created_at), { addSuffix: true })}</p>
            </div>
            {mine ? <button type="button" onClick={() => void remove()} aria-label="Delete story" className="rounded-full p-2 text-white/90 hover:bg-white/15"><Trash2 className="h-5 w-5" /></button> : null}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-white hover:bg-white/15"><X className="h-6 w-6" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

import type { ReactNode } from 'react'

const TONES = [
  ['#7C5CFF', '#B79BFF'], ['#FF5C9D', '#FF9CC2'], ['#00B8A9', '#6FE3D6'],
  ['#FF8A3D', '#FFC08A'], ['#3D8BFF', '#8FBEFF'], ['#9B5CFF', '#D0A8FF'],
]

function tone(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return TONES[hash % TONES.length]
}

export type Ring = 'new' | 'seen' | 'none'

interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  ring?: Ring
  online?: boolean
  badge?: ReactNode
  onClick?: () => void
  label?: string
}

/** Round avatar with photo or initial, optional story ring and online dot. */
export default function Avatar({ name, src, size = 44, ring = 'none', online, badge, onClick, label }: AvatarProps) {
  const [from, to] = tone(name || '?')
  const inner = ring === 'none' ? size : size - 8
  const face = (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full font-bold text-white"
      style={{ width: inner, height: inner, background: src ? '#EEF0F3' : `linear-gradient(135deg, ${from}, ${to})`, fontSize: inner * 0.4 }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} /> : (name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
  const body = (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {ring === 'none' ? face : (
        <span
          className="grid place-items-center rounded-full"
          style={{ width: size, height: size, background: ring === 'new' ? 'var(--story-ring)' : '#D5D9E0' }}
        >
          <span className="grid place-items-center rounded-full bg-white" style={{ width: size - 4, height: size - 4 }}>{face}</span>
        </span>
      )}
      {online ? <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" /> : null}
      {badge}
    </span>
  )
  return onClick ? <button type="button" onClick={onClick} aria-label={label || name} className="shrink-0 rounded-full">{body}</button> : body
}

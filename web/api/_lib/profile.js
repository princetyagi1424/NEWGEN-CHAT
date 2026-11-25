// Shared helpers for editable profiles (display name + small avatar) and stories.
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export const AVATAR_MAX_CHARS = 60_000
export const STORY_MAX_CHARS = 450_000

export function cleanDisplayName(value) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()
  return cleaned.length ? cleaned.slice(0, 40) : null
}

export function validImageDataUrl(value, maxChars) {
  return typeof value === 'string' && value.length <= maxChars && IMAGE_DATA_URL.test(value)
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    avatar: row.avatar_data || null,
  }
}

export async function currentAccount(db, token, columns = 'id,username,display_name,avatar_data,token_version') {
  const { data, error } = await db.from('app_users').select(columns).eq('id', token.sub).maybeSingle()
  if (error) throw error
  return data
}

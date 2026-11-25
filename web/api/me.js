import { getDb, readBearer, sendError, isTokenRevoked } from './_lib/auth.js'
import { AVATAR_MAX_CHARS, cleanDisplayName, currentAccount, publicUser, validImageDataUrl } from './_lib/profile.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'PATCH'].includes(req.method)) return sendError(res, 405, 'Method not allowed')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const user = await currentAccount(db, token)
    if (!user || Number(user.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired; please sign in again')
    }
    if (req.method === 'GET') return res.status(200).json({ user: publicUser(user) })

    // PATCH: change display name and/or profile photo.
    const body = req.body || {}
    const update = {}
    if ('display_name' in body) {
      if (body.display_name !== null && typeof body.display_name !== 'string') return sendError(res, 400, 'Invalid name')
      update.display_name = cleanDisplayName(body.display_name)
    }
    if ('avatar' in body) {
      if (body.avatar === null) update.avatar_data = null
      else if (validImageDataUrl(body.avatar, AVATAR_MAX_CHARS)) update.avatar_data = body.avatar
      else return sendError(res, 400, 'Photo must be a small JPEG, PNG or WebP image')
    }
    if (!Object.keys(update).length) return sendError(res, 400, 'Nothing to update')
    const { data, error } = await db.from('app_users').update(update).eq('id', user.id)
      .select('id,username,display_name,avatar_data').single()
    if (error) throw error
    return res.status(200).json({ user: publicUser(data) })
  } catch (error) {
    console.error('Profile API error:', error?.code || error?.name || 'profile_failed')
    const code = error?.code
    if (code === '42703') return sendError(res, 503, 'Profile database setup is incomplete. Apply migration 010_profile_and_stories.sql.')
    return sendError(res, 500, 'Profile is temporarily unavailable')
  }
}

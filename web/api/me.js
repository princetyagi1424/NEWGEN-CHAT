import { getDb, readBearer, sendError } from './_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const { data: user, error } = await db.from('app_users')
      .select('id, username, token_version')
      .eq('id', token.sub)
      .maybeSingle()
    if (error) throw error
    if (!user || Number(user.token_version) !== Number(token.ver || 0)) return sendError(res, 401, 'Session expired; please sign in again')
    return res.status(200).json({ user: { id: user.id, username: user.username } })
  } catch (error) {
    console.error('Session API error:', error.message)
    return sendError(res, 500, 'Session check is temporarily unavailable')
  }
}

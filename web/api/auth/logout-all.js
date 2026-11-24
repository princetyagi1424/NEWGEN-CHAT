import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const { data: user, error } = await db.from('app_users')
      .select('id,token_version')
      .eq('id', token.sub)
      .maybeSingle()
    if (error) throw error
    if (!user || Number(user.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired; sign in again')
    }
    const { error: updateError } = await db.from('app_users')
      .update({ token_version: Number(user.token_version || 0) + 1 })
      .eq('id', user.id)
    if (updateError) throw updateError
    const [revokeResult, channelResult] = await Promise.all([
      db.from('revoked_tokens').delete().eq('user_id', user.id),
      db.from('realtime_session_channels').delete().eq('user_id', user.id),
    ])
    if (revokeResult.error) throw revokeResult.error
    if (channelResult.error) throw channelResult.error
    return res.status(204).end()
  } catch (error) {
    console.error('Web logout-all API error:', error?.code || error?.name || 'session_revoke_failed')
    return sendError(res, 503, 'Could not revoke all sessions. Apply migration 007_web_session_revocation.sql and retry.')
  }
}

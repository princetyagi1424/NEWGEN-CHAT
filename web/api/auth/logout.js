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
    if (!user || Number(user.token_version) !== Number(token.ver || 0)) return res.status(204).end()
    if (await isTokenRevoked(db, token)) return res.status(204).end()

    if (token.jti && Number(token.exp) > Math.floor(Date.now() / 1000)) {
      const { error: revokeError } = await db.from('revoked_tokens').upsert({
        jti: token.jti,
        user_id: user.id,
        expires_at: new Date(Number(token.exp) * 1000).toISOString(),
        revoked_at: new Date().toISOString()
      }, { onConflict: 'jti' })
      if (revokeError) throw revokeError
      const { error: channelError } = await db.from('realtime_session_channels').delete().eq('session_jti', token.jti)
      if (channelError) throw channelError
    } else {
      // Legacy tokens have no unique identifier; revoke all sessions safely.
      const { error: updateError } = await db.from('app_users')
        .update({ token_version: Number(user.token_version || 0) + 1 })
        .eq('id', user.id)
      if (updateError) throw updateError
    }
    return res.status(204).end()
  } catch (error) {
    console.error('Web logout API error:', error?.code || error?.name || 'session_revoke_failed')
    return sendError(res, 503, 'Could not revoke the server session. Apply migration 007_web_session_revocation.sql and retry.')
  }
}

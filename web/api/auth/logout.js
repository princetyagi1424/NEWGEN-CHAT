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
    // /api/auth/logout-all is rewritten here with ?all=1 to stay within the serverless function limit.
    if (req.query?.all === '1') {
      if (!user || Number(user.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
        return sendError(res, 401, 'Session expired; sign in again')
      }
      const { error: bumpError } = await db.from('app_users')
        .update({ token_version: Number(user.token_version || 0) + 1 })
        .eq('id', user.id)
      if (bumpError) throw bumpError
      const { error: clearError } = await db.from('revoked_tokens').delete().eq('user_id', user.id)
      if (clearError) throw clearError
      return res.status(204).end()
    }
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

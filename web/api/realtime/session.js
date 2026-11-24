import { getDb, readBearer, sendError, isTokenRevoked, randomUUID } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed')

  const token = readBearer(req)
  if (!token?.sub || !token?.jti || !Number.isFinite(Number(token.exp))) {
    return sendError(res, 401, 'Authentication required')
  }

  try {
    const db = getDb()
    const { data: account, error: accountError } = await db.from('app_users')
      .select('id,token_version')
      .eq('id', token.sub)
      .maybeSingle()
    if (accountError) throw accountError
    if (!account || Number(account.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired')
    }

    const expiresAt = new Date(Number(token.exp) * 1000).toISOString()
    const now = new Date().toISOString()
    const { data: existing, error: existingError } = await db.from('realtime_session_channels')
      .select('channel_token')
      .eq('session_jti', token.jti)
      .eq('user_id', account.id)
      .gt('expires_at', now)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing?.channel_token) return res.status(200).json({ channelToken: existing.channel_token })

    const channelToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
    const { data: created, error: createError } = await db.from('realtime_session_channels')
      .upsert({
        session_jti: token.jti,
        user_id: account.id,
        channel_token: channelToken,
        expires_at: expiresAt,
      }, { onConflict: 'session_jti' })
      .select('channel_token')
      .single()
    if (createError) throw createError
    return res.status(200).json({ channelToken: created.channel_token })
  } catch (error) {
    console.error('Realtime session API error:', error?.code || error?.name || 'realtime_session_failed')
    return sendError(res, 503, 'Live updates are temporarily unavailable')
  }
}

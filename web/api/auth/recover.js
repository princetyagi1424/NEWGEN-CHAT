import { getDb, sendError, bcrypt, validateCredentials, consumeAuthAttempt } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials({ username: req.body?.username, password: req.body?.newPassword })
    if (input.error) return sendError(res, 400, input.error)
    const answer = typeof req.body?.securityAnswer === 'string' ? req.body.securityAnswer.normalize('NFKC').trim().toLowerCase() : ''
    if (answer.length < 2 || answer.length > 100) return sendError(res, 400, 'Enter your security answer')
    const db = getDb()
    if (!(await consumeAuthAttempt(db, req, input.username, 5))) {
      return sendError(res, 429, 'Too many recovery attempts. Try again in 15 minutes.')
    }
    const { data: user, error } = await db.from('app_users').select('id,security_answer_hash,token_version').eq('username', input.username).maybeSingle()
    if (error) throw error
    if (!user?.security_answer_hash || !(await bcrypt.compare(answer, user.security_answer_hash))) {
      return sendError(res, 400, 'Invalid recovery details')
    }
    const passwordHash = await bcrypt.hash(input.password, 12)
    const { error: updateError } = await db.from('app_users').update({ password_hash: passwordHash, token_version: Number(user.token_version || 0) + 1 }).eq('id', user.id)
    if (updateError) throw updateError
    const { error: channelError } = await db.from('realtime_session_channels').delete().eq('user_id', user.id)
    if (channelError) throw channelError
    return res.status(200).json({ status: 'password_reset', message: 'Password reset. Sign in with your new password.' })
  } catch (error) {
    const code = error?.code || error?.cause?.code
    if (code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205') {
      return sendError(res, 503, 'Authentication rate-limit database setup is incomplete. Apply migration 008_atomic_web_auth_rate_limit.sql.')
    }
    console.error('Account recovery API error:', error?.code || error?.name || 'recovery_failed')
    return sendError(res, 500, 'Account recovery is temporarily unavailable')
  }
}

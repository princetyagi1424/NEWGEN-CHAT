import { getDb, sendError, bcrypt, validateCredentials } from '../_lib/auth.js'
import { createHash } from 'node:crypto'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials({ username: req.body?.username, password: req.body?.newPassword })
    if (input.error) return sendError(res, 400, input.error)
    const answer = typeof req.body?.securityAnswer === 'string' ? req.body.securityAnswer.normalize('NFKC').trim().toLowerCase() : ''
    if (answer.length < 2 || answer.length > 100) return sendError(res, 400, 'Enter your security answer')
    const db = getDb()
    const secret = process.env.JWT_SECRET || 'newgen-recovery-throttle'
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
    const ipHash = createHash('sha256').update(secret).update(':').update(ip).digest('hex')
    await db.from('account_recovery_attempts').delete().lt('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    const { count, error: countError } = await db.from('account_recovery_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash)
    if (countError) throw countError
    if ((count || 0) >= 5) return sendError(res, 429, 'Too many recovery attempts. Try again in 15 minutes.')
    const { error: insertError } = await db.from('account_recovery_attempts').insert({ ip_hash: ipHash })
    if (insertError) throw insertError
    const { data: user, error } = await db.from('app_users').select('id,security_answer_hash,token_version').eq('username', input.username).maybeSingle()
    if (error) throw error
    if (!user?.security_answer_hash || !(await bcrypt.compare(answer, user.security_answer_hash))) {
      return sendError(res, 400, 'Invalid recovery details')
    }
    const passwordHash = await bcrypt.hash(input.password, 12)
    const { error: updateError } = await db.from('app_users').update({ password_hash: passwordHash, token_version: Number(user.token_version || 0) + 1 }).eq('id', user.id)
    if (updateError) throw updateError
    return res.status(200).json({ status: 'password_reset', message: 'Password reset. Sign in with your new password.' })
  } catch (error) {
    console.error('Account recovery API error:', error?.code || error?.name || 'recovery_failed')
    return sendError(res, 500, 'Account recovery is temporarily unavailable')
  }
}

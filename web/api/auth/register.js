import { getDb, validateCredentials, sendError, bcrypt, randomUUID, issueToken, consumeAuthAttempt } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const securityAnswer = typeof req.body?.securityAnswer === 'string' ? req.body.securityAnswer.normalize('NFKC').trim().toLowerCase() : ''
    if (securityAnswer.length < 2 || securityAnswer.length > 100) return sendError(res, 400, 'Security answer must be 2–100 characters')
    const db = getDb()
    if (!(await consumeAuthAttempt(db, req, input.username, 5))) {
      return sendError(res, 429, 'Too many account-creation attempts. Try again in 15 minutes.')
    }
    const [passwordHash, securityAnswerHash] = await Promise.all([
      bcrypt.hash(input.password, 12),
      bcrypt.hash(securityAnswer, 12),
    ])
    const id = randomUUID()
    const { data, error } = await db.from('app_users')
      .insert({ id, username: input.username, password_hash: passwordHash, security_question: 'What was the name of your first school?', security_answer_hash: securityAnswerHash })
      .select('id, username, token_version')
      .single()
    if (error) {
      if (error.code === '23505') return sendError(res, 409, 'Username is already taken')
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return sendError(res, 503, 'Account database is not initialized. Run web/database/schema.sql in Supabase SQL Editor.')
      }
      throw error
    }
    // The app_users AFTER INSERT trigger creates the chat profile in the same
    // database transaction, avoiding a second profile request.
    return res.status(201).json({ user: { id: data.id, username: data.username }, token: issueToken(data) })
  } catch (error) {
    const code = error?.code || error?.cause?.code
    if (code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205') {
      return sendError(res, 503, 'Authentication rate-limit database setup is incomplete. Apply migration 008_atomic_web_auth_rate_limit.sql.')
    }
    console.error('Register API error:', error?.code || error?.name || 'registration_failed')
    return sendError(res, 500, 'Account creation is temporarily unavailable')
  }
}

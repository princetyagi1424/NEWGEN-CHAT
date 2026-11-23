import { getDb, validateCredentials, sendError, bcrypt, randomUUID, issueToken } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const securityAnswer = typeof req.body?.securityAnswer === 'string' ? req.body.securityAnswer.normalize('NFKC').trim().toLowerCase() : ''
    if (securityAnswer.length < 2 || securityAnswer.length > 100) return sendError(res, 400, 'Security answer must be 2–100 characters')
    const db = getDb()
    const passwordHash = await bcrypt.hash(input.password, 12)
    const securityAnswerHash = await bcrypt.hash(securityAnswer, 12)
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
    const { error: profileError } = await db.from('profiles').upsert({
      id: data.id, username: data.username, display_name: data.username, updated_at: new Date().toISOString()
    }, { onConflict: 'id' })
    if (profileError) {
      console.error('Profile initialization error:', profileError.message)
      return sendError(res, 503, 'Chat profile database is not initialized. Run web/database/chat-auth-bridge.sql in Supabase SQL Editor.')
    }
    return res.status(201).json({ user: { id: data.id, username: data.username }, token: issueToken(data) })
  } catch (error) {
    console.error('Register API error:', error.message)
    return sendError(res, 500, 'Account creation is temporarily unavailable')
  }
}

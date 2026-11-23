import { getDb, validateCredentials, sendError, bcrypt, randomUUID, issueToken } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const db = getDb()
    const passwordHash = await bcrypt.hash(input.password, 12)
    const id = randomUUID()
    const { data, error } = await db.from('app_users')
      .insert({ id, username: input.username, password_hash: passwordHash })
      .select('id, username, token_version')
      .single()
    if (error) {
      if (error.code === '23505') return sendError(res, 409, 'Username is already taken')
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return sendError(res, 503, 'Account database is not initialized. Run web/database/schema.sql in Supabase SQL Editor.')
      }
      throw error
    }
    return res.status(201).json({ user: { id: data.id, username: data.username }, token: issueToken(data) })
  } catch (error) {
    console.error('Register API error:', error.message)
    return sendError(res, 500, 'Account creation is temporarily unavailable')
  }
}

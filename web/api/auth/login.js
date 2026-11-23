import { getDb, validateCredentials, sendError, bcrypt, issueToken } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const db = getDb()
    const { data: user, error } = await db.from('app_users')
      .select('id, username, password_hash, token_version')
      .eq('username', input.username)
      .maybeSingle()
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return sendError(res, 503, 'Account database is not initialized. Run web/database/schema.sql in Supabase SQL Editor.')
      }
      throw error
    }
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return sendError(res, 401, 'Invalid username or password')
    }
    return res.status(200).json({ user: { id: user.id, username: user.username }, token: issueToken(user) })
  } catch (error) {
    console.error('Login API error:', error.message)
    return sendError(res, 500, 'Login is temporarily unavailable')
  }
}

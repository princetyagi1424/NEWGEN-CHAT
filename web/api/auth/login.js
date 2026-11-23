import { getSql, ensureAuthSchema, validateCredentials, sendError, bcrypt, issueToken } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const sql = getSql()
    await ensureAuthSchema(sql)
    const rows = await sql`SELECT id, username, password_hash, token_version FROM app_users WHERE username = ${input.username} LIMIT 1`
    const user = rows[0]
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return sendError(res, 401, 'Invalid username or password')
    }
    const publicUser = { id: user.id, username: user.username }
    return res.status(200).json({ user: publicUser, token: issueToken(user) })
  } catch (error) {
    console.error('Login API error:', error.message)
    return sendError(res, 500, 'Login is temporarily unavailable')
  }
}

import { getSql, ensureAuthSchema, validateCredentials, sendError, bcrypt, randomUUID, issueToken } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')
  try {
    const input = validateCredentials(req.body)
    if (input.error) return sendError(res, 400, input.error)
    const sql = getSql()
    await ensureAuthSchema(sql)
    const passwordHash = await bcrypt.hash(input.password, 12)
    const id = randomUUID()
    try {
      await sql`INSERT INTO app_users (id, username, password_hash) VALUES (${id}, ${input.username}, ${passwordHash})`
    } catch (error) {
      if (error.code === '23505') return sendError(res, 409, 'Username is already taken')
      throw error
    }
    const user = { id, username: input.username }
    return res.status(201).json({ user, token: issueToken(user) })
  } catch (error) {
    console.error('Register API error:', error.message)
    return sendError(res, 500, 'Account creation is temporarily unavailable')
  }
}

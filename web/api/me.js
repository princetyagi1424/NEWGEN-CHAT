import { getSql, ensureAuthSchema, readBearer, sendError } from './_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const sql = getSql()
    await ensureAuthSchema(sql)
    const rows = await sql`SELECT id, username, token_version FROM app_users WHERE id = ${token.sub} LIMIT 1`
    const user = rows[0]
    if (!user || Number(user.token_version) !== Number(token.ver || 0)) return sendError(res, 401, 'Session expired; please sign in again')
    return res.status(200).json({ user: { id: user.id, username: user.username } })
  } catch (error) {
    console.error('Session API error:', error.message)
    return sendError(res, 500, 'Session check is temporarily unavailable')
  }
}

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'

export function getDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase server credentials are not configured')
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  })
}
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')
  return secret
}
export function sendError(res, status, error) {
  return res.status(status).json({ error })
}
export function validateCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return { error: 'Username must be 3–24 letters, numbers, or underscores.' }
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) return { error: 'Password must be 10–72 characters (maximum 72 UTF-8 bytes).' }
  return { username, password }
}
export function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, ver: Number(user.token_version || 0), jti: randomUUID() }, getJwtSecret(), {
    expiresIn: process.env.TOKEN_TTL || '7d', issuer: 'newgen-chat', algorithm: 'HS256'
  })
}
export function readBearer(req) {
  const header = req.headers.authorization || ''
  if (!header.startsWith('Bearer ')) return null
  try { return jwt.verify(header.slice(7), getJwtSecret(), { issuer: 'newgen-chat', algorithms: ['HS256'] }) }
  catch { return null }
}
export { bcrypt, randomUUID }


/** True when this unique JWT has been explicitly revoked. Legacy tokens without
 * jti remain covered by token_version checks until they expire. */
export async function isTokenRevoked(db, token) {
  if (!token?.jti) return false
  const { data, error } = await db.from('revoked_tokens')
    .select('jti')
    .eq('jti', token.jti)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

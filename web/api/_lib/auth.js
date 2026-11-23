import { neon } from '@neondatabase/serverless'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'

export function getSql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  return neon(process.env.DATABASE_URL)
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
export async function ensureAuthSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_users (
    id uuid PRIMARY KEY,
    username varchar(24) NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    token_version integer NOT NULL DEFAULT 0
  )`
}
export function issueToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, ver: Number(user.token_version || 0) }, getJwtSecret(), {
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

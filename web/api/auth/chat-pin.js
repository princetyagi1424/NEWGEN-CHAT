import { createHash } from 'node:crypto'
import { getDb, readBearer, sendError, bcrypt, isTokenRevoked } from '../_lib/auth.js'

const normalizeAnswer = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : ''
const validPin = value => typeof value === 'string' && /^[0-9]{4,12}$/.test(value)

async function authenticate(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users')
    .select('id,username,token_version,security_question,security_answer_hash,chat_unlock_pin_hash')
    .eq('id', token.sub).maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) return null
  return data
}

function requestIpHash(req) {
  // The hosting proxy must overwrite X-Forwarded-For. Only the first forwarded
  // address is used; the raw IP is never stored.
  const forwarded = req.headers['x-forwarded-for']
  const ip = String(forwarded || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim().slice(0, 128)
  const pepper = process.env.JWT_SECRET
  if (!pepper || pepper.length < 32) throw new Error('JWT_SECRET is not configured')
  return createHash('sha256').update(pepper).update(':').update(ip).digest('hex')
}

async function consumeAttempt(db, userId, ipHash) {
  // A transaction-scoped account-level advisory lock makes check+insert atomic
  // across every IP/device so forwarded-IP spoofing cannot evade the PIN limit.
  const { data, error } = await db.rpc('consume_chat_pin_attempt', {
    p_user_id: userId,
    p_ip_hash: ipHash,
    p_limit: 8,
    p_window_seconds: 900
  })
  if (error) throw error
  return data === true
}

async function resetAttempts(db, userId) {
  const { error } = await db.from('chat_pin_attempts').delete()
    .eq('user_id', userId)
  if (error) throw error
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const db = getDb()
    const user = await authenticate(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')

    if (req.method === 'GET') {
      return res.status(200).json({
        securityQuestion: user.security_question || 'What was the name of your first school?',
        hasPin: Boolean(user.chat_unlock_pin_hash)
      })
    }
    if (req.method !== 'POST') return sendError(res, 405, 'Method not allowed')

    const action = req.body?.action
    const ipHash = requestIpHash(req)

    if (action === 'set' || action === 'change') {
      const pin = req.body?.pin
      const answer = normalizeAnswer(req.body?.securityAnswer)
      if (!validPin(pin)) return sendError(res, 400, 'PIN must contain 4–12 digits.')
      if (answer.length < 2 || answer.length > 100) {
        return sendError(res, 400, 'Enter your security answer.')
      }
      if (!(await consumeAttempt(db, user.id, ipHash))) {
        return sendError(res, 429, 'Too many security attempts. Try again in 15 minutes.')
      }
      if (!user.security_answer_hash || !(await bcrypt.compare(answer, user.security_answer_hash))) {
        return sendError(res, 401, 'Incorrect security answer.')
      }
      const hash = await bcrypt.hash(pin, 12)
      const { error } = await db.from('app_users').update({ chat_unlock_pin_hash: hash }).eq('id', user.id)
      if (error) throw error
      await resetAttempts(db, user.id)
      return res.status(200).json({ status: 'pin_updated' })
    }

    if (action === 'verify') {
      const pin = req.body?.pin
      if (!validPin(pin)) return sendError(res, 400, 'Enter your 4–12 digit PIN.')
      if (!(await consumeAttempt(db, user.id, ipHash))) {
        return sendError(res, 429, 'Too many PIN attempts. Try again in 15 minutes.')
      }
      if (!user.chat_unlock_pin_hash || !(await bcrypt.compare(pin, user.chat_unlock_pin_hash))) {
        return sendError(res, 401, 'Incorrect chat PIN.')
      }
      // A successful verification clears consecutive failures for this account.
      await resetAttempts(db, user.id)
      return res.status(200).json({ status: 'verified' })
    }

    return sendError(res, 400, 'Unsupported action.')
  } catch (error) {
    console.error('Chat PIN API error:', error?.code || error?.name || 'service_error')
    const code = error?.code || error?.cause?.code
    if (code === '42703' || code === '42P01' || code === '42883' ||
        code === 'PGRST204' || code === 'PGRST205' || code === 'PGRST202') {
      return sendError(res, 503, 'Chat PIN database setup is incomplete. Apply migrations 2026-11-23-chat-unlock-pin.sql and 005_atomic_chat_pin_rate_limit.sql in the Supabase SQL Editor.')
    }
    return sendError(res, 503, 'Chat PIN service is temporarily unavailable. Check server environment variables SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and JWT_SECRET.')
  }
}

import { createHash } from 'node:crypto'
import { getDb, readBearer, sendError, bcrypt } from '../_lib/auth.js'

const normalizeAnswer = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : ''
const validPin = value => typeof value === 'string' && /^[0-9]{4,12}$/.test(value)

async function authenticate(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users')
    .select('id,username,token_version,security_question,security_answer_hash,chat_unlock_pin_hash')
    .eq('id', token.sub).maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0)) return null
  return data
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
    if (action === 'set' || action === 'change') {
      const pin = req.body?.pin
      const answer = normalizeAnswer(req.body?.securityAnswer)
      if (!validPin(pin)) return sendError(res, 400, 'PIN must contain 4–12 digits.')
      if (answer.length < 2 || answer.length > 100 || !user.security_answer_hash ||
          !(await bcrypt.compare(answer, user.security_answer_hash))) {
        return sendError(res, 400, 'Incorrect security answer.')
      }
      const hash = await bcrypt.hash(pin, 12)
      const { error } = await db.from('app_users').update({ chat_unlock_pin_hash: hash }).eq('id', user.id)
      if (error) throw error
      return res.status(200).json({ status: 'pin_updated' })
    }

    if (action === 'verify') {
      const pin = req.body?.pin
      if (!validPin(pin)) return sendError(res, 400, 'Enter your 4–12 digit PIN.')
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
      const pepper = process.env.JWT_SECRET || 'newgen-chat-pin-throttle'
      const ipHash = createHash('sha256').update(pepper).update(':').update(ip).digest('hex')
      const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      await db.from('chat_pin_attempts').delete().lt('created_at', cutoff)
      const { count, error: countError } = await db.from('chat_pin_attempts')
        .select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('ip_hash', ipHash)
      if (countError) throw countError
      if ((count || 0) >= 8) return sendError(res, 429, 'Too many PIN attempts. Try again in 15 minutes.')
      const { error: attemptError } = await db.from('chat_pin_attempts').insert({ user_id: user.id, ip_hash: ipHash })
      if (attemptError) throw attemptError
      if (!user.chat_unlock_pin_hash || !(await bcrypt.compare(pin, user.chat_unlock_pin_hash))) {
        return sendError(res, 401, 'Incorrect chat PIN.')
      }
      // Count only consecutive failed attempts: a valid PIN resets this user's\n      // rate-limit window for the current network address.\n      const { error: resetError } = await db.from('chat_pin_attempts').delete()\n        .eq('user_id', user.id).eq('ip_hash', ipHash)\n      if (resetError) throw resetError\n      return res.status(200).json({ status: 'verified' })
    }
    return sendError(res, 400, 'Unsupported action.')
  } catch (error) {
    console.error('Chat PIN API error:', error.message)
    const code = error?.code || error?.cause?.code
    if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') {
      return sendError(res, 503, 'Chat PIN database setup is incomplete. Apply web/database/migrations/2026-11-23-chat-unlock-pin.sql in the Supabase SQL Editor, then retry.')
    }
    return sendError(res, 503, 'Chat PIN service is temporarily unavailable. Check the Vercel server environment variables SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and JWT_SECRET.')
  }
}

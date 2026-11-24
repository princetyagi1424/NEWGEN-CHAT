import { createHash, hkdfSync } from 'node:crypto'
import { getDb, readBearer, sendError, bcrypt, isTokenRevoked } from '../_lib/auth.js'

const normalizeAnswer = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : ''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Per-conversation AES-256 key derived from a server secret. It is released only after
 * the caller proves their personal PIN and conversation membership, so users never type a key.
 * Trade-off: the server can derive it, so this is not end-to-end encryption. */
function deriveConversationKey(conversationId) {
  const secret = process.env.CHAT_KEY_SECRET || process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('CHAT_KEY_SECRET or JWT_SECRET must contain at least 32 characters')
  return Buffer.from(hkdfSync('sha256', secret, 'newgen-chat-conversation-key-v1', conversationId.toLowerCase(), 32)).toString('base64')
}
const validPin = value => typeof value === 'string' && /^[0-9]{4,12}$/.test(value)

async function authenticate(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users')
    .select('id,username,token_version,password_hash,security_question,security_answer_hash,chat_unlock_pin_hash')
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
      const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : ''
      if (!validPin(pin)) return sendError(res, 400, 'PIN must contain 4–12 digits.')
      if ((!answer || answer.length > 100) && !currentPassword) {
        return sendError(res, 400, 'Enter your security answer or current account password.')
      }
      if (answer && answer.length < 2) return sendError(res, 400, 'Security answer must contain at least 2 characters.')
      if (!(await consumeAttempt(db, user.id, ipHash))) {
        return sendError(res, 429, 'Too many security attempts. Try again in 15 minutes.')
      }
      const answerMatches = Boolean(answer && user.security_answer_hash && await bcrypt.compare(answer, user.security_answer_hash))
      const passwordMatches = Boolean(currentPassword && user.password_hash && await bcrypt.compare(currentPassword, user.password_hash))
      if (!answerMatches && !passwordMatches) {
        return sendError(res, 401, 'Security answer or current account password is incorrect.')
      }
      const hash = await bcrypt.hash(pin, 12)
      const { error } = await db.from('app_users').update({ chat_unlock_pin_hash: hash }).eq('id', user.id)
      if (error) throw error
      await resetAttempts(db, user.id)
      return res.status(200).json({ status: 'pin_updated' })
    }

    if (action === 'verify' || action === 'unlock') {
      const pin = req.body?.pin
      if (!validPin(pin)) return sendError(res, 400, 'Enter your 4–12 digit PIN.')
      let conversationId = ''
      if (action === 'unlock') {
        conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : ''
        if (!UUID_RE.test(conversationId)) return sendError(res, 400, 'Invalid conversation.')
      }
      if (!(await consumeAttempt(db, user.id, ipHash))) {
        return sendError(res, 429, 'Too many PIN attempts. Try again in 15 minutes.')
      }
      if (!user.chat_unlock_pin_hash || !(await bcrypt.compare(pin, user.chat_unlock_pin_hash))) {
        return sendError(res, 401, 'Incorrect chat PIN.')
      }
      // A successful verification clears consecutive failures for this account.
      await resetAttempts(db, user.id)
      if (action === 'verify') {
        return res.status(200).json({ status: 'verified' })
      }

      // Only members of the conversation may receive its key.
      const { data: membership, error: membershipError } = await db.from('conversation_members')
        .select('conversation_id').eq('conversation_id', conversationId).eq('user_id', user.id).maybeSingle()
      if (membershipError) throw membershipError
      if (!membership) return sendError(res, 403, 'You are not a member of this conversation')
      return res.status(200).json({ status: 'unlocked', key: deriveConversationKey(conversationId) })
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

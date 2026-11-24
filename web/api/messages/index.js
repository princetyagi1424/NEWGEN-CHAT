import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const { data: account, error: accountError } = await db.from('app_users').select('id,token_version').eq('id', token.sub).maybeSingle()
    if (accountError) throw accountError
    if (!account || Number(account.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) return sendError(res, 401, 'Session expired')
    const conversationId = typeof req.query?.conversation_id === 'string' ? req.query.conversation_id : ''
    if (!conversationId) return sendError(res, 400, 'conversation_id is required')
    const { data: membership, error: membershipError } = await db.from('conversation_members').select('conversation_id').eq('conversation_id', conversationId).eq('user_id', token.sub).maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return sendError(res, 403, 'You are not a member of this conversation')

    if (req.method === 'GET') {
      const { data, error } = await db.from('messages').select('id,conversation_id,sender_id,ciphertext,iv,content_type,media_path,media_mime,media_size,reply_to,created_at,expires_at,deleted_at').eq('conversation_id', conversationId).is('deleted_at', null).order('created_at', { ascending: true }).limit(200)
      if (error) throw error
      return res.status(200).json({ messages: data || [] })
    }
    if (req.method === 'POST') {
      if ('passkey' in (req.body || {}) || 'conversation_key' in (req.body || {})) {
        return sendError(res, 400, 'Chat secrets must never be sent to the server')
      }
      const ciphertext = typeof req.body?.ciphertext === 'string' ? req.body.ciphertext : ''
      const iv = typeof req.body?.iv === 'string' ? req.body.iv : ''
      if (!ciphertext || ciphertext.length > 100000 || !iv || iv.length > 256) return sendError(res, 400, 'Invalid encrypted message')
      const { data, error } = await db.from('messages').insert({
        conversation_id: conversationId, sender_id: token.sub, ciphertext, iv, content_type: 'text'
      }).select('*').single()
      if (error) throw error
      await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
      return res.status(201).json({ message: data })
    }
    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error('Messages API error:', error.message)
    return sendError(res, 500, 'Could not process message')
  }
}

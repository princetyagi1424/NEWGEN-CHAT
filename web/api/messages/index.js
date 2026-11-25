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
    const messageId = typeof req.query?.message_id === 'string' ? req.query.message_id : (typeof req.body?.message_id === 'string' ? req.body.message_id : '')

    if (req.method === 'DELETE') {
      if (!messageId) return sendError(res, 400, 'message_id is required')
      const { data: message, error: messageError } = await db.from('messages')
        .select('id,conversation_id,sender_id,deleted_at')
        .eq('id', messageId)
        .maybeSingle()
      if (messageError) throw messageError
      if (!message || message.deleted_at) return sendError(res, 404, 'Message not found')
      if (message.sender_id !== token.sub) return sendError(res, 403, 'You can only delete your own messages')
      const { data: membership, error: membershipError } = await db.from('conversation_members')
        .select('conversation_id')
        .eq('conversation_id', message.conversation_id)
        .eq('user_id', token.sub)
        .maybeSingle()
      if (membershipError) throw membershipError
      if (!membership) return sendError(res, 403, 'You are not a member of this conversation')
      const { error: deleteError } = await db.from('messages')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', messageId)
        .eq('sender_id', token.sub)
      if (deleteError) throw deleteError
      return res.status(200).json({ ok: true, message_id: messageId })
    }

    if (!conversationId) return sendError(res, 400, 'conversation_id is required')
    const { data: membership, error: membershipError } = await db.from('conversation_members').select('conversation_id').eq('conversation_id', conversationId).eq('user_id', token.sub).maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return sendError(res, 403, 'You are not a member of this conversation')

    if (req.method === 'GET') {
      const after = typeof req.query?.after === 'string' ? req.query.after : ''
      const [afterCreatedAt, afterId] = after ? after.split('|') : ['', '']
      if (after && (
        after.length > 80 ||
        !Number.isFinite(Date.parse(afterCreatedAt)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(afterId)
      )) {
        return sendError(res, 400, 'Invalid message cursor')
      }
      let query = db.from('messages')
        .select('id,conversation_id,sender_id,ciphertext,iv,content_type,media_path,media_mime,media_size,reply_to,created_at,expires_at,deleted_at')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(after ? 100 : 200)
      if (after) {
        query = query.or(`created_at.gt.${afterCreatedAt},and(created_at.eq.${afterCreatedAt},id.gt.${afterId})`)
      }
      const { data, error } = await query
      if (error) throw error
      // Mark read when loading messages
      await db.rpc('mark_conversation_read', { p_user_id: token.sub, p_conversation_id: conversationId }).catch(() =>
        db.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('user_id', token.sub)
      )
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
    console.error('Messages API error:', error?.code || error?.name || 'message_request_failed')
    return sendError(res, 500, 'Could not process message')
  }
}

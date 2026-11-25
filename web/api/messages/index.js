import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

function readQuery(req) {
  // Vercel / Node handlers may expose query on req.query or only on the URL.
  const fromReq = req?.query && typeof req.query === 'object' ? req.query : {}
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    const out = { ...fromReq }
    for (const [key, value] of url.searchParams.entries()) {
      if (out[key] === undefined) out[key] = value
    }
    return out
  } catch {
    return fromReq
  }
}

function asString(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return ''
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')

  try {
    const db = getDb()
    const { data: account, error: accountError } = await db
      .from('app_users')
      .select('id,token_version')
      .eq('id', token.sub)
      .maybeSingle()
    if (accountError) throw accountError
    if (!account || Number(account.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired')
    }

    const query = readQuery(req)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const conversationId = asString(query.conversation_id)
    const messageId = asString(query.message_id) || asString(body.message_id)

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

    const { data: membership, error: membershipError } = await db.from('conversation_members')
      .select('conversation_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', token.sub)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return sendError(res, 403, 'You are not a member of this conversation')

    if (req.method === 'GET') {
      const after = asString(query.after)
      let afterCreatedAt = ''
      let afterId = ''
      if (after) {
        const parts = after.split('|')
        afterCreatedAt = parts[0] || ''
        afterId = parts[1] || ''
        if (
          after.length > 80 ||
          !Number.isFinite(Date.parse(afterCreatedAt)) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(afterId)
        ) {
          return sendError(res, 400, 'Invalid message cursor')
        }
      }

      let messageQuery = db.from('messages')
        .select('id,conversation_id,sender_id,ciphertext,iv,content_type,media_path,media_mime,media_size,reply_to,created_at,expires_at,deleted_at')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(after ? 100 : 200)

      if (after) {
        // Prefer simple created_at cursor to avoid multi-column order edge cases.
        messageQuery = messageQuery.gt('created_at', afterCreatedAt)
      }

      const { data, error } = await messageQuery
      if (error) throw error

      // Mark read — never fail the GET if this secondary write fails.
      try {
        const mark = await db.rpc('mark_conversation_read', {
          p_user_id: token.sub,
          p_conversation_id: conversationId,
        })
        if (mark?.error) {
          await db.from('conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('user_id', token.sub)
        }
      } catch {
        try {
          await db.from('conversation_members')
            .update({ last_read_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('user_id', token.sub)
        } catch {
          /* ignore */
        }
      }

      return res.status(200).json({ messages: data || [] })
    }

    if (req.method === 'POST') {
      if ('passkey' in body || 'conversation_key' in body) {
        return sendError(res, 400, 'Chat secrets must never be sent to the server')
      }
      const ciphertext = typeof body.ciphertext === 'string' ? body.ciphertext : ''
      const iv = typeof body.iv === 'string' ? body.iv : ''
      if (!ciphertext || ciphertext.length > 100000 || !iv || iv.length > 256) {
        return sendError(res, 400, 'Invalid encrypted message')
      }
      const { data, error } = await db.from('messages').insert({
        conversation_id: conversationId,
        sender_id: token.sub,
        ciphertext,
        iv,
        content_type: 'text',
      }).select('*').single()
      if (error) throw error
      try {
        await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
      } catch {
        /* ignore */
      }
      return res.status(201).json({ message: data })
    }

    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error(
      'Messages API error:',
      error?.message || error?.code || error?.name || 'message_request_failed',
      error?.stack || '',
    )
    return sendError(res, 500, 'Could not process message')
  }
}

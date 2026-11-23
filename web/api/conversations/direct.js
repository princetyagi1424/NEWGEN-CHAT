import { getDb, readBearer, sendError } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const { data: account, error: accountError } = await db.from('app_users').select('id,token_version').eq('id', token.sub).maybeSingle()
    if (accountError) throw accountError
    if (!account || Number(account.token_version) !== Number(token.ver || 0)) return sendError(res, 401, 'Session expired')

    if (req.method === 'POST') {
      const otherId = typeof req.body?.other_user_id === 'string' ? req.body.other_user_id : ''
      const key = typeof req.body?.conversation_key === 'string' ? req.body.conversation_key : ''
      if (!otherId || otherId === token.sub || !key || key.length > 4096) return sendError(res, 400, 'Invalid chat request')
      const { data: other, error: otherError } = await db.from('app_users').select('id,username').eq('id', otherId).maybeSingle()
      if (otherError) throw otherError
      if (!other) return sendError(res, 404, 'User not found')

      const { data: mine, error: mineError } = await db.from('conversation_members').select('conversation_id').eq('user_id', token.sub)
      if (mineError) throw mineError
      const ids = (mine || []).map(x => x.conversation_id)
      if (ids.length) {
        const { data: theirs, error: theirsError } = await db.from('conversation_members').select('conversation_id').eq('user_id', otherId).in('conversation_id', ids)
        if (theirsError) throw theirsError
        for (const membership of theirs || []) {
          const { data: existing, error } = await db.from('conversations').select('*').eq('id', membership.conversation_id).eq('type', 'direct').maybeSingle()
          if (error) throw error
          if (existing) return res.status(200).json({ conversation: existing, otherUser: other, existing: true })
        }
      }

      const { data: conversation, error: createError } = await db.from('conversations').insert({ type: 'direct', created_by: token.sub }).select('*').single()
      if (createError) throw createError
      const { error: memberError } = await db.from('conversation_members').insert([
        { conversation_id: conversation.id, user_id: token.sub, role: 'owner', encrypted_conversation_key: key },
        { conversation_id: conversation.id, user_id: otherId, role: 'member', encrypted_conversation_key: key },
      ])
      if (memberError) {
        await db.from('conversations').delete().eq('id', conversation.id)
        throw memberError
      }
      return res.status(201).json({ conversation, otherUser: other, existing: false })
    }
    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error('Direct chat API error:', error.message)
    return sendError(res, 500, 'Could not start conversation')
  }
}

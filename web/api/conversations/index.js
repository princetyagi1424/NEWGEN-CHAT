import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

async function getUser(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users').select('id,username,token_version').eq('id', token.sub).maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) return null
  return data
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const db = getDb()
    const user = await getUser(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')
    if (req.method === 'GET') {
      const { data, error } = await db.rpc('get_user_conversation_summaries', { p_user_id: user.id })
      if (error) throw error
      const conversations = Array.isArray(data) ? data : []
      const avatarPaths = [...new Set(conversations
        .map(item => item.otherProfile?.avatar_url)
        .filter(path => typeof path === 'string' && path && !/^https?:\/\//i.test(path)))]

      let signedByPath = new Map()
      if (avatarPaths.length) {
        const { data: signed, error: signedError } = await db.storage
          .from('newgen-profile-media')
          .createSignedUrls(avatarPaths, 60 * 60 * 12)
        if (signedError) console.error('Conversation avatar signing failed:', signedError.code || 'storage_error')
        signedByPath = new Map((signed || []).map(item => [item.path, item.signedUrl || null]))
      }

      const output = conversations.map(item => {
        const avatar = item.otherProfile?.avatar_url
        if (!avatar || /^https?:\/\//i.test(avatar)) return item
        return { ...item, otherProfile: { ...item.otherProfile, avatar_url: signedByPath.get(avatar) || null } }
      })
      return res.status(200).json({ conversations: output })
    }
    if (req.method === 'POST') {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : ''
      if (!name) return sendError(res, 400, 'Group name is required')
      if ('conversation_key' in (req.body || {}) || 'passkey' in (req.body || {})) {
        return sendError(res, 400, 'Chat secrets must never be sent to the server')
      }
      const { data: conv, error } = await db.from('conversations').insert({ type: 'group', name, created_by: user.id }).select('*').single()
      if (error) throw error
      const { error: memberError } = await db.from('conversation_members').insert({ conversation_id: conv.id, user_id: user.id, role: 'owner', encrypted_conversation_key: null })
      if (memberError) {
        await db.from('conversations').delete().eq('id', conv.id)
        throw memberError
      }
      return res.status(201).json({ conversation: { ...conv, members: [{ user_id: user.id, role: 'owner' }], otherProfile: null, lastMessage: null } })
    }
    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error('Conversations API error:', error?.code || error?.name || 'conversation_request_failed')
    return sendError(res, 500, 'Could not load conversations')
  }
}

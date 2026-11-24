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
      const { data: memberships, error: membershipError } = await db.from('conversation_members').select('conversation_id,role').eq('user_id', user.id)
      if (membershipError) throw membershipError
      const ids = (memberships || []).map(x => x.conversation_id)
      if (!ids.length) return res.status(200).json({ conversations: [] })
      const { data: convs, error: convError } = await db.from('conversations').select('*').in('id', ids).order('updated_at', { ascending: false })
      if (convError) throw convError
      const output = []
      for (const conv of convs || []) {
        const { data: members, error: membersError } = await db.from('conversation_members').select('user_id,role').eq('conversation_id', conv.id)
        if (membersError) throw membersError
        const otherId = (members || []).find(m => m.user_id !== user.id)?.user_id
        let otherProfile = null
        if (otherId) {
          const { data: p } = await db.from('profiles')
            .select('id,username,display_name,avatar_url,bio,created_at,updated_at,last_seen_at')
            .eq('id', otherId).maybeSingle()
          if (p) {
            let avatarUrl = p.avatar_url || null
            if (avatarUrl && !(avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))) {
              const { data: signed } = await db.storage.from('newgen-profile-media').createSignedUrl(avatarUrl, 60 * 60 * 12)
              avatarUrl = signed?.signedUrl || null
            }
            otherProfile = { ...p, display_name: p.display_name || p.username, avatar_url: avatarUrl }
          } else {
            const { data: fallback } = await db.from('app_users').select('id,username').eq('id', otherId).maybeSingle()
            if (fallback) otherProfile = { id: fallback.id, username: fallback.username, display_name: fallback.username, avatar_url: null, bio: null, created_at: '', updated_at: '', last_seen_at: null }
          }
        }
        const { data: lastRows, error: lastError } = await db.from('messages').select('id,conversation_id,sender_id,ciphertext,iv,content_type,created_at,expires_at,deleted_at').eq('conversation_id', conv.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1)
        if (lastError) throw lastError
        if (lastRows?.[0]) output.push({ ...conv, members: members || [], otherProfile, lastMessage: lastRows[0] })
      }
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

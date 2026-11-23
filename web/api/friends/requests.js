import { getDb, readBearer, sendError } from '../_lib/auth.js'

async function currentUser(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users').select('id,username,token_version').eq('id', token.sub).maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0)) return null
  return data
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const db = getDb()
    const user = await currentUser(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')

    if (req.method === 'GET') {
      const { data, error } = await db.from('friend_requests').select('id,requester_id,recipient_id,status,created_at').or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      const ids = [...new Set((data || []).flatMap(row => [row.requester_id, row.recipient_id]).filter(id => id !== user.id))]
      const { data: people, error: peopleError } = ids.length
        ? await db.from('app_users').select('id,username').in('id', ids)
        : { data: [], error: null }
      if (peopleError) throw peopleError
      const names = new Map((people || []).map(person => [person.id, person.username]))
      return res.status(200).json({
        requests: (data || []).map(row => ({
          ...row,
          other_user_id: row.requester_id === user.id ? row.recipient_id : row.requester_id,
          other_username: names.get(row.requester_id === user.id ? row.recipient_id : row.requester_id) || 'unknown',
          direction: row.recipient_id === user.id ? 'incoming' : 'outgoing',
        })),
      })
    }

    if (req.method === 'POST') {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
      if (!/^[a-z0-9_]{3,24}$/.test(username)) return sendError(res, 400, 'Enter a valid username')
      const { data: target, error: targetError } = await db.from('app_users').select('id,username').eq('username', username).maybeSingle()
      if (targetError) throw targetError
      if (!target) return sendError(res, 404, 'User not found')
      if (target.id === user.id) return sendError(res, 400, 'You cannot send a request to yourself')
      const low = user.id < target.id ? user.id : target.id
      const high = user.id < target.id ? target.id : user.id
      const { data: friendship, error: friendshipError } = await db.from('friendships').select('user_low').eq('user_low', low).eq('user_high', high).maybeSingle()
      if (friendshipError) throw friendshipError
      if (friendship) return sendError(res, 409, 'You are already connected')
      const { data: existing, error: existingError } = await db.from('friend_requests').select('*').or(`and(requester_id.eq.${user.id},recipient_id.eq.${target.id}),and(requester_id.eq.${target.id},recipient_id.eq.${user.id})`).eq('status', 'pending').maybeSingle()
      if (existingError) throw existingError
      if (existing) return sendError(res, 409, 'A pending request already exists')
      const { data, error } = await db.from('friend_requests').insert({ requester_id: user.id, recipient_id: target.id }).select('id,status,created_at').single()
      if (error) throw error
      return res.status(201).json({ request: data, message: 'Connection request sent' })
    }

    if (req.method === 'PATCH') {
      const id = typeof req.body?.request_id === 'string' ? req.body.request_id : ''
      const action = req.body?.action
      if (!id || !['accept', 'decline', 'cancel'].includes(action)) return sendError(res, 400, 'Invalid request action')
      const { data: request, error: requestError } = await db.from('friend_requests').select('*').eq('id', id).eq('status', 'pending').maybeSingle()
      if (requestError) throw requestError
      if (!request) return sendError(res, 404, 'Pending request not found')
      if (action === 'accept' || action === 'decline') {
        if (request.recipient_id !== user.id) return sendError(res, 403, 'Only the recipient can respond')
      } else if (request.requester_id !== user.id) return sendError(res, 403, 'Only the sender can cancel')
      const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled'
      const { error: updateError } = await db.from('friend_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
      if (updateError) throw updateError
      if (action === 'accept') {
        const low = request.requester_id < request.recipient_id ? request.requester_id : request.recipient_id
        const high = request.requester_id < request.recipient_id ? request.recipient_id : request.requester_id
        const { error: friendError } = await db.from('friendships').upsert({ user_low: low, user_high: high }, { onConflict: 'user_low,user_high' })
        if (friendError) throw friendError
      }
      return res.status(200).json({ status })
    }

    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error('Friend requests API error:', error.message)
    return sendError(res, 500, 'Could not process connection request')
  }
}

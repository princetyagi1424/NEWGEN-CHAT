import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

async function currentUser(req, db) {
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
    const user = await currentUser(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')

    if (req.method === 'GET') {
      const { data, error } = await db.rpc('get_user_friend_requests', { p_user_id: user.id })
      if (error) throw error
      return res.status(200).json({ requests: Array.isArray(data) ? data : [] })
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
      const [friendshipResult, existingResult] = await Promise.all([
        db.from('friendships').select('user_low').eq('user_low', low).eq('user_high', high).maybeSingle(),
        db.from('friend_requests').select('id')
          .or(`and(requester_id.eq.${user.id},recipient_id.eq.${target.id}),and(requester_id.eq.${target.id},recipient_id.eq.${user.id})`)
          .eq('status', 'pending')
          .maybeSingle(),
      ])
      if (friendshipResult.error) throw friendshipResult.error
      if (friendshipResult.data) return sendError(res, 409, 'You are already connected')
      if (existingResult.error) throw existingResult.error
      if (existingResult.data) return sendError(res, 409, 'A pending request already exists')
      const { data, error } = await db.from('friend_requests').insert({ requester_id: user.id, recipient_id: target.id }).select('id,status,created_at').single()
      if (error) throw error
      return res.status(201).json({ request: data, message: 'Connection request sent' })
    }

    if (req.method === 'PATCH') {
      const id = typeof req.body?.request_id === 'string' ? req.body.request_id : ''
      const action = req.body?.action
      if (!id || !['accept', 'decline', 'cancel'].includes(action)) return sendError(res, 400, 'Invalid request action')
      const { data: status, error: responseError } = await db.rpc('respond_friend_request', {
        p_actor_id: user.id,
        p_request_id: id,
        p_action: action,
      })
      if (responseError) {
        const reason = responseError.message || ''
        if (reason.includes('pending_request_not_found')) return sendError(res, 404, 'Pending request not found')
        if (reason.includes('forbidden')) return sendError(res, 403, 'You are not allowed to respond to this request')
        if (reason.includes('invalid_request_action')) return sendError(res, 400, 'Invalid request action')
        throw responseError
      }
      return res.status(200).json({ status })
    }

    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    if (error?.code === '23505') return sendError(res, 409, 'A pending request already exists')
    console.error('Friend requests API error:', error?.code || error?.name || 'friend_request_failed')
    return sendError(res, 500, 'Could not process connection request')
  }
}

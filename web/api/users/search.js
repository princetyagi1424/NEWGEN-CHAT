import { getDb, readBearer, sendError, isTokenRevoked } from '../_lib/auth.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : ''
  if (q.length < 2 || q.length > 24 || !/^[a-z0-9_]+$/.test(q)) {
    return sendError(res, 400, 'Search must be 2–24 letters, numbers, or underscores')
  }
  try {
    const db = getDb()
    const { data: account, error: accountError } = await db.from('app_users')
      .select('id,token_version').eq('id', token.sub).maybeSingle()
    if (accountError) throw accountError
    if (!account || Number(account.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired; please sign in again')
    }
    const { data: users, error } = await db.from('app_users')
      .select('id,username')
      .ilike('username', `%${q}%`)
      .neq('id', token.sub)
      .order('username', { ascending: true })
      .limit(20)
    if (error) throw error
    const userIds = (users || []).map(item => item.id)
    let friendIds = new Set()
    if (userIds.length) {
      const { data: friendships, error: friendshipError } = await db.from('friendships')
        .select('user_low,user_high')
        .or(`user_low.eq.${token.sub},user_high.eq.${token.sub}`)
      if (friendshipError) throw friendshipError
      friendIds = new Set((friendships || []).map(item =>
        item.user_low === token.sub ? item.user_high : item.user_low
      ))
    }
    return res.status(200).json({
      users: (users || []).map(item => ({ ...item, is_friend: friendIds.has(item.id) })),
    })
  } catch (error) {
    console.error('User search API error:', error?.code || error?.name || 'user_search_failed')
    return sendError(res, 500, 'User search is temporarily unavailable')
  }
}

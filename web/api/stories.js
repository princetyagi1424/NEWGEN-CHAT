import { getDb, readBearer, sendError, isTokenRevoked } from './_lib/auth.js'
import { STORY_MAX_CHARS, currentAccount, publicUser, validImageDataUrl } from './_lib/profile.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BG_RE = /^#[0-9a-f]{6}$/i
const MAX_ACTIVE_STORIES = 20

async function friendIds(db, userId) {
  const { data, error } = await db.from('friendships').select('user_low,user_high')
    .or(`user_low.eq.${userId},user_high.eq.${userId}`)
  if (error) throw error
  return (data || []).map(row => (row.user_low === userId ? row.user_high : row.user_low))
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const token = readBearer(req)
  if (!token?.sub) return sendError(res, 401, 'Authentication required')
  try {
    const db = getDb()
    const me = await currentAccount(db, token, 'id,username,token_version')
    if (!me || Number(me.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) {
      return sendError(res, 401, 'Session expired; please sign in again')
    }
    const nowIso = new Date().toISOString()

    if (req.method === 'GET') {
      // One story's full media, only for the owner or one of their friends.
      const single = typeof req.query?.id === 'string' ? req.query.id : ''
      if (single) {
        if (!UUID_RE.test(single)) return sendError(res, 400, 'Invalid story')
        const { data: story, error } = await db.from('stories').select('id,user_id,media,expires_at').eq('id', single).gt('expires_at', nowIso).maybeSingle()
        if (error) throw error
        if (!story) return sendError(res, 404, 'Story not found')
        if (story.user_id !== me.id && !(await friendIds(db, me.id)).includes(story.user_id)) return sendError(res, 403, 'Not allowed')
        return res.status(200).json({ media: story.media })
      }

      const ids = [me.id, ...(await friendIds(db, me.id))]
      const { data: rows, error } = await db.from('stories')
        .select('id,user_id,kind,caption,bg,created_at,expires_at')
        .in('user_id', ids).gt('expires_at', nowIso).order('created_at', { ascending: true }).limit(150)
      if (error) throw error
      const authorIds = [...new Set((rows || []).map(row => row.user_id))]
      const { data: authors, error: authorError } = authorIds.length
        ? await db.from('app_users').select('id,username,display_name,avatar_data').in('id', authorIds)
        : { data: [], error: null }
      if (authorError) throw authorError
      const byId = new Map((authors || []).map(author => [author.id, publicUser(author)]))
      const storyIds = (rows || []).map(row => row.id)
      const { data: views, error: viewError } = storyIds.length
        ? await db.from('story_views').select('story_id').eq('viewer_id', me.id).in('story_id', storyIds)
        : { data: [], error: null }
      if (viewError) throw viewError
      const seen = new Set((views || []).map(view => view.story_id))
      return res.status(200).json({
        stories: (rows || []).map(row => ({ ...row, author: byId.get(row.user_id), seen: row.user_id === me.id || seen.has(row.id) })),
      })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      if (body.action === 'view') {
        if (!UUID_RE.test(body.story_id || '')) return sendError(res, 400, 'Invalid story')
        const { data: story, error } = await db.from('stories').select('id,user_id').eq('id', body.story_id).gt('expires_at', nowIso).maybeSingle()
        if (error) throw error
        if (!story) return sendError(res, 404, 'Story not found')
        if (story.user_id !== me.id) {
          if (!(await friendIds(db, me.id)).includes(story.user_id)) return sendError(res, 403, 'Not allowed')
          const { error: viewError } = await db.from('story_views').upsert({ story_id: story.id, viewer_id: me.id }, { onConflict: 'story_id,viewer_id' })
          if (viewError) throw viewError
        }
        return res.status(204).end()
      }

      if (body.action === 'delete') {
        if (!UUID_RE.test(body.story_id || '')) return sendError(res, 400, 'Invalid story')
        const { error } = await db.from('stories').delete().eq('id', body.story_id).eq('user_id', me.id)
        if (error) throw error
        return res.status(204).end()
      }

      // Default: create a story.
      const kind = body.kind
      if (!['image', 'text'].includes(kind)) return sendError(res, 400, 'Invalid story type')
      const caption = typeof body.caption === 'string' ? body.caption.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 220) : ''
      const bg = typeof body.bg === 'string' && BG_RE.test(body.bg) ? body.bg : null
      let media = null
      if (kind === 'image') {
        if (!validImageDataUrl(body.media, STORY_MAX_CHARS)) return sendError(res, 400, 'Story photo is missing or too large')
        media = body.media
      } else if (!caption) return sendError(res, 400, 'Write something for your story')
      const { count, error: countError } = await db.from('stories').select('id', { count: 'exact', head: true }).eq('user_id', me.id).gt('expires_at', nowIso)
      if (countError) throw countError
      if ((count || 0) >= MAX_ACTIVE_STORIES) return sendError(res, 429, 'You have reached the limit of active stories')
      const { data, error } = await db.from('stories').insert({ user_id: me.id, kind, media, caption: caption || null, bg })
        .select('id,user_id,kind,caption,bg,created_at,expires_at').single()
      if (error) throw error
      return res.status(201).json({ story: data })
    }
    return sendError(res, 405, 'Method not allowed')
  } catch (error) {
    console.error('Stories API error:', error?.code || error?.name || 'stories_failed')
    if (error?.code === '42P01' || error?.code === '42703') return sendError(res, 503, 'Stories database setup is incomplete. Apply migration 010_profile_and_stories.sql.')
    return sendError(res, 500, 'Stories are temporarily unavailable')
  }
}

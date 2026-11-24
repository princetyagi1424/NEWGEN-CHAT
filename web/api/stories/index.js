import { getDb, readBearer, sendError, isTokenRevoked, randomUUID } from '../_lib/auth.js'

const STORY_BUCKET = 'newgen-story-media'
const PROFILE_BUCKET = 'newgen-profile-media'
const STORY_IMAGE_MAX_BYTES = 2 * 1024 * 1024

async function currentUser(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users')
    .select('id,username,token_version')
    .eq('id', token.sub)
    .maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) return null
  return data
}

function decodeImageDataUrl(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(STORY_IMAGE_MAX_BYTES * 4 / 3) + 128) {
    throw new Error('Story photo must be 2 MB or smaller.')
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) throw new Error('Choose a valid PNG, JPG or WebP image.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > STORY_IMAGE_MAX_BYTES) throw new Error('Story photo must be 2 MB or smaller.')
  const mime = 'image/' + match[1]
  const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid) throw new Error('Image content does not match its file type.')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  return { bytes, mime, ext }
}

async function signedUrl(db, bucket, path, seconds) {
  if (!path) return null
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) throw error
  return data?.signedUrl || null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return sendError(res, 405, 'Method not allowed')
  let db
  try {
    db = getDb()
    const user = await currentUser(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')

    if (req.method === 'GET') {
      const now = new Date().toISOString()
      const { data: friendships, error: friendsError } = await db.from('friendships')
        .select('user_low,user_high')
        .or('user_low.eq.' + user.id + ',user_high.eq.' + user.id)
      if (friendsError) throw friendsError
      const friendIds = (friendships || []).map(row => row.user_low === user.id ? row.user_high : row.user_low)
      const allowedIds = [...new Set([user.id, ...friendIds])]

      // Remove expired rows and their private media opportunistically during reads.
      const { data: expired, error: expiredError } = await db.from('stories')
        .select('id,media_path')
        .in('user_id', allowedIds)
        .lte('expires_at', now)
        .limit(100)
      if (expiredError) throw expiredError
      if (expired?.length) {
        await db.from('stories').delete().in('id', expired.map(row => row.id))
        const paths = expired.map(row => row.media_path).filter(Boolean)
        if (paths.length) await db.storage.from(STORY_BUCKET).remove(paths).catch(() => undefined)
      }

      const { data: rows, error: storiesError } = await db.from('stories')
        .select('id,user_id,story_type,caption,media_path,created_at,expires_at')
        .in('user_id', allowedIds)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(100)
      if (storiesError) throw storiesError

      const { data: profiles, error: profilesError } = await db.from('profiles')
        .select('id,username,display_name,avatar_url,bio')
        .in('id', allowedIds)
      if (profilesError) throw profilesError
      const profileById = new Map((profiles || []).map(row => [row.id, row]))
      const stories = await Promise.all((rows || []).map(async row => {
        const author = profileById.get(row.user_id)
        const avatar = author?.avatar_url
          ? /^https?:\/\//i.test(author.avatar_url) ? author.avatar_url : await signedUrl(db, PROFILE_BUCKET, author.avatar_url, 60 * 60 * 12)
          : null
        return {
          ...row,
          media_url: row.media_path ? await signedUrl(db, STORY_BUCKET, row.media_path, 60 * 10) : null,
          author: {
            id: row.user_id,
            username: author?.username || 'unknown',
            display_name: author?.display_name || author?.username || 'unknown',
            avatar_url: avatar,
            bio: author?.bio || null
          }
        }
      }))
      return res.status(200).json({ stories })
    }

    if (req.method === 'POST') {
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.normalize('NFKC').trim() : ''
      if (caption.length > 280) return sendError(res, 400, 'Story text must be 280 characters or fewer')
      const imageDataUrl = req.body?.imageDataUrl
      if (!caption && !imageDataUrl) return sendError(res, 400, 'Add a short note or choose a photo')

      let mediaPath = null
      let storyType = 'text'
      if (imageDataUrl !== undefined) {
        const image = decodeImageDataUrl(imageDataUrl)
        mediaPath = user.id + '/' + randomUUID() + '.' + image.ext
        const { error: uploadError } = await db.storage.from(STORY_BUCKET).upload(mediaPath, image.bytes, {
          contentType: image.mime, upsert: false, cacheControl: '3600'
        })
        if (uploadError) throw uploadError
        storyType = 'image'
      }

      const createdAt = new Date()
      const { data: story, error: insertError } = await db.from('stories').insert({
        user_id: user.id,
        story_type: storyType,
        caption,
        media_path: mediaPath,
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
      }).select('id,user_id,story_type,caption,media_path,created_at,expires_at').single()

      if (insertError) {
        if (mediaPath) await db.storage.from(STORY_BUCKET).remove([mediaPath]).catch(() => undefined)
        throw insertError
      }
      const { data: author } = await db.from('profiles')
        .select('id,username,display_name,avatar_url,bio')
        .eq('id', user.id)
        .maybeSingle()
      const avatar = author?.avatar_url
        ? /^https?:\/\//i.test(author.avatar_url) ? author.avatar_url : await signedUrl(db, PROFILE_BUCKET, author.avatar_url, 60 * 60 * 12)
        : null
      return res.status(201).json({
        story: {
          ...story,
          media_url: mediaPath ? await signedUrl(db, STORY_BUCKET, mediaPath, 60 * 10) : null,
          author: { id: user.id, username: author?.username || user.username, display_name: author?.display_name || user.username, avatar_url: avatar, bio: author?.bio || null }
        }
      })
    }

    const storyId = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!storyId) return sendError(res, 400, 'Story ID is required')
    const { data: story, error: findError } = await db.from('stories')
      .select('id,media_path')
      .eq('id', storyId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (findError) throw findError
    if (!story) return sendError(res, 404, 'Story not found')
    const { error: deleteError } = await db.from('stories').delete().eq('id', storyId).eq('user_id', user.id)
    if (deleteError) throw deleteError
    if (story.media_path) await db.storage.from(STORY_BUCKET).remove([story.media_path]).catch(() => undefined)
    return res.status(200).json({ deleted: true })
  } catch (error) {
    if (error instanceof Error && /Story photo|Choose a valid|Image content/.test(error.message)) return sendError(res, 400, error.message)
    if (error?.message?.includes('Bucket not found') || error?.code === '42P01' || error?.code === 'PGRST205') {
      return sendError(res, 503, 'Stories are not initialized yet. Apply web/database/migrations/010_profile_stories.sql in Supabase.')
    }
    console.error('Stories API error:', error?.code || error?.name || 'story_request_failed')
    return sendError(res, 500, 'Could not process stories')
  }
}

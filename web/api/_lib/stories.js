import { getDb, readBearer, sendError, isTokenRevoked, randomUUID } from './auth.js'

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
  if (/^https?:\/\//i.test(path)) return path
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) throw error
  return data?.signedUrl || null
}

async function storyAuthor(db, userId, fallbackUsername) {
  const { data: author, error } = await db.from('profiles')
    .select('id,username,display_name,avatar_url,bio')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  const avatar = author?.avatar_url
    ? await signedUrl(db, PROFILE_BUCKET, author.avatar_url, 60 * 60 * 12)
    : null
  return {
    id: userId,
    username: author?.username || fallbackUsername || 'unknown',
    display_name: author?.display_name || author?.username || fallbackUsername || 'unknown',
    avatar_url: avatar,
    bio: author?.bio || null,
  }
}

function toStory(row, author, mediaUrl) {
  return {
    id: row.id,
    user_id: row.user_id,
    story_type: row.kind,
    caption: row.caption || '',
    media_url: mediaUrl,
    created_at: row.created_at,
    expires_at: row.expires_at,
    author,
  }
}

export default async function storiesHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return sendError(res, 405, 'Method not allowed')
  try {
    const db = getDb()
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

      // Expired rows and private objects are cleaned opportunistically when a
      // connected user opens stories; visibility is still time-filtered below.
      const { data: expired, error: expiredError } = await db.from('stories')
        .select('id,kind,media')
        .in('user_id', allowedIds)
        .lte('expires_at', now)
        .limit(100)
      if (expiredError) throw expiredError
      if (expired?.length) {
        const { error: deleteExpiredError } = await db.from('stories')
          .delete().in('id', expired.map(row => row.id))
        if (deleteExpiredError) throw deleteExpiredError
        const paths = expired.filter(row => row.kind === 'image' && row.media && !/^https?:\/\//i.test(row.media)).map(row => row.media)
        if (paths.length) await db.storage.from(STORY_BUCKET).remove(paths).catch(() => undefined)
      }

      const { data: rows, error: storiesError } = await db.from('stories')
        .select('id,user_id,kind,media,caption,bg,created_at,expires_at')
        .in('user_id', allowedIds)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(100)
      if (storiesError) throw storiesError

      const authors = new Map()
      const stories = await Promise.all((rows || []).map(async row => {
        let author = authors.get(row.user_id)
        if (!author) {
          author = await storyAuthor(db, row.user_id, row.user_id === user.id ? user.username : undefined)
          authors.set(row.user_id, author)
        }
        const mediaUrl = row.kind === 'image' ? await signedUrl(db, STORY_BUCKET, row.media, 60 * 10) : null
        return toStory(row, author, mediaUrl)
      }))
      return res.status(200).json({ stories })
    }

    if (req.method === 'POST') {
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.normalize('NFKC').trim() : ''
      if (caption.length > 280) return sendError(res, 400, 'Story text must be 280 characters or fewer')
      const imageDataUrl = req.body?.imageDataUrl
      if (!caption && !imageDataUrl) return sendError(res, 400, 'Add a short note or choose a photo')

      let mediaPath = null
      let kind = 'text'
      if (imageDataUrl !== undefined) {
        const image = decodeImageDataUrl(imageDataUrl)
        mediaPath = user.id + '/' + randomUUID() + '.' + image.ext
        const { error: uploadError } = await db.storage.from(STORY_BUCKET).upload(mediaPath, image.bytes, {
          contentType: image.mime, upsert: false, cacheControl: '3600'
        })
        if (uploadError) throw uploadError
        kind = 'image'
      }

      const createdAt = new Date()
      const { data: story, error: insertError } = await db.from('stories').insert({
        user_id: user.id,
        kind,
        caption,
        media: mediaPath,
        created_at: createdAt.toISOString(),
        expires_at: new Date(createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
      }).select('id,user_id,kind,media,caption,bg,created_at,expires_at').single()

      if (insertError) {
        if (mediaPath) await db.storage.from(STORY_BUCKET).remove([mediaPath]).catch(() => undefined)
        throw insertError
      }
      const author = await storyAuthor(db, user.id, user.username)
      const mediaUrl = mediaPath ? await signedUrl(db, STORY_BUCKET, mediaPath, 60 * 10) : null
      return res.status(201).json({ story: toStory(story, author, mediaUrl) })
    }

    const storyId = typeof req.body?.id === 'string' ? req.body.id : ''
    if (!storyId) return sendError(res, 400, 'Story ID is required')
    const { data: story, error: findError } = await db.from('stories')
      .select('id,kind,media')
      .eq('id', storyId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (findError) throw findError
    if (!story) return sendError(res, 404, 'Story not found')

    const { error: deleteError } = await db.from('stories').delete()
      .eq('id', storyId).eq('user_id', user.id)
    if (deleteError) throw deleteError
    if (story.kind === 'image' && story.media && !/^https?:\/\//i.test(story.media)) {
      await db.storage.from(STORY_BUCKET).remove([story.media]).catch(() => undefined)
    }
    return res.status(200).json({ deleted: true })
  } catch (error) {
    if (error instanceof Error && /Story photo|Choose a valid|Image content/.test(error.message)) return sendError(res, 400, error.message)
    if (error?.message?.includes('Bucket not found') || error?.code === '42P01' || error?.code === 'PGRST205') {
      return sendError(res, 503, 'Stories are not initialized yet. Apply migration 010_profile_stories.sql in Supabase.')
    }
    console.error('Stories API error:', error?.code || error?.name || 'story_request_failed')
    return sendError(res, 500, 'Could not process stories')
  }
}

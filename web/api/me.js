import { getDb, readBearer, sendError, isTokenRevoked, randomUUID, createRealtimeChannelToken } from './_lib/auth.js'
import storiesHandler from './_lib/stories.js'

const PROFILE_BUCKET = 'newgen-profile-media'
const AVATAR_MAX_BYTES = 1024 * 1024

async function currentUser(req, db) {
  const token = readBearer(req)
  if (!token?.sub) return null
  const { data, error } = await db.from('app_users')
    .select('id,username,token_version')
    .eq('id', token.sub)
    .maybeSingle()
  if (error) throw error
  if (!data || Number(data.token_version) !== Number(token.ver || 0) || await isTokenRevoked(db, token)) return null
  return { ...data, sessionJti: token.jti, sessionExpiresAt: token.exp }
}

function decodeImageDataUrl(value, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes * 4 / 3) + 128) {
    throw new Error('Profile photo must be 1 MB or smaller.')
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) throw new Error('Choose a valid PNG, JPG or WebP image.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Profile photo must be 1 MB or smaller.')
  const mime = 'image/' + match[1]
  const valid = mime === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid) throw new Error('Image content does not match its file type.')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  return { bytes, mime, ext }
}

async function signedAvatar(db, path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  const { data, error } = await db.storage.from(PROFILE_BUCKET).createSignedUrl(path, 60 * 60 * 12)
  if (error) throw error
  return data?.signedUrl || null
}

async function profileResponse(db, user) {
  const { data, error } = await db.from('profiles')
    .select('id,username,display_name,avatar_url,bio,created_at,updated_at,last_seen_at')
    .eq('id', user.id)
    .maybeSingle()
  if (error) throw error
  const row = data || {
    id: user.id, username: user.username, display_name: user.username,
    avatar_url: null, bio: null, created_at: null, updated_at: null, last_seen_at: null
  }
  return { ...row, avatar_url: await signedAvatar(db, row.avatar_url) }
}

export default async function handler(req, res) {
  if (req.query?.resource === 'stories') return storiesHandler(req, res)
  res.setHeader('Cache-Control', 'no-store')
  if (!['GET', 'PATCH'].includes(req.method)) return sendError(res, 405, 'Method not allowed')
  try {
    const db = getDb()
    const user = await currentUser(req, db)
    if (!user) return sendError(res, 401, 'Authentication required')

    if (req.method === 'GET') {
      let realtimeChannelToken = null
      const channelSetup = user.sessionJti && Number.isFinite(Number(user.sessionExpiresAt))
        ? (async () => {
            realtimeChannelToken = createRealtimeChannelToken({ jti: user.sessionJti })
            const { error } = await db.from('realtime_session_channels').upsert({
              session_jti: user.sessionJti,
              user_id: user.id,
              channel_token: realtimeChannelToken,
              expires_at: new Date(Number(user.sessionExpiresAt) * 1000).toISOString(),
            }, { onConflict: 'session_jti' })
            if (error) throw error
          })()
        : Promise.resolve()
      const [profile] = await Promise.all([profileResponse(db, user), channelSetup])
      return res.status(200).json({
        user: { id: user.id, username: user.username },
        profile,
        realtimeChannelToken,
      })
    }

    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.normalize('NFKC').trim() : ''
    const bio = typeof req.body?.bio === 'string' ? req.body.bio.trim() : ''
    if (displayName.length < 2 || displayName.length > 40) return sendError(res, 400, 'Display name must be 2–40 characters')
    if (bio.length > 160) return sendError(res, 400, 'Bio must be 160 characters or fewer')

    const { data: previous, error: previousError } = await db.from('profiles')
      .select('avatar_url')
      .eq('id', user.id)
      .maybeSingle()
    if (previousError) throw previousError

    let avatarPath = previous?.avatar_url || null
    let uploadedPath = null
    if (req.body?.removeAvatar === true) avatarPath = null
    if (req.body?.avatarDataUrl !== undefined) {
      const image = decodeImageDataUrl(req.body.avatarDataUrl, AVATAR_MAX_BYTES)
      uploadedPath = user.id + '/' + randomUUID() + '.' + image.ext
      const { error: uploadError } = await db.storage.from(PROFILE_BUCKET).upload(uploadedPath, image.bytes, {
        contentType: image.mime, upsert: false, cacheControl: '3600'
      })
      if (uploadError) throw uploadError
      avatarPath = uploadedPath
    }

    const now = new Date().toISOString()
    const { data: saved, error: saveError } = await db.from('profiles').upsert({
      id: user.id,
      username: user.username,
      display_name: displayName,
      avatar_url: avatarPath,
      bio,
      updated_at: now
    }, { onConflict: 'id' })
      .select('id,username,display_name,avatar_url,bio,created_at,updated_at,last_seen_at')
      .single()

    if (saveError) {
      if (uploadedPath) await db.storage.from(PROFILE_BUCKET).remove([uploadedPath]).catch(() => undefined)
      throw saveError
    }

    const previousPath = previous?.avatar_url
    if (previousPath && previousPath !== avatarPath && !/^https?:\/\//i.test(previousPath)) {
      await db.storage.from(PROFILE_BUCKET).remove([previousPath]).catch(() => undefined)
    }
    return res.status(200).json({ profile: { ...saved, avatar_url: await signedAvatar(db, saved.avatar_url) } })
  } catch (error) {
    if (error?.message?.includes('Bucket not found')) {
      return sendError(res, 503, 'Profile media storage is not initialized. Apply web/database/migrations/010_profile_stories.sql in Supabase.')
    }
    if (error instanceof Error && /Profile photo|Choose a valid|Image content/.test(error.message)) return sendError(res, 400, error.message)
    console.error('Profile API error:', error?.code || error?.name || 'profile_request_failed')
    return sendError(res, 500, 'Could not update your profile')
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, access } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'

const root = resolve(process.cwd(), '..')
const read = path => readFile(resolve(root, path), 'utf8')

test('Web profile API keeps profile media private and validates uploads', async () => {
  const source = await read('web/api/me.js')
  assert.match(source, /readBearer/)
  assert.match(source, /isTokenRevoked/)
  assert.match(source, /newgen-profile-media/)
  assert.match(source, /createSignedUrl/)
  assert.match(source, /Image content does not match/)
  assert.match(source, /AVATAR_MAX_BYTES/)
})

test('Web stories are routed through an authenticated handler and match the deployed schema', async () => {
  const route = await read('web/api/me.js')
  const source = await read('web/api/_lib/stories.js')
  assert.match(route, /resource === 'stories'/)
  assert.match(route, /storiesHandler\(req, res\)/)
  assert.match(source, /readBearer/)
  assert.match(source, /isTokenRevoked/)
  assert.match(source, /from\('friendships'\)/)
  assert.match(source, /allowedIds/)
  assert.match(source, /24 \* 60 \* 60 \* 1000/)
  assert.match(source, /newgen-story-media/)
  assert.match(source, /createSignedUrl/)
  assert.match(source, /eq\('user_id', user\.id\)/)
  assert.match(source, /select\('id,user_id,kind,media,caption,bg,created_at,expires_at'\)/)
  assert.doesNotMatch(source, /story_type,media_path/)
})

test('profile and story migration matches the custom-account schema and keeps media private', async () => {
  const source = await read('web/database/migrations/010_profile_stories.sql')
  assert.match(source, /kind TEXT NOT NULL/)
  assert.match(source, /media TEXT/)
  assert.match(source, /story_views/)
  assert.match(source, /REVOKE ALL ON TABLE public\.stories FROM anon, authenticated/)
  assert.match(source, /public = FALSE/)
  assert.match(source, /INTERVAL '24 hours'/)
})

test('Vercel Hobby deploy contains no more than 12 serverless API routes', async () => {
  const apiRoot = resolve(root, 'web/api')
  const collect = async dir => {
    const entries = await readdir(dir, { withFileTypes: true })
    const out = []
    for (const entry of entries) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('_')) out.push(...await collect(full))
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const rel = relative(apiRoot, full).split(sep)
        if (!rel.some(part => part.startsWith('_'))) out.push(full)
      }
    }
    return out
  }
  const routes = await collect(apiRoot)
  assert.equal(routes.length, 12, 'Hobby deployment must contain exactly 12 route handlers')
  await assert.rejects(access(resolve(root, 'web/api/stories/index.js')))
})

test('custom-JWT web data tables are server-only and foreign keys are indexed', async () => {
  const source = await read('web/database/migrations/011_server_only_data_access.sql')
  assert.ok(source.includes('REVOKE ALL ON TABLE'))
  assert.ok(source.includes('public.messages'))
  assert.ok(source.includes('FROM PUBLIC, anon, authenticated'))
  assert.match(source, /DROP POLICY IF EXISTS "members_insert"/)
  assert.match(source, /DROP POLICY IF EXISTS "messages_insert"/)
  assert.match(source, /conversation_members_user_id_idx/)
  assert.match(source, /friend_requests_requester_id_idx/)
  assert.match(source, /story_views_viewer_id_idx/)
})

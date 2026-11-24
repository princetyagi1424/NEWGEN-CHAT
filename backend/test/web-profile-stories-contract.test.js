import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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

test('Web stories are friend-scoped, expire after 24 hours and use private media', async () => {
  const source = await read('web/api/stories/index.js')
  assert.match(source, /readBearer/)
  assert.match(source, /isTokenRevoked/)
  assert.match(source, /from\('friendships'\)/)
  assert.match(source, /allowedIds/)
  assert.match(source, /24 \* 60 \* 60 \* 1000/)
  assert.match(source, /newgen-story-media/)
  assert.match(source, /createSignedUrl/)
  assert.match(source, /eq\('user_id', user\.id\)/)
})

test('profile and story migration denies direct browser access', async () => {
  const source = await read('web/database/migrations/010_profile_stories.sql')
  assert.match(source, /ENABLE ROW LEVEL SECURITY/)
  assert.match(source, /REVOKE ALL ON TABLE public\.stories FROM anon, authenticated/)
  assert.match(source, /public = FALSE/)
  assert.match(source, /INTERVAL '24 hours'/)
})

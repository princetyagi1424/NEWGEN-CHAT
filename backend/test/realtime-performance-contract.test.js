import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const read = path => readFile(resolve(root, path), 'utf8')

test('chat uses server-triggered realtime invalidation on opaque per-session topics', async () => {
  const migration = await read('web/database/migrations/012_realtime_delivery_and_fast_reads.sql')
  const me = await read('web/api/me.js')
  const authLibrary = await read('web/api/_lib/auth.js')
  const auth = await read('web/src/lib/auth.tsx')
  const chat = await read('web/src/pages/ChatApp.tsx')

  assert.match(migration, /realtime_session_channels/)
  assert.match(migration, /realtime\.send\(/)
  assert.match(migration, /AFTER INSERT OR UPDATE OF status ON public\.friend_requests/)
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON public\.messages/)
  assert.match(migration, /REVOKE ALL ON TABLE public\.realtime_session_channels FROM PUBLIC, anon, authenticated/)
  assert.match(authLibrary, /createHmac\('sha256'/)
  assert.match(me, /realtime_session_channels/)
  assert.match(me, /realtimeChannelToken/)
  assert.match(auth, /realtimeChannelToken/)
  assert.match(chat, /\.on\('broadcast', \{ event: 'refresh' \}/)
  assert.match(chat, /user:\$\{realtimeChannelToken\}/)
  assert.doesNotMatch(chat, /api\/realtime\/session/)
})

test('message timeline fetches only new rows after the latest timestamp', async () => {
  const chat = await read('web/src/pages/ChatApp.tsx')
  const api = await read('web/api/messages/index.js')
  assert.doesNotMatch(chat, /2500/)
  assert.match(chat, /refreshNewMessages/)
  assert.match(chat, /30000/)
  assert.match(api, /req\.query\?\.after/)
  assert.match(api, /created_at\.gt\.\$\{afterCreatedAt\}/)
  assert.match(api, /id\.gt\.\$\{afterId\}/)
  assert.match(api, /limit\(after \? 100 : 200\)/)
})

test('message sends render optimistically and do not reload the complete history', async () => {
  const chat = await read('web/src/pages/ChatApp.tsx')
  const start = chat.indexOf('async function sendMessage()')
  const end = chat.indexOf('const displayName =', start)
  assert.ok(start >= 0 && end > start)
  const send = chat.slice(start, end)
  assert.match(send, /optimistic:/)
  assert.match(send, /result\.message/)
  assert.doesNotMatch(send, /apiRequest\(.*\/api\/messages.*GET/s)
  assert.doesNotMatch(send, /loadConversations\(\)/)
})

test('chat list and friend requests use consolidated database functions', async () => {
  const conversations = await read('web/api/conversations/index.js')
  const friends = await read('web/api/friends/requests.js')
  const migration = await read('web/database/migrations/012_realtime_delivery_and_fast_reads.sql')
  assert.match(conversations, /rpc\('get_user_conversation_summaries'/)
  assert.match(friends, /rpc\('get_user_friend_requests'/)
  assert.match(friends, /rpc\('respond_friend_request'/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_user_conversation_summaries/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.respond_friend_request/)
})

test('registration avoids serial hashing and provisions profile transactionally', async () => {
  const register = await read('web/api/auth/register.js')
  const auth = await read('web/src/lib/auth.tsx')
  const migration = await read('web/database/migrations/013_atomic_profile_and_message_writes.sql')
  assert.match(register, /Promise\.all\(\[/)
  assert.doesNotMatch(register, /profiles'\)\.upsert/)
  assert.match(auth, /void getOrCreateDeviceIdentity\(\)/)
  assert.match(migration, /AFTER INSERT ON public\.app_users/)
  assert.match(migration, /UPDATE public\.conversations/)
})

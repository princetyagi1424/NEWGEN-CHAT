const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const keys = fs.readFileSync(path.join(repo, 'web/src/crypto/keys.ts'), 'utf8');
const localStore = fs.readFileSync(path.join(repo, 'web/src/lib/localStore.ts'), 'utf8');
const schema = fs.readFileSync(path.join(repo, 'web/supabase/migrations/001_initial_schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(repo, 'web/database/migrations/004_membership_rls_hardening.sql'), 'utf8');
const writeMigration = fs.readFileSync(path.join(repo, 'web/database/migrations/006_server_only_conversation_writes.sql'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const chatPin = fs.readFileSync(path.join(repo, 'web/api/auth/chat-pin.js'), 'utf8');

test('browser device identity reimports the private key as non-extractable and wipes temporary bytes', () => {
  assert.match(keys, /generateKey\(\{ name: 'ECDH', namedCurve: 'P-256' \}, true/);
  assert.match(localStore, /exportKey\('pkcs8', pair\.privateKey\)/);
  assert.match(localStore, /importKey\([\s\S]*?false, \['deriveKey', 'deriveBits'\]/);
  assert.match(localStore, /privateKeyBytes\.fill\(0\)/);
  assert.doesNotMatch(localStore, /exportPrivateKey|importPrivateKey/);
  assert.match(keys, /importKey\('pkcs8',[\s\S]*?false, \['deriveKey', 'deriveBits'\]/);
});

test('Supabase conversation membership cannot be self-inserted or self-promoted', () => {
  assert.doesNotMatch(schema, /create policy "members_insert"/i);
  assert.doesNotMatch(schema, /create policy "members_update"/i);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.conversation_members FROM anon, authenticated/i);
  assert.match(migration, /DROP POLICY IF EXISTS "members_insert"/i);
  assert.match(migration, /DROP POLICY IF EXISTS "members_update"/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.conversation_members FROM anon, authenticated/i);
});

test('group ownership transfer is restricted to owner and preserves an admin', () => {
  assert.match(server, /app\.post\('\/api\/groups\/:groupId\/transfer-ownership'/);
  assert.match(server, /group\.owner_id!==req\.user\.id/);
  assert.match(server, /New owner must already be a group member/);
  assert.match(server, /UPDATE groups_chat SET owner_id=\?/);
  assert.match(server, /UPDATE group_members SET role='member'/);
  assert.match(server, /UPDATE group_members SET role='admin'/);
  assert.match(server, /Transfer group ownership before removing the owner/);
  assert.match(server, /Only the group owner can remove another admin/);
  assert.match(server, /target\.role==='admin' && group\.owner_id!==req\.user\.id && req\.params\.userId!==req\.user\.id/);
});

test('browser membership reads are self-only and avoid recursive RLS subqueries', () => {
  const policy = schema.match(/create policy "members_select"[\s\S]*?\);/i)?.[0] || '';
  const migratedPolicy = migration.match(/CREATE POLICY "members_select"[\s\S]*?\);/i)?.[0] || '';
  assert.match(policy, /user_id = auth\.uid\(\)/);
  assert.match(migratedPolicy, /user_id = auth\.uid\(\)/);
  assert.doesNotMatch(policy, /FROM public\.conversation_members/i);
  assert.doesNotMatch(migratedPolicy, /FROM public\.conversation_members/i);
});

test('conversation and message writes cannot bypass the authenticated server APIs', () => {
  assert.doesNotMatch(schema, /create policy "conv_insert"/i);
  assert.doesNotMatch(schema, /create policy "messages_insert"/i);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.conversations FROM anon, authenticated/i);
  assert.match(schema, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.messages FROM anon, authenticated/i);
  assert.match(schema, /messages_select[\s\S]*?messages\.conversation_id/);
});

test('unimplemented web chat actions are visibly disabled rather than dead clickable buttons', () => {
  const chat = fs.readFileSync(path.join(repo, 'web/src/pages/ChatApp.tsx'), 'utf8');
  assert.match(chat, /Audio calls are not available yet[^>]*aria-disabled="true" disabled/);
  assert.match(chat, /More options are not available yet[^>]*aria-disabled="true" disabled/);
  assert.match(chat, /Attachments are not enabled on web yet/);
  const attachmentButton = chat.match(/<button[^>]*Attachments are not enabled on web yet[^>]*>/)?.[0] || '';
  assert.match(attachmentButton, /aria-disabled="true" disabled/);
});

test('existing Supabase projects receive server-only conversation and message write permissions', () => {
  assert.match(writeMigration, /DROP POLICY IF EXISTS "conv_insert"/i);
  assert.match(writeMigration, /DROP POLICY IF EXISTS "messages_insert"/i);
  assert.match(writeMigration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.conversations FROM anon, authenticated/i);
  assert.match(writeMigration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.messages FROM anon, authenticated/i);
  assert.match(writeMigration, /ALTER TABLE public\.conversations ENABLE ROW LEVEL SECURITY/i);
  assert.match(writeMigration, /ALTER TABLE public\.messages ENABLE ROW LEVEL SECURITY/i);
});

test('server error logs do not print raw exception messages', () => {
  assert.match(server, /console\.error\('Request failed:',\s*err\?\.code \|\| err\?\.name \|\| 'internal_error'\)/);
  assert.match(chatPin, /console\.error\('Chat PIN API error:', error\?\.code \|\| error\?\.name \|\| 'service_error'\)/);
  assert.doesNotMatch(server, /console\.error\([^\n]*\.message/);
  assert.doesNotMatch(chatPin, /console\.error\([^\n]*\.message/);
});

test('Web-issued JWTs have server-side revocation and authenticated routes enforce it', () => {
  const helper = fs.readFileSync(path.join(repo, 'web/api/_lib/auth.js'), 'utf8');
  const logout = fs.readFileSync(path.join(repo, 'web/api/auth/logout.js'), 'utf8');
  const logoutAll = fs.readFileSync(path.join(repo, 'web/api/auth/logout-all.js'), 'utf8');
  const migration = fs.readFileSync(path.join(repo, 'web/database/migrations/007_web_session_revocation.sql'), 'utf8');
  assert.match(helper, /jti: randomUUID\(\)/);
  assert.match(helper, /export async function isTokenRevoked/);
  assert.match(helper, /\.eq\('jti', token\.jti\)/);
  assert.match(logout, /export default async function handler/);
  assert.match(logout, /revoked_tokens/);
  assert.match(logout, /expires_at/);
  assert.match(logoutAll, /token_version/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.revoked_tokens/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.revoked_tokens FROM anon, authenticated/);
  for (const file of [
    'web/api/auth/chat-pin.js',
    'web/api/conversations/index.js',
    'web/api/conversations/direct.js',
    'web/api/messages/index.js',
    'web/api/friends/requests.js',
    'web/api/users/search.js',
    'web/api/me.js'
  ]) {
    const source = fs.readFileSync(path.join(repo, file), 'utf8');
    assert.match(source, /isTokenRevoked/, file);
  }
});

test('Web login, registration, and password recovery use atomic account plus network rate limits', () => {
  const helper = fs.readFileSync(path.join(repo, 'web/api/_lib/auth.js'), 'utf8');
  const login = fs.readFileSync(path.join(repo, 'web/api/auth/login.js'), 'utf8');
  const register = fs.readFileSync(path.join(repo, 'web/api/auth/register.js'), 'utf8');
  const recover = fs.readFileSync(path.join(repo, 'web/api/auth/recover.js'), 'utf8');
  const baseSchema = fs.readFileSync(path.join(repo, 'web/database/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(repo, 'web/database/migrations/008_atomic_web_auth_rate_limit.sql'), 'utf8');
  assert.match(helper, /export async function consumeAuthAttempt/);
  assert.match(helper, /hashAuthAttemptIdentity/);
  assert.match(helper, /createHash\('sha256'\)/);
  assert.match(login, /consumeAuthAttempt\(db, req, input\.username, 10\)/);
  assert.match(register, /consumeAuthAttempt\(db, req, input\.username, 5\)/);
  assert.match(recover, /consumeAuthAttempt\(db, req, input\.username, 5\)/);
  assert.match(baseSchema, /CREATE TABLE IF NOT EXISTS public\.account_auth_attempts/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /ip_hash = p_ip_hash/);
  assert.match(migration, /account_hash = p_account_hash/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.doesNotMatch(recover, /newgen-recovery-throttle/);
});

test('Supabase profile data is server-only and browser clients cannot forge message receipts', () => {
  const supabaseSchema = fs.readFileSync(path.join(repo, 'web/supabase/migrations/001_initial_schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(repo, 'web/database/migrations/009_profile_and_receipt_rls_hardening.sql'), 'utf8');
  assert.match(supabaseSchema, /REVOKE ALL ON TABLE public\.profiles FROM anon, authenticated/i);
  assert.doesNotMatch(supabaseSchema, /create policy "profiles_select"[^;]*using \(true\)/i);
  assert.match(supabaseSchema, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.message_receipts FROM anon, authenticated/i);
  assert.match(migration, /DROP POLICY IF EXISTS "profiles_select"/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.profiles FROM anon, authenticated/i);
  assert.match(migration, /DROP POLICY IF EXISTS "receipts_own"/i);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.message_receipts FROM anon, authenticated/i);
});

test('Web exposes an explicit confirmed all-device sign-out action', () => {
  const auth = fs.readFileSync(path.join(repo, 'web/src/lib/auth.tsx'), 'utf8');
  const chat = fs.readFileSync(path.join(repo, 'web/src/pages/ChatApp.tsx'), 'utf8');
  assert.match(auth, /signOutAll: \(\) => Promise<void>/);
  assert.match(auth, /\/api\/auth\/logout-all/);
  assert.match(auth, /await clearLocalData\(\)/);
  assert.match(chat, /Log out all devices/);
  assert.match(chat, /window\.confirm\('Log out this account on every device\?/);
  assert.match(chat, /signOutAll\(\)/);
});

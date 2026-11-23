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
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');

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

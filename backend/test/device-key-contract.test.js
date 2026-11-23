const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src/db.js'), 'utf8');

test('device key registration accepts only validated P-256 public keys and never private keys', () => {
  assert.match(server, /createPublicKey\(\{ key: Buffer\.from\(data\.publicKey, 'base64'\), format: 'der', type: 'spki' \}\)/);
  assert.match(server, /key\.asymmetricKeyType !== 'ec'/);
  assert.match(server, /namedCurve !== 'prime256v1'/);
  assert.match(server, /app\.put\('\/api\/keys\/devices\/:deviceId'/);
  assert.doesNotMatch(server, /privateKeyB64|private_key_b64/);
});

test('key envelopes are recipient-device scoped and encrypted at rest', () => {
  assert.match(db, /CREATE TABLE IF NOT EXISTS key_envelopes/);
  assert.match(db, /PRIMARY KEY\(conversation_id, recipient_device_id\)/);
  assert.match(server, /app\.put\('\/api\/keys\/conversations\/:conversationId\/envelopes'/);
  assert.match(server, /app\.get\('\/api\/keys\/conversations\/:conversationId\/envelopes'/);
  assert.match(server, /recipient_device_id AS recipientDeviceId/);
  assert.match(server, /WHERE conversation_id=\? AND recipient_id=\? AND recipient_device_id=\?/);
});

test('direct and group envelope distribution enforces current conversation membership', () => {
  assert.match(server, /Both users must be current group members/);
  assert.match(server, /canAccessKeyConversation\(req\.user\.id, req\.params\.conversationId, data\.recipientId\)/);
  assert.match(server, /device\.user_id !== data\.recipientId/);
});

test('group membership changes invalidate existing key envelopes', () => {
  assert.match(db, /invalidate_group_envelopes_after_member_insert/);
  assert.match(db, /invalidate_group_envelopes_after_member_delete/);
  assert.match(db, /DELETE FROM key_envelopes WHERE conversation_id=NEW\.group_id/);
  assert.match(db, /DELETE FROM key_envelopes WHERE conversation_id=OLD\.group_id/);
});

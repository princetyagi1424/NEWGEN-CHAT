const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src', 'db.js'), 'utf8');
const android = path.resolve(root, '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app', 'data', 'NewgenApi.kt');
const client = fs.readFileSync(android, 'utf8');

test('account recovery code is hashed and single-use; account deletion is authenticated', () => {
  assert.match(server, /randomBytes\(24\)/);
  assert.match(server, /createHash\('sha256'\)/);
  assert.match(server, /DELETE FROM account_recovery WHERE user_id=\?/);
  assert.match(server, /app\.delete\('\/api\/account'/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS account_recovery/);
});

test('encrypted media is opaque and recipient-bound', () => {
  assert.match(server, /ciphertextB64/);
  assert.match(server, /recipientId/);
  assert.match(server, /Media recipient must be an accepted friend/);
  assert.match(server, /media\.recipient_id!==req\.user\.id/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS media_blobs/);
});

test('typing indicator access requires membership/friendship and expires quickly', () => {
  assert.match(server, /function canAccessTypingRoom/);
  assert.match(server, /group_members WHERE group_id=\? AND user_id=\?/);
  assert.match(server, /friendshipBetween\(parts\[0\],parts\[1\]\)/);
  assert.match(server, /Date\.now\(\)\+5000/);
});

test('direct messages can expire and status viewers are private to owner', () => {
  assert.match(server, /expiresInSeconds/);
  assert.match(server, /DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at<=\?/);
  assert.match(server, /status_views/);
  assert.match(server, /status\.user_id!==req\.user\.id/);
});

test('Android client exposes APIs for chat, group, status, media and presence', () => {
  for (const method of ['sendMessage(', 'getMessages(', 'createGroup(', 'postStatus(', 'uploadEncryptedMedia(', 'heartbeat(', 'setTyping(']) {
    assert.ok(client.includes(method), `missing ${method}`);
  }
});


test('media upload JSON body limit supports encrypted payloads and validates canonical base64', () => {
  assert.match(server, /express\.json\(\{ limit: '10mb' \}\)/);
  assert.match(server, /decoded\.toString\('base64'\)!==data\.ciphertextB64/);
  assert.match(server, /decoded\.length>6_000_000/);
});


test('Android client supports encrypted binary media and status lifecycle APIs', () => {
  const cipher = fs.readFileSync(path.resolve(root, '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app', 'security', 'ChatCipher.kt'), 'utf8');
  assert.match(cipher, /fun encryptBytes/);
  assert.match(cipher, /fun decryptBytes/);
  for (const method of ['getStatuses(', 'reactToStatus(', 'replyToStatus(', 'markStatusViewed(', 'getEncryptedMedia(']) {
    assert.ok(client.includes(method) || fs.readFileSync(path.resolve(root, '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app', 'data', 'NewgenApi.kt'), 'utf8').includes(method));
  }
});

test('status and media expiry records are purged during reads/uploads', () => {
  assert.match(server, /DELETE FROM statuses WHERE expires_at<=\?/);
  assert.match(server, /DELETE FROM media_blobs WHERE expires_at IS NOT NULL AND expires_at<=\?/);
});


test('Android encrypted-media helpers encrypt before upload and decrypt after download', () => {
  const api = fs.readFileSync(path.resolve(root, '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app', 'data', 'NewgenApi.kt'), 'utf8');
  const uploadStart = api.indexOf('suspend fun uploadMediaEncrypted(');
  const downloadStart = api.indexOf('suspend fun downloadAndDecryptMedia(', uploadStart);
  const deleteStart = api.indexOf('suspend fun deleteAccount(', downloadStart);
  const uploadBlock = api.slice(uploadStart, downloadStart);
  const downloadBlock = api.slice(downloadStart, deleteStart);
  assert.ok(uploadBlock.indexOf('ChatCipher.encryptBytes(plaintextBytes, chatPasskey)') < uploadBlock.indexOf('uploadEncryptedMedia('));
  assert.ok(downloadBlock.indexOf('getEncryptedMedia(accessToken, mediaId)') < downloadBlock.indexOf('ChatCipher.decryptBytes(envelope, chatPasskey)'));
  assert.match(api, /chatPasskey\.fill\('\\u0000'\)/);
});

test('Android account recovery methods use dedicated recovery endpoints', () => {
  const api = fs.readFileSync(path.resolve(root, '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app', 'data', 'NewgenApi.kt'), 'utf8');
  assert.match(api, /\/api\/account\/recovery-code/);
  assert.match(api, /\/api\/account\/recover-password/);
});

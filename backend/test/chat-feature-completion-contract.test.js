const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(root, '../app/src/main/java/com/newgenchat/app');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src/db.js'), 'utf8');
const ui = fs.readFileSync(path.join(appRoot, 'MainActivity.kt'), 'utf8');
const api = fs.readFileSync(path.join(appRoot, 'data/NewgenApi.kt'), 'utf8');
const mediaStore = fs.readFileSync(path.join(appRoot, 'media/PrivateMediaStore.kt'), 'utf8');

test('chat passphrase and decrypted private cache are cleared when app leaves foreground', () => {
  assert.match(ui, /Lifecycle\.Event\.ON_STOP/);
  assert.match(ui, /if \(event == Lifecycle\.Event\.ON_STOP && latestActiveChat != null\) \{\s*lockRequest\+\+/);
  assert.match(ui, /latestPendingAttachment\?\.let/);
  assert.match(ui, /pendingAttachmentUri/);
  assert.match(ui, /PrivateMediaStore\(context\)\.clearAll\(\)/);
  assert.match(ui, /chatKey\?\.fill\('\\u0000'\)/);
});

test('message forwarding is visible for direct text messages and re-encrypts for destination key', () => {
  assert.match(ui, /Text\("Forward"/);
  assert.match(ui, /forwardPasskey/);
  assert.match(ui, /MessageSharing\.forward\(/);
  assert.match(ui, /message\.attachment == null/);
});

test('direct and group messages support expiry on send and server-side cleanup', () => {
  assert.match(ui, /Auto-delete:/);
  assert.match(api, /sendGroupMessage\([\s\S]*?expiresInSeconds: Int\? = null/);
  assert.match(server, /DELETE FROM group_messages WHERE expires_at IS NOT NULL AND expires_at<=\?/);
  assert.match(db, /group_messages[\s\S]*?expires_at INTEGER/);
  assert.match(db, /ALTER TABLE group_messages ADD COLUMN expires_at INTEGER/);
});

test('blocked users can be managed from Settings and blocking is available in a direct chat', () => {
  assert.match(ui, /Blocked accounts/);
  assert.match(ui, /NewgenApi\.unblockUser\(/);
  assert.match(ui, /NewgenApi\.blockUser\(/);
  assert.match(api, /getBlockedUsers\(/);
});

test('attachment messages upload ciphertext only and group media access requires membership', () => {
  assert.match(ui, /ActivityResultContracts\.OpenDocument\(\)/);
  assert.doesNotMatch(ui, /LaunchedEffect\(chatKey != null, pendingAttachmentUri\)/);
  assert.match(ui, /generation != unlockGeneration \|\| chatKey == null/);
  assert.match(ui, /The chat locked while uploading/);
  assert.match(ui, /uploadMediaEncrypted\(/);
  assert.match(ui, /downloadAndDecryptMedia\(/);
  assert.match(ui, /mediaStore\.writeDecrypted\(/);
  assert.match(ui, /MediaPlayer\(/);
  assert.match(ui, /VideoView\(/);
  assert.match(mediaStore, /maxBytes: Int = 6 \* 1024 \* 1024/);
  assert.match(server, /You must be a group member to upload group media/);
  assert.match(server, /const groupMember=media\.group_id/);
  assert.match(api, /if \(groupId != null\) body\.put\("groupId", groupId\)/);
});

test('PBKDF2 and media crypto work off the Android main thread', () => {
  assert.match(ui, /withContext\(Dispatchers\.Default\) \{ ChatCipher\.encrypt\(/);
  assert.match(ui, /withContext\(Dispatchers\.Default\) \{ decryptPayload\(/);
  assert.match(api, /withContext\(Dispatchers\.Default\) \{ ChatCipher\.encryptBytes/);
  assert.match(api, /withContext\(Dispatchers\.Default\) \{ ChatCipher\.decryptBytes/);
  const sharing = fs.readFileSync(path.join(appRoot, 'data/MessageSharing.kt'), 'utf8');
  assert.match(sharing, /withContext\(Dispatchers\.Default\) \{ ChatCipher\.decryptBytes/);
  assert.match(sharing, /withContext\(Dispatchers\.Default\) \{ ChatCipher\.encryptBytes/);
});

test('chat lock wipes in-flight operation passkeys and failed sends cannot restore a locked draft', () => {
  assert.match(ui, /transientPasskeys\.forEach\s*\{\s*it\.fill/);
  assert.match(ui, /transientPasskeys\.clear\(\)/);
  assert.match(ui, /sendGeneration == unlockGeneration && chatKey != null/);
  assert.match(ui, /transientPasskeys\.remove\(secret\)/);
});

test('temporary plaintext media and forwarded message buffers are wiped after encryption', () => {
  assert.match(ui, /media\.bytes\.fill\(0\)/);
  assert.match(api, /plaintextBytes\.fill\(0\)/);
  const sharing = fs.readFileSync(path.join(appRoot, 'data/MessageSharing.kt'), 'utf8');
  assert.match(sharing, /clear\.fill\(0\)/);
  assert.match(sharing, /plaintext\?\.fill\(0\)/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '../../app/src/main/java/com/newgenchat/app');
const ui = fs.readFileSync(path.join(app, 'MainActivity.kt'), 'utf8');
const api = fs.readFileSync(path.join(app, 'data/NewgenApi.kt'), 'utf8');
const vault = fs.readFileSync(path.join(app, 'security/SessionStore.kt'), 'utf8');

test('Android chat screen uses live direct and group message APIs and local encryption', () => {
  assert.match(ui, /NewgenApi\.getMessages\(/);
  assert.match(ui, /NewgenApi\.getGroupMessages\(/);
  assert.match(ui, /NewgenApi\.sendMessage\(/);
  assert.match(ui, /NewgenApi\.sendGroupMessage\(/);
  assert.match(ui, /ChatCipher\.encrypt\(/);
  assert.match(ui, /decryptPayload\(/);
  assert.doesNotMatch(ui, /sampleChats|This is a sample encrypted conversation/);
});

test('Android UI exposes account recovery, username search, friend requests, statuses and groups', () => {
  for (const term of ['recoverPassword(', 'searchUsers(', 'sendFriendRequest(', 'acceptFriendRequest(', 'getStatusFeed(', 'postStatus(', 'createGroup(']) {
    assert.ok(api.includes(term) || ui.includes(term), `missing ${term}`);
  }
});

test('API sessions are stored encrypted with an Android Keystore AES-GCM key', () => {
  assert.match(vault, /AndroidKeyStore/);
  assert.match(vault, /AES\/GCM\/NoPadding/);
  assert.match(vault, /KeyGenParameterSpec/);
  assert.match(vault, /cipher\.doFinal/);
});

test('conversation lock clears chat passkey and decrypted transcript state', () => {
  assert.match(ui, /chatKey\?\.fill\('\\u0000'\)/);
  assert.match(ui, /chatKey = null/);
  assert.match(ui, /messages = emptyList\(\)/);
});

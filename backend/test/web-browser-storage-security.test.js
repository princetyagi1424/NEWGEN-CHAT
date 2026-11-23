const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const localStore = fs.readFileSync(path.join(root, 'web/src/lib/localStore.ts'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'web/src/lib/auth.tsx'), 'utf8');

test('browser database no longer persists plaintext decrypted messages or conversation keys', () => {
  assert.match(localStore, /const DB_VERSION = 3/);
  assert.doesNotMatch(localStore, /messageCache:\s*\{|conversationKeys:\s*\{|plaintext:\s*string|keyB64:\s*string|cacheDecryptedMessage|getCachedMessages/);
  assert.match(localStore, /oldVersion < 3/);
  assert.match(localStore, /deleteObjectStore\('messageCache'\)/);
  assert.match(localStore, /deleteObjectStore\('conversationKeys'\)/);
});

test('browser access tokens are scoped to the current tab, not persistent localStorage', () => {
  assert.match(auth, /sessionStorage\.setItem\(TOKEN_KEY/);
  assert.match(auth, /sessionStorage\.getItem\(TOKEN_KEY/);
  assert.match(auth, /sessionStorage\.removeItem\(TOKEN_KEY/);
  assert.doesNotMatch(auth, /localStorage\.setItem\(TOKEN_KEY/);
  assert.match(auth, /localStorage\.removeItem\(TOKEN_KEY\)/);
});

test('sign out clears local device and metadata stores', () => {
  assert.match(auth, /await clearLocalData\(\)/);
  assert.match(localStore, /await db\.clear\('device'\)/);
});

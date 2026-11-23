const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const appRoot = path.resolve(__dirname, '..', '..', 'app', 'src', 'main', 'java', 'com', 'newgenchat', 'app');

test('Android share use case decrypts source then encrypts destination before API call', () => {
  const file = fs.readFileSync(path.join(appRoot, 'data', 'MessageSharing.kt'), 'utf8');
  assert.ok(file.indexOf('ChatCipher.decryptBytes(sourceEnvelope, sourceChatPasskey)') < file.indexOf('ChatCipher.encryptBytes(clear, destinationChatPasskey)'));
  assert.ok(file.indexOf('ChatCipher.encryptBytes(clear, destinationChatPasskey)') < file.indexOf('NewgenApi.forwardMessage('));
  assert.match(file, /plaintext\?\.fill\(0\)/);
  assert.match(file, /sourceChatPasskey\.fill/);
  assert.match(file, /destinationChatPasskey\.fill/);
});

test('Android API client refuses non-HTTPS base URLs and never serializes chat passkeys', () => {
  const file = fs.readFileSync(path.join(appRoot, 'data', 'NewgenApi.kt'), 'utf8');
  assert.match(file, /baseUri\.scheme\.equals\("https", ignoreCase = true\)/);
  assert.doesNotMatch(file, /put\("passkey"/);
  assert.match(file, /put\("password", password\)/);
  assert.match(file, /Authorization/);
});

test('Android activity enables FLAG_SECURE', () => {
  const file = fs.readFileSync(path.join(appRoot, 'MainActivity.kt'), 'utf8');
  assert.match(file, /WindowManager\.LayoutParams\.FLAG_SECURE/);
});

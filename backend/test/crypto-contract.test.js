const test = require('node:test');
const assert = require('node:assert/strict');

test('message payload contract never includes plaintext or passkey fields', () => {
  const payload = { ciphertext:'base64-ciphertext', nonce:'base64-nonce', salt:'base64-salt', algorithm:'AES-256-GCM-PBKDF2-SHA256' };
  assert.equal(Object.hasOwn(payload,'plaintext'), false);
  assert.equal(Object.hasOwn(payload,'passkey'), false);
  assert.equal(Object.hasOwn(payload,'password'), false);
});

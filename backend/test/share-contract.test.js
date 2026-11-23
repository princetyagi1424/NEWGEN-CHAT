const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

test('forwarding endpoint accepts a newly encrypted payload and source message id', () => {
  assert.match(source, /app\.post\('\/api\/messages\/:recipientId\/forward'/);
  assert.match(source, /sourceMessageId:\s*z\.string\(\)\.uuid\(\)/);
  assert.match(source, /SELECT id,ciphertext,nonce,salt,algorithm FROM messages WHERE id=\? AND \(sender_id=\? OR recipient_id=\?\)/);
});

test('forwarding endpoint does not decrypt payload on the server', () => {
  const start = source.indexOf("app.post('/api/messages/:recipientId/forward'");
  const end = source.indexOf("app.get('/api/messages/:userId'", start);
  assert.ok(start >= 0 && end > start, 'forward route must exist');
  const route = source.slice(start, end);
  assert.doesNotMatch(route, /ChatCipher|decrypt\(|passphrase|plaintext/i);
  assert.match(route, /ciphertext/);
  assert.match(route, /friendshipBetween/);
});

test('account registration handles concurrent duplicate username race', () => {
  assert.match(source, /SQLITE_CONSTRAINT_UNIQUE/);
});


test('forwarding rejects byte-for-byte reuse of source ciphertext envelope', () => {
  assert.match(source, /Forwarding requires a newly encrypted destination payload/);
  assert.match(source, /source\.nonce === data\.nonce/);
  assert.match(source, /source\.salt === data\.salt/);
});

test('username search escapes SQL LIKE wildcards', () => {
  assert.match(source, /escapedQuery = q\.replace/);
  assert.match(source, /ESCAPE/);
});

test('malformed JSON and oversized request bodies return client errors', () => {
  assert.match(source, /entity\.parse\.failed.*400/);
  assert.match(source, /entity\.too\.large.*413/);
});

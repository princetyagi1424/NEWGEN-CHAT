const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const push = fs.readFileSync(path.join(__dirname, '../src/push.js'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, '../../app/src/main/AndroidManifest.xml'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../../app/src/main/java/com/newgenchat/app/notifications/NewgenMessagingService.kt'), 'utf8');

test('push registration is authenticated and tokens are not returned', () => {
  assert.match(server, /app\.post\('\/api\/push\/token', requireAuth/);
  assert.match(server, /app\.delete\('\/api\/push\/token', requireAuth/);
  assert.equal((server.match(/void sendGenericPush\(/g) || []).length, 3, 'direct, forwarded and group messages trigger generic push');
  assert.match(server, /res\.status\(204\)\.end\(\)/);
});

test('push payload contains no message content or conversation identifiers', () => {
  assert.match(push, /data:\s*\{\s*kind:\s*'new_message',\s*eventId:/);
  assert.doesNotMatch(push, /ciphertext|messageText|senderName|conversationId|mediaUrl/);
  assert.match(service, /You have a new message/);
  assert.doesNotMatch(service, /message\.data\["(text|body|sender|room|conversation)"\]/);
});

test('Android declares FCM service and notification permission', () => {
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /com\.google\.firebase\.MESSAGING_EVENT/);
});

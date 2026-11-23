const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');

test('bcrypt password inputs are capped by UTF-8 byte length to prevent silent truncation', () => {
  const source = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(source, /Buffer\.byteLength\(value, 'utf8'\) <= 72/);
  assert.match(source, /newPassword:passwordSchema/);
});

test('JWT verification pins the expected HMAC algorithm and issuer', () => {
  const source = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  assert.match(source, /jwt\.verify\(token, process\.env\.JWT_SECRET, \{ issuer: 'newgen-chat', algorithms: \['HS256'\] \}\)/);
});

test('Android API transport rejects unsafe base URLs and redirects and caps response size', () => {
  const source = fs.readFileSync(path.join(root, 'app/src/main/java/com/newgenchat/app/data/NewgenApi.kt'), 'utf8');
  assert.match(source, /baseUri\.scheme\.equals\("https"/);
  assert.match(source, /baseUri\.rawUserInfo == null/);
  assert.match(source, /instanceFollowRedirects = false/);
  assert.match(source, /10 \* 1024 \* 1024/);
});

test('decrypted picker buffers expose an explicit wipe lifecycle', () => {
  const source = fs.readFileSync(path.join(root, 'app/src/main/java/com/newgenchat/app/media/PrivateMediaStore.kt'), 'utf8');
  assert.match(source, /data class PickedMedia[\s\S]*?AutoCloseable/);
  assert.match(source, /override fun close\(\) \{ bytes\.fill\(0\) \}/);
  assert.match(source, /require\(maxAgeMillis >= 0\)/);
});

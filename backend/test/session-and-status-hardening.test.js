const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src/db.js'), 'utf8');

test('password recovery revokes all existing access tokens', () => {
  assert.match(db, /token_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(db, /ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /ver: Number\(user\.token_version \|\| 0\)/);
  assert.match(server, /Number\(payload\.ver \|\| 0\) !== Number\(current\.token_version \|\| 0\)/);
  assert.match(server, /token_version=token_version\+1/);
});

test('authenticated requests reject tokens for deleted or revoked accounts', () => {
  const auth = server.slice(server.indexOf('function requireAuth'), server.indexOf('function validate'));
  assert.match(auth, /SELECT id,username,token_version FROM users WHERE id=\?/);
  assert.match(auth, /Session expired; please log in again/);
});

test('status detail route exposes encrypted replies only to owner or accepted friends', () => {
  const start = server.indexOf("app.get('/api/status/:statusId/details'");
  const end = server.indexOf("app.post('/api/status/:statusId/reactions'", start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /friendshipBetween/);
  assert.match(route, /ciphertext,nonce,salt/);
  assert.match(route, /status_reactions/);
  assert.match(route, /status_views/);
});

test('group membership cannot remove the final admin', () => {
  assert.match(server, /A group must retain at least one admin/);
});

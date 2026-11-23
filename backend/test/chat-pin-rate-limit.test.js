const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..');
const handler = fs.readFileSync(path.join(repo, 'web/api/auth/chat-pin.js'), 'utf8');
const migration = fs.readFileSync(path.join(repo, 'web/database/migrations/005_atomic_chat_pin_rate_limit.sql'), 'utf8');

test('PIN verification returns a real success response after clearing attempts', () => {
  const lines = handler.split(/\r?\n/);
  const successLine = lines.findIndex(line => /^\s*return res\.status\(200\)\.json\(\{ status: 'verified' \}\)/.test(line));
  const resetLine = lines.findIndex(line => /await resetAttempts\(db, user\.id, ipHash\)/.test(line));
  assert.ok(resetLine >= 0, 'successful verification must clear its attempt window');
  assert.ok(successLine > resetLine, 'the success response must execute after resetting attempts');
});

test('PIN and security-answer attempts use an atomic account-wide database rate limiter', () => {
  assert.match(handler, /db\.rpc\('consume_chat_pin_attempt'/);
  assert.match(handler, /if \(!\(await consumeAttempt\(db, user\.id, ipHash\)\)\)/);
  assert.match(handler, /action === 'set' \|\| action === 'change'[\s\S]*?consumeAttempt/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hashtextextended\(p_user_id::TEXT, 0\)/);
  assert.doesNotMatch(migration, /hashtextextended\(p_user_id::TEXT \|\| ':' \|\| p_ip_hash/);
  assert.doesNotMatch(migration, /AND ip_hash = p_ip_hash/);
  assert.match(migration, /COUNT\(\*\)::INTEGER/);
  assert.match(migration, /INSERT INTO public\.chat_pin_attempts/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
});

test('a correct PIN resets the current user and network attempt window', () => {
  const resetBlock = handler.slice(handler.indexOf('async function resetAttempts'), handler.indexOf('export default'));
  assert.match(resetBlock, /\.eq\('user_id', userId\)/);
  assert.doesNotMatch(resetBlock, /ip_hash/);
  assert.doesNotMatch(handler, /async function resetAttempts[\s\S]*?\.eq\('ip_hash', ipHash\)/);
  const verify = handler.slice(handler.indexOf("if (action === 'verify')"));
  assert.ok(verify.indexOf('await resetAttempts(db, user.id, ipHash)') < verify.indexOf("status: 'verified'"));
});

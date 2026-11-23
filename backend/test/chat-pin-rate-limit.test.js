const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('successful chat PIN verification clears failed attempts for that user and IP', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'web', 'api', 'auth', 'chat-pin.js'), 'utf8');
  const verifyBranch = source.slice(source.indexOf("if (action === 'verify')"));
  const success = verifyBranch.indexOf("return res.status(200).json({ status: 'verified' })");
  const reset = verifyBranch.lastIndexOf(".eq('user_id', user.id).eq('ip_hash', ipHash)", success);
  assert.ok(reset >= 0, 'successful PIN must reset the matching attempt counter');
  assert.ok(reset < success, 'attempt reset must complete before reporting verification success');
  assert.match(verifyBranch, /if \(\(count \|\| 0\) >= 8\) return sendError\(res, 429/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');

test('backend secrets and local database are excluded from Git', () => {
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /backend\/\.env/);
  assert.match(ignore, /backend\/data\//);
  assert.match(ignore, /backend\/node_modules\//);
});

test('proxy trust is opt-in and limited to one trusted hop', () => {
  const source = fs.readFileSync(path.join(root, 'backend', 'src', 'server.js'), 'utf8');
  assert.match(source, /TRUST_PROXY === '1'.*set\('trust proxy', 1\)/);
});

test('Docker runtime is unprivileged and uses a separate build stage', () => {
  const docker = fs.readFileSync(path.join(root, 'backend', 'Dockerfile'), 'utf8');
  assert.match(docker, /AS build/);
  assert.match(docker, /AS runtime/);
  assert.match(docker, /USER node/);
});

test('Dockerfile uses a valid single-character line continuation for native build dependencies', () => {
  const docker = fs.readFileSync(path.join(root, 'backend', 'Dockerfile'), 'utf8').split(/\r?\n/);
  assert.match(docker[2], /g\+\+ \\\s*$/);
  assert.doesNotMatch(docker[2], /\\\\$/);
});

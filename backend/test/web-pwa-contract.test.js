import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const read = path => readFile(resolve(root, path), 'utf8')

test('PWA manifest declares a stable installable app identity and required PNG icons', async () => {
  const manifest = JSON.parse(await read('web/public/manifest.webmanifest'))
  assert.equal(manifest.id, '/app')
  assert.equal(manifest.start_url, '/app')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.display, 'standalone')
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.type === 'image/png'))
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.type === 'image/png'))
})

test('PWA install UI handles native install events and hides after confirmed installation', async () => {
  const component = await read('web/src/components/PwaInstallPrompt.tsx')
  assert.match(component, /beforeinstallprompt/)
  assert.match(component, /appinstalled/)
  assert.match(component, /display-mode: standalone/)
  assert.match(component, /setInstalled\(true\)/)
  assert.match(component, /I’ve installed it/)
})

test('PWA service worker caches app shell but never authenticated API responses', async () => {
  const worker = await read('web/public/sw.js')
  assert.match(worker, /self\.skipWaiting\(\)/)
  assert.match(worker, /self\.clients\.claim\(\)/)
  assert.match(worker, /request\.mode === 'navigate'/)
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(worker, /url\.pathname\.startsWith\('\/rest\/v1\/'\)/)
  assert.match(worker, /PRECACHE_URLS/)
})

test('app registers the service worker and renders the persistent PWA install prompt', async () => {
  const main = await read('web/src/main.tsx')
  const app = await read('web/src/App.tsx')
  const html = await read('web/index.html')
  assert.match(main, /serviceWorker\.register\('\/sw\.js'/)
  assert.match(app, /PwaInstallPrompt/)
  assert.match(html, /rel="manifest"/)
  assert.match(html, /apple-mobile-web-app-capable/)
})

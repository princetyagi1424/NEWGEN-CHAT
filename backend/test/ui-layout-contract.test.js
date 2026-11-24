import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..')
const read = path => readFile(resolve(root, path), 'utf8')

test('chat workspace uses non-overlapping fixed panes and independent scrolling', async () => {
  const css = await read('web/src/index.css')
  const chat = await read('web/src/pages/ChatApp.tsx')

  assert.match(css, /\.newgen-app-shell\s*\{[^}]*height:\s*100dvh/s)
  assert.match(css, /\.newgen-sidebar\s*\{[^}]*min-height:\s*0/s)
  assert.match(css, /\.newgen-sidebar-list\s*\{[^}]*overflow-y:\s*auto/s)
  assert.match(css, /\.newgen-message-list\s*\{[^}]*overflow-y:\s*auto/s)
  assert.match(css, /\.newgen-chat-composer\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(chat, /newgen-message-list/)
  assert.match(chat, /newgen-chat-composer/)
  assert.match(chat, /activeId \|\| showPinSetup/)
  assert.doesNotMatch(chat, /title="Audio calls are not available yet"/)
})

test('PWA install prompt is in page flow and does not cover the chat composer', async () => {
  const app = await read('web/src/App.tsx')
  const landing = await read('web/src/pages/Landing.tsx')
  const prompt = await read('web/src/components/PwaInstallPrompt.tsx')

  assert.doesNotMatch(app, /PwaInstallPrompt/)
  assert.match(landing, /<PwaInstallPrompt\s*\/>/)
  assert.match(prompt, /<aside className="w-full px-3 py-4/)
  assert.doesNotMatch(prompt, /fixed inset-x-0 bottom-0/)
  assert.doesNotMatch(prompt, /sm:absolute/)
})

test('profile and story dialogs stay within viewport and have scrollable content', async () => {
  const css = await read('web/src/index.css')
  const profile = await read('web/src/components/ProfileEditor.tsx')
  const stories = await read('web/src/components/StoriesHub.tsx')

  assert.match(css, /\.newgen-dialog-panel\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)[^}]*overflow-y:\s*auto/s)
  assert.match(profile, /newgen-dialog-panel max-w-\[440px\]/)
  assert.match(stories, /newgen-dialog-panel max-w-\[470px\]/)
  assert.match(stories, /Story viewer/)
  assert.doesNotMatch(stories.slice(stories.indexOf('aria-label="Story viewer"'), stories.indexOf('</section>', stories.indexOf('aria-label="Story viewer"'))), /absolute/)
})

test('auth screen scrolls instead of clipping content on short viewports', async () => {
  const auth = await read('web/src/pages/AuthPage.tsx')
  assert.match(auth, /h-\[100dvh\].*overflow-y-auto/)
})

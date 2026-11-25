/**
 * Shared PWA install bridge.
 * Captures beforeinstallprompt as early as possible so Install buttons
 * can call the native install dialog with one tap (Chrome / Edge / Android).
 *
 * iOS Safari has no install API — callers must show Add-to-Home-Screen steps.
 */

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

export function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  } catch {
    /* ignore */
  }
  return nav.standalone === true
}

export function isAppleMobile() {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent || ''
  const platform = window.navigator.platform || ''
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

export function isInAppBrowser() {
  if (typeof window === 'undefined') return false
  return /FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(window.navigator.userAgent || '')
}

export function canNativeInstall() {
  return deferred != null && !isStandaloneMode()
}

export function subscribeInstallAvailability(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Call once at app boot (main.tsx) before React mounts if possible. */
export function initPwaInstallCapture() {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })

  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export type TriggerInstallResult =
  | { ok: true; outcome: 'accepted' | 'dismissed' }
  | { ok: false; reason: 'standalone' | 'ios' | 'in_app_browser' | 'unavailable' | 'error'; message: string }

/**
 * One-tap install: opens the browser's native install UI when available.
 */
export async function triggerInstall(): Promise<TriggerInstallResult> {
  if (isStandaloneMode()) {
    return { ok: false, reason: 'standalone', message: 'App is already installed.' }
  }
  if (isInAppBrowser()) {
    return {
      ok: false,
      reason: 'in_app_browser',
      message: 'Open this page in Chrome or Safari, then tap Install.',
    }
  }
  if (isAppleMobile()) {
    return {
      ok: false,
      reason: 'ios',
      message: 'On iPhone, use Share → Add to Home Screen.',
    }
  }

  const event = deferred
  if (!event) {
    return {
      ok: false,
      reason: 'unavailable',
      message:
        'Install is not ready yet. Wait a moment, refresh the page, or use the browser menu → Install app.',
    }
  }

  // beforeinstallprompt is single-use
  deferred = null
  notify()

  try {
    await event.prompt()
    const choice = await event.userChoice
    return { ok: true, outcome: choice.outcome }
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: 'Could not open the install dialog. Try the browser menu → Install app.',
    }
  }
}

/**
 * Shared PWA install bridge.
 * Captures the browser's native install event before React mounts so the
 * single Install button can open the real app installer from a user gesture.
 */

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

let deferred: BeforeInstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A UI subscriber must not break install event handling.
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
    // Older browsers may not support matchMedia display-mode queries.
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
  return /FBAN|FBAV|Instagram|Line\/|; wv\)|WhatsApp|Snapchat|TikTok/i.test(window.navigator.userAgent || '')
}

export function canNativeInstall() {
  return deferred !== null && !isStandaloneMode()
}

export function subscribeInstallAvailability(callback: () => void) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Must be called once before React mounts so no native prompt event is missed. */
export function initPwaInstallCapture() {
  if (typeof window === 'undefined' || initialized) return
  initialized = true

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

/** Opens the browser's actual native PWA installer. */
export async function triggerInstall(): Promise<TriggerInstallResult> {
  if (isStandaloneMode()) {
    return { ok: false, reason: 'standalone', message: 'NEWGEN CHAT is already installed.' }
  }
  if (isInAppBrowser()) {
    return {
      ok: false,
      reason: 'in_app_browser',
      message: 'This browser is embedded inside another app and cannot install the PWA. Open the HTTPS website directly in Chrome or Safari.',
    }
  }
  if (isAppleMobile()) {
    return {
      ok: false,
      reason: 'ios',
      message: 'iPhone Safari does not expose a one-tap PWA install API. Use the Share menu and select Add to Home Screen.',
    }
  }

  const event = deferred
  if (!event) {
    return {
      ok: false,
      reason: 'unavailable',
      message: 'Chrome has not offered the native app installer on this visit. Open the HTTPS site directly in the latest Chrome, let the page finish loading, refresh once and tap Install again.',
    }
  }

  try {
    // Call prompt immediately in the click's user-activation context.
    const promptPromise = event.prompt()
    deferred = null // beforeinstallprompt is single-use
    notify()
    await promptPromise
    const choice = await event.userChoice
    return { ok: true, outcome: choice.outcome }
  } catch {
    deferred = null
    notify()
    return {
      ok: false,
      reason: 'error',
      message: 'Chrome could not open the native installer. Refresh the HTTPS page and try again.',
    }
  }
}

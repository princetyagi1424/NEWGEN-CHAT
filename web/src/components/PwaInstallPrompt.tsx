import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, MessageCircle, Smartphone, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

const DISMISSED_KEY = 'newgen-chat-pwa-install-dismissed-v2'

/** True only when opened as installed home-screen / PWA app. */
export function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
  } catch {
    /* older browsers */
  }
  if (nav.standalone === true) return true
  return false
}

function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberDismissed() {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, 'true')
  } catch {
    /* storage blocked */
  }
}

function isAppleMobile() {
  const ua = window.navigator.userAgent || ''
  const platform = window.navigator.platform || ''
  return /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
}

function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line\/|; wv\)/i.test(window.navigator.userAgent || '')
}

/**
 * Fixed bottom install banner for browser tabs only.
 * Hidden in installed PWA. Does not use permanent localStorage hide flags.
 */
export default function PwaInstallPrompt() {
  const [standalone, setStandalone] = useState(isStandaloneMode)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [promptAvailable, setPromptAvailable] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [status, setStatus] = useState('')
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const sync = () => setStandalone(isStandaloneMode())

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      if (isStandaloneMode()) return
      deferredPrompt.current = event as BeforeInstallPromptEvent
      setPromptAvailable(true)
    }

    const onAppInstalled = () => {
      deferredPrompt.current = null
      setPromptAvailable(false)
      setHelpOpen(false)
      setStandalone(true)
    }

    let media: MediaQueryList | null = null
    try {
      media = window.matchMedia('(display-mode: standalone)')
      media.addEventListener?.('change', sync)
    } catch {
      /* ignore */
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    sync()

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      try {
        media?.removeEventListener?.('change', sync)
      } catch {
        /* ignore */
      }
    }
  }, [])

  const handleInstall = useCallback(async () => {
    const installEvent = deferredPrompt.current
    if (!installEvent) {
      setHelpOpen(true)
      return
    }
    deferredPrompt.current = null
    setPromptAvailable(false)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice.outcome === 'accepted') {
        setStatus('Installing… Button hides when the app opens from your home screen.')
      } else {
        setStatus('You can install NEWGEN anytime from this button.')
      }
    } catch {
      setStatus('Could not open the install dialog. See the steps below.')
      setHelpOpen(true)
    }
  }, [])

  if (standalone) return null
  if (dismissed && !helpOpen) return null

  const appleDevice = isAppleMobile()
  const inAppBrowser = isInAppBrowser()

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        <aside
          className="pointer-events-auto w-full max-w-lg rounded-2xl border border-violet-200/90 bg-white p-3 shadow-[0_12px_40px_rgba(73,42,125,.22)] sm:p-4"
          aria-label="Install NEWGEN CHAT"
        >
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-md">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-slate-900">Install the app</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-600">
                Add NEWGEN CHAT to your home screen and open it like a normal app.
              </p>
              {status && (
                <p className="mt-1 text-xs font-medium text-violet-700" role="status">
                  {status}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                rememberDismissed()
                setDismissed(true)
              }}
              aria-label="Dismiss install banner"
              className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm"
            >
              <Download className="h-4 w-4" />
              {promptAvailable ? 'Install app' : appleDevice ? 'Add to Home Screen' : 'Install app'}
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded-xl px-3 py-2.5 text-xs font-bold text-violet-800 hover:bg-violet-50"
            >
              How to install
            </button>
          </div>
        </aside>
      </div>

      {helpOpen && (
        <InstallHelpDialog
          appleDevice={appleDevice}
          inAppBrowser={inAppBrowser}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  )
}

function InstallHelpDialog({
  appleDevice,
  inAppBrowser,
  onClose,
}: {
  appleDevice: boolean
  inAppBrowser: boolean
  onClose: () => void
}) {
  return (
    <div
      className="newgen-dialog-backdrop z-[110] items-end sm:items-center"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        className="newgen-dialog-panel max-w-md rounded-3xl border border-white/70 bg-white p-5 shadow-2xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-violet-50 text-violet-700">
              <Smartphone className="h-5 w-5" />
            </span>
            <h2 id="pwa-install-title" className="text-lg font-black text-slate-900">
              Install NEWGEN on this device
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {inAppBrowser
                ? 'Open this page in Chrome or Safari first.'
                : appleDevice
                  ? 'In Safari, add NEWGEN to your Home Screen.'
                  : 'Use your browser menu to install NEWGEN as an app.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {inAppBrowser ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Open the menu and choose <strong>Open in Chrome</strong> or <strong>Open in Safari</strong>, then install again.
          </div>
        ) : appleDevice ? (
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">1</span><span>Tap <strong>Share</strong> in Safari.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">2</span><span>Choose <strong>Add to Home Screen</strong>.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">3</span><span>Tap <strong>Add</strong>. Open from home screen — install button will not show there.</span></li>
          </ol>
        ) : (
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">1</span><span>Open the browser menu (⋮) or the install icon in the address bar.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">2</span><span>Choose <strong>Install app</strong> / <strong>Add to Home Screen</strong>.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">3</span><span>Confirm <strong>Install</strong>.</span></li>
          </ol>
        )}

        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-extrabold text-white">
          Got it
        </button>
      </section>
    </div>
  )
}

/** Compact button for headers / hero — browser only. */
export function InstallAppButton({
  className = '',
  label,
}: {
  className?: string
  label?: string
}) {
  const [standalone, setStandalone] = useState(isStandaloneMode)
  const [helpOpen, setHelpOpen] = useState(false)
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)
  const [promptAvailable, setPromptAvailable] = useState(false)

  useEffect(() => {
    const sync = () => setStandalone(isStandaloneMode())
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      if (isStandaloneMode()) return
      deferredPrompt.current = event as BeforeInstallPromptEvent
      setPromptAvailable(true)
    }
    const onAppInstalled = () => {
      deferredPrompt.current = null
      setPromptAvailable(false)
      setStandalone(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    window.addEventListener('focus', sync)
    sync()
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.removeEventListener('focus', sync)
    }
  }, [])

  if (standalone) return null

  const appleDevice = isAppleMobile()
  const text = label || (appleDevice ? 'Install app' : promptAvailable ? 'Install app' : 'Install app')

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const installEvent = deferredPrompt.current
          if (!installEvent) {
            setHelpOpen(true)
            return
          }
          deferredPrompt.current = null
          setPromptAvailable(false)
          try {
            await installEvent.prompt()
            await installEvent.userChoice
          } catch {
            setHelpOpen(true)
          }
        }}
        className={className}
      >
        <Download className="h-4 w-4" />
        {text}
      </button>
      {helpOpen && (
        <InstallHelpDialog
          appleDevice={appleDevice}
          inAppBrowser={isInAppBrowser()}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  )
}

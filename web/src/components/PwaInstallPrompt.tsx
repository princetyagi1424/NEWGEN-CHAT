import { useCallback, useEffect, useState } from 'react'
import { Download, MessageCircle, Smartphone, X } from 'lucide-react'
import {
  canNativeInstall,
  isAppleMobile,
  isInAppBrowser,
  isStandaloneMode,
  subscribeInstallAvailability,
  triggerInstall,
} from '../lib/pwaInstall'

const DISMISSED_KEY = 'newgen-chat-pwa-install-dismissed-v3'

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
    /* ignore */
  }
}

function InstallHelpDialog({
  appleDevice,
  inAppBrowser,
  message,
  onClose,
}: {
  appleDevice: boolean
  inAppBrowser: boolean
  message?: string
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
              Install NEWGEN
            </h2>
            {message && <p className="mt-2 text-sm font-medium text-violet-800">{message}</p>}
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {inAppBrowser
                ? 'Open this page in Chrome or Safari first.'
                : appleDevice
                  ? 'iPhone does not allow one-tap install. Use Share → Add to Home Screen.'
                  : 'If the install window did not open, use the browser menu → Install app.'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {appleDevice && !inAppBrowser && (
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">1</span><span>Tap <strong>Share</strong> in Safari.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">2</span><span>Choose <strong>Add to Home Screen</strong>.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">3</span><span>Tap <strong>Add</strong>.</span></li>
          </ol>
        )}

        {!appleDevice && !inAppBrowser && (
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">1</span><span>Tap the <strong>⋮</strong> menu in Chrome.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">2</span><span>Choose <strong>Install app</strong>.</span></li>
          </ol>
        )}

        {inAppBrowser && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Open in <strong>Chrome</strong> or <strong>Safari</strong>, then tap Install again.
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-extrabold text-white">
          Got it
        </button>
      </section>
    </div>
  )
}

async function runInstall(
  setHelp: (open: boolean) => void,
  setHelpMessage: (msg: string) => void,
  setStatus: (s: string) => void,
) {
  const result = await triggerInstall()
  if (result.ok) {
    setStatus(
      result.outcome === 'accepted'
        ? 'Installing… Open NEWGEN from your home screen when ready.'
        : 'Install cancelled. Tap Install again anytime.',
    )
    return
  }
  setHelpMessage(result.message)
  setHelp(true)
}

/** Bottom install card shown on browser (hidden in installed PWA). */
export default function PwaInstallPrompt() {
  const [standalone, setStandalone] = useState(isStandaloneMode)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [nativeReady, setNativeReady] = useState(canNativeInstall)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpMessage, setHelpMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      setStandalone(isStandaloneMode())
      setNativeReady(canNativeInstall())
    }
    const unsub = subscribeInstallAvailability(sync)
    window.addEventListener('appinstalled', sync)
    window.addEventListener('focus', sync)
    sync()
    return () => {
      unsub()
      window.removeEventListener('appinstalled', sync)
      window.removeEventListener('focus', sync)
    }
  }, [])

  const onInstallClick = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setStatus('')
    try {
      await runInstall(setHelpOpen, setHelpMessage, setStatus)
    } finally {
      setBusy(false)
      setNativeReady(canNativeInstall())
    }
  }, [busy])

  if (standalone) return null
  if (dismissed && !helpOpen) return null

  const appleDevice = isAppleMobile()

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
                {appleDevice
                  ? 'Add NEWGEN to your Home Screen.'
                  : nativeReady
                    ? 'Tap below — install starts immediately.'
                    : 'Tap Install to add NEWGEN to your device.'}
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
              aria-label="Dismiss"
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onInstallClick()}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 px-4 py-3 text-sm font-extrabold text-white shadow-sm disabled:opacity-70"
          >
            <Download className="h-4 w-4" />
            {busy ? 'Opening install…' : appleDevice ? 'Add to Home Screen' : 'Install app now'}
          </button>
        </aside>
      </div>

      {helpOpen && (
        <InstallHelpDialog
          appleDevice={appleDevice}
          inAppBrowser={isInAppBrowser()}
          message={helpMessage}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  )
}

/** Header / hero install button used on the landing page. */
export function InstallAppButton({
  className = '',
  label,
}: {
  className?: string
  label?: string
}) {
  const [standalone, setStandalone] = useState(isStandaloneMode)
  const [nativeReady, setNativeReady] = useState(canNativeInstall)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpMessage, setHelpMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      setStandalone(isStandaloneMode())
      setNativeReady(canNativeInstall())
    }
    const unsub = subscribeInstallAvailability(sync)
    window.addEventListener('appinstalled', sync)
    sync()
    return () => {
      unsub()
      window.removeEventListener('appinstalled', sync)
    }
  }, [])

  if (standalone) return null

  const appleDevice = isAppleMobile()
  const text =
    label ||
    (busy ? 'Installing…' : appleDevice ? 'Install app' : nativeReady ? 'Install app' : 'Install app')

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void (async () => {
            if (busy) return
            setBusy(true)
            try {
              const result = await triggerInstall()
              if (!result.ok) {
                setHelpMessage(result.message)
                setHelpOpen(true)
              }
            } finally {
              setBusy(false)
              setNativeReady(canNativeInstall())
            }
          })()
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
          message={helpMessage}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  )
}

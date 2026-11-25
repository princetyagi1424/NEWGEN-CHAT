import { useEffect, useState } from 'react'
import { Download, MessageCircle, Smartphone, X } from 'lucide-react'
import {
  isAppleMobile,
  isInAppBrowser,
  isStandaloneMode,
  subscribeInstallAvailability,
  triggerInstall,
} from '../lib/pwaInstall'

function InstallHelpDialog({
  appleDevice,
  inAppBrowser,
  message,
  onClose,
}: {
  appleDevice: boolean
  inAppBrowser: boolean
  message: string
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
              Install NEWGEN CHAT
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {appleDevice && !inAppBrowser && (
          <ol className="space-y-3 text-sm leading-6 text-slate-700">
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">1</span><span>Open the <strong>Share</strong> menu in Safari.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">2</span><span>Choose <strong>Add to Home Screen</strong>.</span></li>
            <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-black text-violet-800">3</span><span>Tap <strong>Add</strong>.</span></li>
          </ol>
        )}

        {inAppBrowser && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Open the website directly in <strong>Chrome</strong> (Android) or <strong>Safari</strong> (iPhone), then use the single Install button again.
          </div>
        )}

        {!appleDevice && !inAppBrowser && (
          <div className="rounded-2xl bg-violet-50 p-4 text-sm leading-6 text-violet-900">
            For a real app installation, open the HTTPS website directly in the latest <strong>Google Chrome</strong>. Chrome has not provided its native install dialog on this visit. Refresh the page after it loads completely, then tap Install again. The app will open in its own standalone window when installation is available.
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-5 w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-extrabold text-white">
          Got it
        </button>
      </section>
    </div>
  )
}

export function InstallAppButton({
  className = '',
  label = 'Install NEWGEN',
}: {
  className?: string
  label?: string
}) {
  const [standalone, setStandalone] = useState(isStandaloneMode)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpMessage, setHelpMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const sync = () => setStandalone(isStandaloneMode())
    const unsubscribe = subscribeInstallAvailability(sync)
    window.addEventListener('appinstalled', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('pageshow', sync)
    return () => {
      unsubscribe()
      window.removeEventListener('appinstalled', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('pageshow', sync)
    }
  }, [])

  if (standalone) return null

  const appleDevice = isAppleMobile()
  const inAppBrowser = isInAppBrowser()

  async function handleInstall() {
    if (busy) return
    setBusy(true)
    setStatus('')
    try {
      const result = await triggerInstall()
      if (result.ok) {
        setStatus(
          result.outcome === 'accepted'
            ? 'Installation accepted. NEWGEN CHAT will be available as an app.'
            : 'Installation was cancelled. You can tap Install again.',
        )
        return
      }
      setHelpMessage(result.message)
      setHelpOpen(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleInstall()}
        aria-label="Install NEWGEN CHAT"
        className={className}
      >
        <Download className="h-4 w-4" />
        {busy ? 'Opening installer…' : label}
      </button>
      {status && <p className="sr-only" role="status">{status}</p>}
      {helpOpen && (
        <InstallHelpDialog
          appleDevice={appleDevice}
          inAppBrowser={inAppBrowser}
          message={helpMessage}
          onClose={() => setHelpOpen(false)}
        />
      )}
    </>
  )
}

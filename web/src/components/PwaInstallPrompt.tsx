import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, MessageCircle, Smartphone, X } from 'lucide-react'

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string }
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<InstallChoice>
}

const INSTALLED_KEY = 'newgen-chat-pwa-installed-v1'

function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    navigatorWithStandalone.standalone === true
}

function readInstalledState() {
  if (isStandaloneMode()) return true
  try {
    return window.localStorage.getItem(INSTALLED_KEY) === 'true'
  } catch {
    return false
  }
}

function rememberInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_KEY, 'true')
  } catch {
    // Standalone detection still hides the banner if storage is unavailable.
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

export default function PwaInstallPrompt() {
  const [installed, setInstalled] = useState(readInstalledState)
  const [promptAvailable, setPromptAvailable] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [status, setStatus] = useState('')
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const syncInstalledState = () => {
      if (isStandaloneMode()) {
        rememberInstalled()
        setInstalled(true)
      }
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      if (readInstalledState()) return
      deferredPrompt.current = event as BeforeInstallPromptEvent
      setPromptAvailable(true)
    }

    const onAppInstalled = () => {
      rememberInstalled()
      deferredPrompt.current = null
      setPromptAvailable(false)
      setHelpOpen(false)
      setInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)
    window.addEventListener('focus', syncInstalledState)
    document.addEventListener('visibilitychange', syncInstalledState)
    syncInstalledState()

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
      window.removeEventListener('focus', syncInstalledState)
      document.removeEventListener('visibilitychange', syncInstalledState)
    }
  }, [])

  const markInstalled = useCallback(() => {
    rememberInstalled()
    setInstalled(true)
    setHelpOpen(false)
  }, [])

  const handleInstall = useCallback(async () => {
    const installEvent = deferredPrompt.current
    if (!installEvent) {
      setHelpOpen(true)
      return
    }

    // beforeinstallprompt is single-use. Keep the banner visible after a dismissal.
    deferredPrompt.current = null
    setPromptAvailable(false)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      if (choice.outcome === 'accepted') {
        setStatus('Installation started. The banner will disappear when the app is installed.')
      } else {
        setStatus('No problem — NEWGEN is ready to install whenever you are.')
      }
    } catch {
      setStatus('The browser could not open the install window. Use the steps below.')
      setHelpOpen(true)
    }
  }, [])

  if (installed) return null

  const appleDevice = isAppleMobile()
  const inAppBrowser = isInAppBrowser()

  return (
    <>
      <aside className="fixed inset-x-0 bottom-0 z-[100] px-3 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }} aria-label="Install NEWGEN CHAT">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-2xl border border-emerald-200/80 bg-white/95 p-3 shadow-[0_-8px_40px_rgba(15,75,55,.16)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-200"><MessageCircle className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900">Install NEWGEN CHAT</p>
              <p className="text-xs leading-5 text-slate-600">Add it to your device and open it like an app — no app store needed.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button type="button" onClick={() => setHelpOpen(true)} className="rounded-xl px-3 py-2.5 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50">How to install</button>
            <button type="button" onClick={() => void handleInstall()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              <Download className="h-4 w-4" />
              {promptAvailable ? 'Install app' : appleDevice ? 'Add to Home Screen' : 'Install app'}
            </button>
          </div>
          {status && <p className="text-xs text-emerald-800 sm:absolute sm:-top-7 sm:right-5" role="status">{status}</p>}
        </div>
      </aside>

      {helpOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setHelpOpen(false) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" className="w-full max-w-md rounded-3xl border border-white/70 bg-white p-5 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Smartphone className="h-5 w-5" /></span>
                <h2 id="pwa-install-title" className="text-lg font-black text-slate-900">Install NEWGEN on this device</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{inAppBrowser ? 'You are using an in-app browser. Open this page in Safari or Chrome first.' : appleDevice ? 'In Safari, add NEWGEN to your Home Screen.' : 'Use your browser menu to install NEWGEN as an app.'}</p>
              </div>
              <button type="button" onClick={() => setHelpOpen(false)} aria-label="Close install instructions" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>

            {inAppBrowser ? (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Open the browser menu and choose <strong>Open in Chrome</strong> or <strong>Open in Safari</strong>. Then tap Install app again.</div>
            ) : appleDevice ? (
              <ol className="space-y-3 text-sm leading-6 text-slate-700">
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">1</span><span>Tap the <strong>Share</strong> button in Safari.</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">2</span><span>Choose <strong>Add to Home Screen</strong>.</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">3</span><span>Keep <strong>Open as Web App</strong> enabled when shown, then tap <strong>Add</strong>.</span></li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm leading-6 text-slate-700">
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">1</span><span>Open the browser menu (⋮ on Android/Chrome, or the install icon in the address bar on desktop).</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">2</span><span>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</span></li>
                <li className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-black text-emerald-800">3</span><span>Confirm <strong>Install</strong>. NEWGEN will appear with your other apps.</span></li>
              </ol>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button type="button" onClick={markInstalled} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-emerald-700">I’ve installed it — hide this banner</button>
              <button type="button" onClick={() => setHelpOpen(false)} className="w-full rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Not now</button>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-400">On iPhone and iPad, use the confirmation button after adding NEWGEN to your Home Screen because Safari does not expose the same install event as Chromium browsers.</p>
          </section>
        </div>
      )}
    </>
  )
}

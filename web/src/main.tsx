import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NEWGEN] Uncaught UI error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#f4f7f5',
            color: '#17251f',
            textAlign: 'center',
            gap: 12,
          }}
        >
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0, color: '#829089', maxWidth: 320 }}>
            The app hit an error on this device. Try reloading. If it stays blank, clear site data for this site and open again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '12px 20px',
              borderRadius: 12,
              border: 0,
              background: '#159b72',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations()
                  await Promise.all(regs.map(reg => reg.unregister()))
                }
                if ('caches' in window) {
                  const keys = await caches.keys()
                  await Promise.all(keys.map(key => caches.delete(key)))
                }
              } catch {
                /* ignore */
              }
              window.location.href = '/'
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid #e7eeea',
              background: '#fff',
              color: '#17251f',
            }}
          >
            Clear cache & restart
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)

// Register the PWA worker after page load. Only the app shell and static
// assets are cached; authenticated APIs, messages and signed media are not.
if ('serviceWorker' in navigator) {
  const registerServiceWorker = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(registration => {
        // Force update check so mobile does not stick on a broken cached shell.
        void registration.update()
        const warmAppAssets = () => {
          const controller = navigator.serviceWorker.controller
          if (!controller) return
          const urls = Array.from(
            document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
              'script[src], link[rel="stylesheet"][href]',
            ),
          )
            .map(element =>
              element instanceof HTMLScriptElement ? element.src : element.href,
            )
            .filter(Boolean)
          controller.postMessage({ type: 'PRECACHE_URLS', urls })
        }

        warmAppAssets()
        navigator.serviceWorker.addEventListener('controllerchange', warmAppAssets, {
          once: true,
        })
      })
      .catch(error =>
        console.warn('[NEWGEN] PWA service worker registration failed:', error),
      )
  }

  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker, { once: true })
}

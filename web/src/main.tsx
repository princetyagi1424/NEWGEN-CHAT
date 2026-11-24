import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the PWA worker after page load. Only the app shell and static
// assets are cached; authenticated APIs, messages and signed media are not.
if ('serviceWorker' in navigator) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(() => {
        const warmAppAssets = () => {
          const controller = navigator.serviceWorker.controller
          if (!controller) return
          const urls = Array.from(document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
            'script[src], link[rel="stylesheet"][href]'
          )).map(element => element instanceof HTMLScriptElement ? element.src : element.href).filter(Boolean)
          controller.postMessage({ type: 'PRECACHE_URLS', urls })
        }

        warmAppAssets()
        navigator.serviceWorker.addEventListener('controllerchange', warmAppAssets, { once: true })
      })
      .catch(error => console.warn('[NEWGEN] PWA service worker registration failed:', error))
  }

  if (document.readyState === 'complete') registerServiceWorker()
  else window.addEventListener('load', registerServiceWorker, { once: true })
}

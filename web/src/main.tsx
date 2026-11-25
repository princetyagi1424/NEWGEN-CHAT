import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPwaInstallCapture } from './lib/pwaInstall'

// Capture the native installation event before registering the worker or mounting React.
initPwaInstallCapture()

// Register the PWA worker immediately instead of waiting for window.load.
// This lets Chrome evaluate installability as early as possible on the first visit.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then(registration => registration.update())
    .catch(error => console.warn('[NEWGEN] SW registration failed:', error))
}

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
            The app hit an error on this device. Try reloading.
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

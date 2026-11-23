import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { MessageCircle, Shield, Smartphone, Zap, Users, Download, Globe } from 'lucide-react'

export default function Landing() {
  const { user, configured } = useAuth()
  return (
    <div className="min-h-full bg-[var(--bg)] text-[var(--text)]">
      <header className="border-b border-[var(--border)] bg-[var(--panel)]/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold tracking-tight text-lg">
            <MessageCircle className="w-6 h-6 text-[var(--accent)]" /> NEWGEN CHAT
          </div>
          <nav className="flex items-center gap-3">
            <a href="#features" className="text-sm text-[var(--muted)] hidden sm:inline">Features</a>
            <a href="#security" className="text-sm text-[var(--muted)] hidden sm:inline">Privacy</a>
            {user ? (
              <Link to="/app" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium">Open App</Link>
            ) : (
              <Link to="/auth" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium">Sign in</Link>
            )}
          </nav>
        </div>
      </header>
      <section className="max-w-6xl mx-auto px-4 py-20 md:py-28 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--muted)] mb-6">
          <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
          Browser-first · Encrypted · Real-time
        </div>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">Private messaging<br /><span className="text-[var(--accent)]">in the browser</span></h1>
        <p className="text-lg text-[var(--muted)] max-w-2xl mx-auto mb-10">Real-time 1:1 and group chat, multi-device sync, presence, and notifications — content encrypted in your browser before upload.</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to={user ? '/app' : '/auth'} className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold shadow-lg shadow-blue-500/20">
            <Globe className="w-5 h-5" /> Launch Web App
          </Link>
          <button type="button" disabled className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] font-semibold cursor-not-allowed opacity-80">
            <Download className="w-5 h-5" /> Download — Coming Soon
          </button>
        </div>
        {!configured && (
          <p className="mt-6 text-sm text-[var(--warning)]">Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
        )}
      </section>
      <section id="features" className="border-t border-[var(--border)] bg-[var(--panel)]/40 py-20">
        <div className="max-w-6xl mx-auto px-4 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { icon: MessageCircle, title: 'One-to-one messaging', desc: 'Instant delivery with Realtime and history sync.' },
            { icon: Users, title: 'Group messaging', desc: 'Groups with membership and encrypted history.' },
            { icon: Smartphone, title: 'Multi-device sync', desc: 'Multiple browsers with device-scoped keys.' },
            { icon: Zap, title: 'Presence & notifications', desc: 'Online status, typing, browser notifications.' },
          ].map((f) => (
            <div key={f.title} className="p-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
              <f.icon className="w-8 h-8 text-[var(--accent)] mb-4" />
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-[var(--muted)]">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="security" className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <div className="inline-flex items-center gap-2 text-[var(--accent)] mb-4"><Shield className="w-5 h-5" /><span className="text-sm font-medium uppercase tracking-wider">Privacy & Security</span></div>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Client-side encryption</h2>
          <ul className="space-y-2 text-[var(--muted)] text-sm">
            <li>• AES-256-GCM in the browser before upload</li>
            <li>• Servers store ciphertext only</li>
            <li>• Per-device ECDH identities in IndexedDB</li>
            <li>• Supabase Row Level Security on all private tables</li>
          </ul>
          <p className="mt-6 text-xs text-[var(--muted)] border-l-2 border-[var(--border)] pl-4">Not Signal Protocol. No independent crypto audit yet. See project docs for limitations.</p>
        </div>
      </section>
      <footer className="border-t border-[var(--border)] py-8 text-center text-sm text-[var(--muted)]">NEWGEN CHAT · Open the web app to get started</footer>
    </div>
  )
}

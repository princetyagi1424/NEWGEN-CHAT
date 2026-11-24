import { Link } from 'react-router-dom'
import PwaInstallPrompt from '../components/PwaInstallPrompt'
import { useAuth } from '../lib/auth'
import { MessageCircle, Shield, Smartphone, Zap, Users, Download, Globe, LockKeyhole, Instagram, ArrowUpRight, Sparkles } from 'lucide-react'

export default function Landing() {
  const { user, configured } = useAuth()
  return (
    <div className="min-h-full overflow-y-auto bg-[#faf8ff] text-[#211a35]">
      <header className="sticky top-0 z-30 border-b border-violet-100/80 bg-white/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-lg shadow-fuchsia-200/70"><MessageCircle className="h-5 w-5"/></span>
            <span><span className="block text-[17px] font-black tracking-tight">NEWGEN <span className="text-violet-600">CHAT</span></span><span className="block text-[9px] font-bold uppercase tracking-[.2em] text-slate-400">Your private circle</span></span>
          </Link>
          <nav className="flex items-center gap-5">
            <a href="#features" className="hidden text-sm font-semibold text-slate-500 transition hover:text-violet-700 sm:inline">Features</a>
            <a href="#privacy" className="hidden text-sm font-semibold text-slate-500 transition hover:text-violet-700 sm:inline">Privacy</a>
            <Link to={user ? '/app' : '/auth'} className="inline-flex items-center gap-2 rounded-full bg-[#211a35] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:bg-violet-700">{user ? 'Open app' : 'Get started'}<ArrowUpRight className="h-4 w-4"/></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate overflow-hidden px-5 pb-20 pt-16 md:pb-28 md:pt-24">
          <div className="pointer-events-none absolute -left-36 top-0 -z-10 h-96 w-96 rounded-full bg-fuchsia-200/45 blur-3xl"/>
          <div className="pointer-events-none absolute -right-24 top-16 -z-10 h-[28rem] w-[28rem] rounded-full bg-violet-200/55 blur-3xl"/>
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.02fr_.98fr]">
            <div className="max-w-2xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-2 text-xs font-bold text-violet-700 shadow-sm"><Sparkles className="h-3.5 w-3.5"/> Messaging, with a little more personality</div>
              <h1 className="text-5xl font-black leading-[1.04] tracking-[-.055em] sm:text-6xl lg:text-[76px]">Your people.<br/><span className="bg-gradient-to-r from-violet-700 via-fuchsia-600 to-orange-500 bg-clip-text text-transparent">Your moments.</span><br/>Your space.</h1>
              <p className="mt-7 max-w-xl text-base leading-8 text-slate-500 md:text-lg">A fresh place to chat, connect and keep your conversations close. Enjoy a familiar mix of messaging simplicity and social energy.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link to={user ? '/app' : '/auth'} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 px-7 py-4 text-sm font-extrabold text-white shadow-xl shadow-fuchsia-200/70 transition hover:-translate-y-1"><MessageCircle className="h-5 w-5"/>Start chatting<ArrowUpRight className="h-4 w-4"/></Link>
                <a href="#features" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-100 bg-white px-7 py-4 text-sm font-bold text-slate-700 transition hover:border-violet-300 hover:bg-violet-50">Explore features</a>
              </div>
              {!configured && <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable sign-in.</p>}
              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs font-semibold text-slate-400"><span className="inline-flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-violet-500"/>Passkey-locked chats</span><span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-fuchsia-500"/>Private connections</span><span className="inline-flex items-center gap-2"><Smartphone className="h-4 w-4 text-orange-500"/>Web-first experience</span></div>
            </div>

            <div className="relative mx-auto w-full max-w-[520px]">
              <div className="absolute -inset-5 rounded-[42px] bg-gradient-to-br from-violet-300/50 via-fuchsia-200/50 to-orange-200/60 blur-2xl"/>
              <div className="relative overflow-hidden rounded-[34px] border border-white/80 bg-white p-4 shadow-[0_35px_100px_rgba(73,42,125,.2)]">
                <div className="flex items-center justify-between border-b border-slate-100 px-3 pb-4 pt-2"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-pink-500 text-white"><MessageCircle className="h-5 w-5"/></span><span><b className="block text-sm">Your conversations</b><small className="text-xs text-slate-400">A little corner of the internet</small></span></div><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-50"/></div>
                <div className="flex gap-4 overflow-hidden px-2 py-5">{['A','M','R','S','K'].map((v,i)=><div key={v} className="flex min-w-0 flex-1 flex-col items-center gap-2"><span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-amber-400 via-fuchsia-500 to-violet-600 p-[2px]"><span className="grid h-full w-full place-items-center rounded-full border-2 border-white bg-violet-50 text-sm font-black text-violet-700">{v}</span></span><small className="text-[10px] font-semibold text-slate-400">{['You','Mia','Riya','Sam','Kai'][i]}</small></div>)}</div>
                <div className="space-y-3 px-2 pb-2">
                  <div className="flex items-center gap-3 rounded-2xl bg-violet-50/70 p-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-bold text-white">M</span><span className="min-w-0 flex-1"><b className="block text-sm">Mia Johnson</b><small className="text-xs text-slate-400">That sounds like a plan ✨</small></span><span className="text-[10px] text-violet-500">now</span></div>
                  <div className="flex items-center gap-3 rounded-2xl p-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-pink-500 font-bold text-white">R</span><span className="min-w-0 flex-1"><b className="block text-sm">Riya Sharma</b><small className="text-xs text-slate-400">Sent you a message</small></span><span className="text-[10px] text-slate-300">2m</span></div>
                  <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-violet-100">See you there! 💜</div>
                  <div className="max-w-[82%] rounded-2xl rounded-bl-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">Can't wait 😄</div>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-400"><span>Message privately…</span><span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white"><ArrowUpRight className="h-4 w-4"/></span></div>
              </div>
              <div className="absolute -bottom-7 -left-7 hidden items-center gap-3 rounded-2xl border border-white bg-white px-4 py-3 shadow-xl sm:flex"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700"><Shield className="h-5 w-5"/></span><span><b className="block text-xs">Privacy comes first</b><small className="text-[10px] text-slate-400">Unlock chats when you're ready</small></span></div>
              <div className="absolute -right-5 top-12 hidden rounded-2xl border border-white bg-white p-3 text-fuchsia-600 shadow-xl sm:block"><Instagram className="h-6 w-6"/></div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-violet-100 bg-white/75 px-5 py-20 md:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto mb-12 max-w-2xl text-center"><p className="text-xs font-black uppercase tracking-[.22em] text-violet-600">Made for everyday connection</p><h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">The best of both worlds</h2><p className="mt-3 text-sm leading-6 text-slate-500">A clean chat experience with a social-inspired look and feel.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[{icon:MessageCircle,title:'Private chats',desc:'One-to-one conversations with passkey-based message unlocking.'},{icon:Users,title:'Your circle',desc:'Find people, send connection requests and start group conversations.'},{icon:Instagram,title:'Social-inspired UI',desc:'A familiar stories-inspired layout for your close connections.'},{icon:Shield,title:'Privacy controls',desc:'Messages stay locked until you unlock a conversation on your device.'}].map(item=><article key={item.title} className="group rounded-3xl border border-violet-100 bg-gradient-to-b from-white to-[#fbf9ff] p-6 transition hover:-translate-y-1 hover:border-violet-200 hover:shadow-xl hover:shadow-violet-100/60"><span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700 transition group-hover:scale-105"><item.icon className="h-6 w-6"/></span><h3 className="text-base font-extrabold">{item.title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{item.desc}</p></article>)}
            </div>
          </div>
        </section>

        <section id="privacy" className="px-5 py-20 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 rounded-[32px] bg-[#211a35] p-8 text-white md:grid-cols-[.8fr_1.2fr] md:p-12">
            <div><span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.2em] text-fuchsia-300"><Shield className="h-4 w-4"/>Privacy & security</span><h2 className="mt-4 text-3xl font-black tracking-tight">Your chats, on your terms.</h2><p className="mt-4 text-sm leading-7 text-white/60">NEWGEN currently uses a shared chat passkey to encrypt and unlock message content in the browser.</p></div>
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/5 p-5"><LockKeyhole className="h-5 w-5 text-fuchsia-300"/><b className="mt-3 block text-sm">AES-GCM message encryption</b><p className="mt-2 text-xs leading-5 text-white/55">Message content is encrypted in the browser before it is uploaded.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-5"><Shield className="h-5 w-5 text-violet-300"/><b className="mt-3 block text-sm">Passkey stays with you</b><p className="mt-2 text-xs leading-5 text-white/55">The shared chat passkey is not stored or transmitted by the app.</p></div><p className="text-xs leading-6 text-white/45 sm:col-span-2">This is not Signal Protocol and has not received an independent cryptographic audit. Avoid using it for highly sensitive communications until the security model is independently reviewed.</p></div>
          </div>
        </section>
      </main>
      <PwaInstallPrompt />
      <footer className="border-t border-violet-100 bg-white px-5 py-8 text-center text-xs font-semibold text-slate-400">NEWGEN CHAT · A private space to connect</footer>
    </div>
  )
}

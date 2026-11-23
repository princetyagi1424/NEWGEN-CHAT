import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, Lock, LockKeyhole, LogOut, MessageCircle, Search, Send, Users,
  ShieldCheck, Plus, Image as ImageIcon, MoreHorizontal, Circle, Sparkles
} from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { encryptWithPasskey, decryptWithPasskeyToString } from '../crypto/passkey'
import type { Conversation, Message, Profile } from '../types/database'

type ConvWithMeta = Conversation & {
  members?: { user_id: string; role: string }[]
  otherProfile?: Profile | null
  lastMessage?: Message | null
}
type VisibleMessage = Message & { plaintext?: string; locked?: boolean; decryptError?: boolean }
type ConnectionRequest = { id: string; other_user_id: string; other_username: string; direction: 'incoming' | 'outgoing'; status: string }

export default function ChatApp() {
  const { user, profile, signOut } = useAuth()
  const [conversations, setConversations] = useState<ConvWithMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<VisibleMessage[]>([])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [requests, setRequests] = useState<ConnectionRequest[]>([])
  const [sending, setSending] = useState(false)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [passkey, setPasskey] = useState<string | null>(null)
  const [passkeyEntry, setPasskeyEntry] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [showPasskeyDialog, setShowPasskeyDialog] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [activeTab, setActiveTab] = useState<'chats' | 'stories' | 'requests'>('chats')
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeConv = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId])
  const isUnlocked = Boolean(passkey && activeId)

  const apiRequest = useCallback(async (path: string, options: RequestInit = {}) => {
    const token = getAuthToken()
    if (!token) throw new Error('Please sign in again')
    const response = await fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      cache: 'no-store',
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'Request failed')
    return result
  }, [])

  const lockChat = useCallback(() => {
    setPasskey(null)
    setPasskeyEntry('')
    setPasskeyError('')
    setMessages(previous => previous.map(m => ({ ...m, plaintext: undefined, locked: true })))
  }, [])

  const loadRequests = useCallback(async () => {
    if (!user) return
    try {
      const result = await apiRequest('/api/friends/requests')
      setRequests(result.requests ?? [])
    } catch (error) { console.error('Load connection requests failed:', error) }
  }, [user, apiRequest])

  const loadConversations = useCallback(async () => {
    if (!user) return
    try {
      const result = await apiRequest('/api/conversations')
      setConversations(result.conversations ?? [])
    } catch (error) {
      console.error('Load conversations failed:', error)
    }
  }, [user, apiRequest])

  useEffect(() => { void loadConversations(); void loadRequests() }, [loadConversations, loadRequests])

  useEffect(() => {
    if (!user) return
    const channel = supabase.channel('online-users', { config: { presence: { key: user.id } } })
    channel.on('presence', { event: 'sync' }, () => setOnlineIds(new Set(Object.keys(channel.presenceState()))))
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') await channel.track({ user_id: user.id, username: profile?.username, online_at: new Date().toISOString() })
      })
    return () => { void supabase.removeChannel(channel) }
  }, [user, profile?.username])

  useEffect(() => {
    if (!activeId || !user) { setMessages([]); return }
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`)
        const rows: VisibleMessage[] = []
        for (const message of result.messages ?? []) {
          if (!passkey) {
            rows.push({ ...message, plaintext: undefined, locked: true })
          } else {
            try {
              rows.push({ ...message, plaintext: await decryptWithPasskeyToString(passkey, message.ciphertext, message.iv), locked: false })
            } catch {
              rows.push({ ...message, plaintext: undefined, locked: true, decryptError: true })
            }
          }
        }
        if (!cancelled) setMessages(rows)
      } catch (error) {
        if (!cancelled) console.error('Load messages failed:', error)
      }
    }
    void refresh()
    const poll = window.setInterval(() => { void refresh() }, 2500)
    return () => { cancelled = true; window.clearInterval(poll) }
  }, [activeId, passkey, user, apiRequest])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    const lock = () => lockChat()
    const onVisibility = () => { if (document.visibilityState !== 'visible') lock() }
    window.addEventListener('pagehide', lock)
    window.addEventListener('blur', lock)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', lock)
      window.removeEventListener('blur', lock)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [lockChat])

  useEffect(() => {
    const query = search.trim().toLowerCase()
    if (!query || query.length < 2) { setSearchResults([]); return }
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const token = getAuthToken()
        if (!token) throw new Error('Please sign in again')
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Could not search users')
        if (!cancelled) setSearchResults((result.users ?? []).map((p: { id: string; username: string }) => ({
          id: p.id, username: p.username, display_name: p.username, avatar_url: null, bio: null,
          created_at: '', updated_at: '', last_seen_at: null,
        })) as Profile[])
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('User search failed:', error)
          setSearchResults([])
        }
      }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer); controller.abort() }
  }, [search, user?.id])

  async function sendConnectionRequest(other: Profile) {
    const chosenPasskey = window.prompt('Create a strong chat passkey (12+ characters). Remember it and share it with this person only through a separate secure channel. NEWGEN will not store or send it.')
    if (!chosenPasskey) return
    if (chosenPasskey.length < 12) { alert('Passkey must contain at least 12 characters.'); return }
    try {
      await apiRequest('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username: other.username }) })
      alert('Connection request sent. Keep your passkey safe and share it out-of-band. After they accept, both of you must enter the exact same passkey to read the chat.')
      setSearch('')
      setSearchResults([])
      await loadRequests()
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not send request') }
  }

  async function respondToRequest(request: ConnectionRequest, action: 'accept' | 'decline' | 'cancel') {
    try {
      await apiRequest('/api/friends/requests', { method: 'PATCH', body: JSON.stringify({ request_id: request.id, action }) })
      await loadRequests()
      if (action === 'accept') {
        const other: Profile = { id: request.other_user_id, username: request.other_username, display_name: request.other_username, avatar_url: null, bio: null, created_at: '', updated_at: '', last_seen_at: null }
        await startDirectChat(other)
      }
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not update request') }
  }

  async function startDirectChat(other: Profile) {
    if (!user || creatingChat) return
    setCreatingChat(true)
    try {
      const result = await apiRequest('/api/conversations/direct', {
        method: 'POST', body: JSON.stringify({ other_user_id: other.id }),
      })
      const conv = result.conversation as Conversation
      const next: ConvWithMeta = {
        ...conv,
        members: [{ user_id: user.id, role: 'owner' }, { user_id: other.id, role: 'member' }],
        otherProfile: other,
        lastMessage: null,
      }
      setConversations(previous => [next, ...previous.filter(item => item.id !== conv.id)])
      setActiveId(conv.id)
      setPasskey(null)
      setShowPasskeyDialog(true)
      setSearch('')
      setSearchResults([])
      setActiveTab('chats')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not start chat')
    } finally {
      setCreatingChat(false)
    }
  }

  async function createGroup() {
    if (!user) return
    const name = window.prompt('Group name')
    if (!name?.trim()) return
    try {
      const result = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setConversations(previous => [result.conversation, ...previous])
      setActiveId(result.conversation.id)
      setPasskey(null)
      setShowPasskeyDialog(true)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not create group')
    }
  }

  async function unlockChat() {
    if (!activeId || passkeyEntry.length < 12) {
      setPasskeyError('Enter the chat passkey (at least 12 characters).')
      return
    }
    try {
      const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`)
      const rows = result.messages ?? []
      // Verify the passkey against an existing message before showing the timeline.
      if (rows.length) await decryptWithPasskeyToString(passkeyEntry, rows[0].ciphertext, rows[0].iv)
      setPasskey(passkeyEntry)
      setPasskeyEntry('')
      setPasskeyError('')
      setShowPasskeyDialog(false)
    } catch {
      setPasskeyError('Passkey incorrect, or this conversation contains legacy messages. Check the shared passkey.')
    }
  }

  async function sendMessage() {
    if (!input.trim() || !activeId || !user || !passkey || sending) return
    setSending(true)
    try {
      const encrypted = await encryptWithPasskey(passkey, input.trim())
      await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`, {
        method: 'POST', body: JSON.stringify(encrypted),
      })
      setInput('')
      const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`)
      const visible: VisibleMessage[] = []
      for (const m of result.messages ?? []) {
        try { visible.push({ ...m, plaintext: await decryptWithPasskeyToString(passkey, m.ciphertext, m.iv), locked: false }) }
        catch { visible.push({ ...m, locked: true, decryptError: true }) }
      }
      setMessages(visible)
      await loadConversations()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Message could not be sent')
    } finally {
      setSending(false)
    }
  }

  const displayName = (c: ConvWithMeta) => c.type === 'group'
    ? (c.name || 'Group')
    : (c.otherProfile?.display_name || c.otherProfile?.username || 'Direct chat')

  function openConversation(id: string) {
    lockChat()
    setActiveId(id)
    setPasskeyEntry('')
    setPasskeyError('')
    setShowPasskeyDialog(true)
  }

  function leaveConversation() {
    lockChat()
    setActiveId(null)
    setShowPasskeyDialog(false)
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#f6f7fb] text-slate-900 md:p-3">
      <div className="mx-auto flex h-full max-w-[1600px] overflow-hidden bg-white md:rounded-[28px] md:border md:border-slate-200 md:shadow-[0_24px_80px_rgba(15,23,42,.10)]">
        <aside className={`${activeId ? 'hidden md:flex' : 'flex'} w-full md:w-[390px] shrink-0 flex-col border-r border-slate-100 bg-white`}>
          <div className="flex items-center justify-between px-5 pb-4 pt-5">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-500 to-orange-400 text-white shadow-lg shadow-fuchsia-200"><MessageCircle className="h-5 w-5"/></div>
              <div><div className="text-[21px] font-black tracking-tight">NEWGEN</div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-slate-400">Connect privately</div></div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void createGroup()} title="Create group" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-violet-600"><Users className="h-5 w-5"/></button>
              <button type="button" onClick={() => void signOut()} title="Sign out" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-rose-500"><LogOut className="h-5 w-5"/></button>
            </div>
          </div>

          <div className="px-4 pb-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
              <input className="w-full rounded-2xl border border-slate-100 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-50" placeholder="Search people or chats" value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            {search.trim().length >= 2 && (
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
                {searchResults.length ? searchResults.map(p => (
                  <button key={p.id} type="button" onClick={() => void sendConnectionRequest(p)} disabled={creatingChat} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-violet-50 disabled:opacity-50">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 text-sm font-bold text-white">{p.username.slice(0,1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">@{p.username}</span><span className="text-xs text-slate-400">Send connection request</span></span><Plus className="h-4 w-4 text-violet-600"/>
                  </button>
                )) : <p className="p-4 text-xs text-slate-400">No matching users found.</p>}
              </div>
            )}
          </div>

          <div className="px-5 pb-3">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-extrabold uppercase tracking-[.18em] text-slate-400">Your space</h2><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold text-violet-600">PRIVATE BY DESIGN</span></div>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100/80 p-1">
              {(['chats','stories','requests'] as const).map(tab => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-xl py-2.5 text-xs font-bold capitalize transition ${activeTab===tab?'bg-white text-violet-700 shadow-sm':'text-slate-500 hover:text-slate-800'}`}>{tab}{tab==='requests' && requests.filter(r=>r.direction==='incoming').length>0 ? <span className="ml-1 rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[9px] text-fuchsia-700">{requests.filter(r=>r.direction==='incoming').length}</span> : null}</button>
              ))}
            </div>
          </div>

          {activeTab === 'chats' ? (
            <>
              <div className="px-5 pb-3 pt-1">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-extrabold text-slate-800">Recent conversations</h3><span className="text-[11px] font-medium text-slate-400">{conversations.length} chats</span></div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  <div className="flex w-[62px] shrink-0 flex-col items-center gap-1.5">
                    <div className="relative grid h-[54px] w-[54px] place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 p-[2px]"><div className="grid h-full w-full place-items-center rounded-full border-2 border-white bg-white text-xl font-bold text-violet-600">{(profile?.username?.[0] || 'Y').toUpperCase()}</div><span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-violet-600 text-white"><Plus className="h-3 w-3"/></span></div>
                    <span className="w-full truncate text-center text-[10px] font-semibold text-slate-500">Your story</span>
                  </div>
                  {conversations.filter(c=>c.type==='direct' && c.otherProfile).slice(0,8).map(c => (
                    <button key={c.id} type="button" onClick={() => openConversation(c.id)} className="flex w-[62px] shrink-0 flex-col items-center gap-1.5">
                      <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-gradient-to-tr from-amber-400 via-fuchsia-500 to-violet-600 p-[2px]"><span className="grid h-full w-full place-items-center rounded-full border-2 border-white bg-slate-100 text-sm font-extrabold text-slate-600">{(c.otherProfile?.username?.[0] || '?').toUpperCase()}</span></span>
                      <span className="w-full truncate text-center text-[10px] font-semibold text-slate-500">{c.otherProfile?.username}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mx-5 border-t border-slate-100"/>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {conversations.length===0 && <div className="px-7 py-12 text-center"><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-violet-50 text-violet-500"><MessageCircle className="h-7 w-7"/></div><p className="text-sm font-bold text-slate-700">Your conversations start here</p><p className="mt-1 text-xs leading-5 text-slate-400">Search a username above to connect and start a private chat.</p></div>}
                {conversations.map(c => {
                  const name=displayName(c)
                  const online=c.otherProfile ? onlineIds.has(c.otherProfile.id) : false
                  return <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${activeId===c.id?'bg-violet-50':'hover:bg-slate-50'}`}>
                    <span className="relative grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-base font-black text-white">{name.slice(0,1).toUpperCase()}<span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-white text-emerald-500"><Lock className="h-3 w-3"/></span>{online && <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400"/>}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-800">{name}</span><span className="shrink-0 text-[10px] text-slate-400">{c.lastMessage ? formatDistanceToNow(new Date(c.lastMessage.created_at),{addSuffix:false}) : ''}</span></span><span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><Lock className="h-3 w-3"/><span className="truncate">Private message · locked</span></span></span>
                    <span className="h-2 w-2 rounded-full bg-violet-400 opacity-0 transition group-hover:opacity-100"/>
                  </button>
                })}
              </div>
            </>
          ) : activeTab === 'stories' ? (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[.18em] text-violet-500">Moments</p><h2 className="mt-1 text-2xl font-black tracking-tight">Stories</h2><p className="mt-1 text-sm text-slate-400">A little glimpse, shared with your circle.</p></div>
              <div className="rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-orange-400 p-[1px] shadow-lg shadow-fuchsia-100"><div className="rounded-[23px] bg-white p-5"><div className="flex items-center gap-3"><div className="grid h-14 w-14 place-items-center rounded-full bg-violet-50 text-xl font-black text-violet-600">{(profile?.username?.[0]||'Y').toUpperCase()}</div><div className="min-w-0 flex-1"><p className="text-sm font-extrabold">Your story</p><p className="text-xs text-slate-400">Share a moment with friends</p></div><Sparkles className="h-5 w-5 text-fuchsia-500"/></div><div className="mt-5 rounded-2xl bg-slate-50 px-4 py-5 text-center"><LockKeyhole className="mx-auto h-6 w-6 text-violet-500"/><p className="mt-2 text-sm font-bold text-slate-700">Private stories are coming next</p><p className="mt-1 text-xs leading-5 text-slate-400">This screen is ready for encrypted photo, video and text stories. No unencrypted story previews are shown.</p></div></div></div>
              <p className="mt-5 text-[11px] leading-5 text-slate-400">Only people you connect with will belong in your private circle. Story publishing is not enabled on web yet.</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-violet-500">Your circle</p><h2 className="mt-1 text-xl font-black">Connection requests</h2></div>
              {requests.length===0 && <div className="rounded-3xl bg-slate-50 p-8 text-center"><Users className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">All caught up</p><p className="mt-1 text-xs text-slate-400">New requests will appear here.</p></div>}
              <div className="space-y-3">{requests.map(request=><div key={request.id} className="rounded-2xl border border-slate-100 p-4 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 font-bold text-white">{request.other_username.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">@{request.other_username}</p><p className="text-xs text-slate-400">{request.direction==='incoming'?'Wants to connect with you':'Waiting for acceptance'}</p></div></div><div className="mt-3 flex gap-2">{request.direction==='incoming'?<><button type="button" onClick={()=>void respondToRequest(request,'accept')} className="flex-1 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-violet-700">Accept & chat</button><button type="button" onClick={()=>void respondToRequest(request,'decline')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600">Decline</button></>:<button type="button" onClick={()=>void respondToRequest(request,'cancel')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600">Cancel request</button>}</div></div>)}</div>
            </div>
          )}
          <div className="border-t border-slate-100 p-4"><div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-black text-white">{(profile?.username?.[0]||'U').toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">@{profile?.username??'…'}</span><span className="text-[10px] font-medium text-emerald-600">Your account is protected</span></span><ShieldCheck className="h-5 w-5 text-emerald-500"/></div></div>
        </aside>

        <main className={`${activeId?'flex':'hidden md:flex'} relative min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfe]`}>
          {!activeConv ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-md text-center"><div className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-[32px] bg-gradient-to-br from-violet-100 to-pink-100 text-violet-600"><MessageCircle className="h-10 w-10"/></div><p className="text-xs font-extrabold uppercase tracking-[.24em] text-violet-500">Welcome to your private space</p><h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Good conversations.<br/>Better boundaries.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">Choose a chat to continue, or find someone new and build your circle. Your messages stay locked until you unlock them.</p><div className="mt-6 inline-flex items-center gap-2 rounded-full border border-violet-100 bg-white px-4 py-2 text-xs font-semibold text-violet-600 shadow-sm"><ShieldCheck className="h-4 w-4"/> Privacy-first by design</div></div>
            </div>
          ) : (
            <>
              <header className="z-10 flex min-h-[78px] shrink-0 items-center gap-3 border-b border-slate-100 bg-white/90 px-4 backdrop-blur-xl md:px-7">
                <button type="button" onClick={leaveConversation} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back"><ArrowLeft className="h-5 w-5"/></button>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-lg font-black text-white">{displayName(activeConv).slice(0,1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-slate-900">{displayName(activeConv)}</span><span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'bg-emerald-400':'bg-slate-300'}`}/>{isUnlocked?'Unlocked on this device':activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'Online':'Private conversation · locked'}</span></span>
                <div className="flex items-center gap-1"><button type="button" title="Audio call (not available yet)" className="hidden rounded-xl p-2.5 text-slate-400 sm:block"><Circle className="h-4 w-4"/></button><button type="button" onClick={()=>isUnlocked?lockChat():setShowPasskeyDialog(true)} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-extrabold transition ${isUnlocked?'bg-emerald-50 text-emerald-700':'bg-violet-50 text-violet-700 hover:bg-violet-100'}`}>{isUnlocked?<ShieldCheck className="h-4 w-4"/>:<Lock className="h-4 w-4"/>}{isUnlocked?'Unlocked':'Unlock chat'}</button><button type="button" title="More options" className="rounded-xl p-2.5 text-slate-400 hover:bg-slate-100"><MoreHorizontal className="h-5 w-5"/></button></div>
              </header>
              {!isUnlocked ? (
                <div className="flex flex-1 items-center justify-center overflow-y-auto p-5">
                  <div className="w-full max-w-[390px] rounded-[30px] border border-slate-100 bg-white p-7 text-center shadow-[0_20px_70px_rgba(76,29,149,.08)]"><div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-600"><LockKeyhole className="h-8 w-8"/></div><p className="text-[10px] font-extrabold uppercase tracking-[.22em] text-violet-500">A private room</p><h2 className="mt-2 text-2xl font-black tracking-tight">Unlock this chat</h2><p className="mt-2 text-sm leading-6 text-slate-400">Enter the shared passkey to decrypt messages locally on this device.</p><form onSubmit={e=>{e.preventDefault();void unlockChat()}} className="mt-6 space-y-3"><input type="password" autoComplete="off" value={passkeyEntry} onChange={e=>setPasskeyEntry(e.target.value)} placeholder="Enter chat passkey" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none transition focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-50"/>{passkeyError&&<p role="alert" className="text-left text-xs text-rose-600">{passkeyError}</p>}<button type="submit" className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 transition hover:brightness-105">Unlock messages</button></form><p className="mt-5 flex items-center justify-center gap-1.5 text-[10px] leading-4 text-slate-400"><ShieldCheck className="h-3.5 w-3.5 shrink-0"/>Your passkey is never sent to NEWGEN servers.</p></div>
                </div>
              ) : (
                <>
                  <div className="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-6 md:px-8" style={{backgroundImage:'radial-gradient(#e9e7f2 0.7px, transparent 0.7px)',backgroundSize:'20px 20px'}}>
                    <div className="mx-auto mb-2 flex items-center gap-2 rounded-full border border-slate-100 bg-white/90 px-4 py-2 text-[10px] font-semibold text-slate-400 shadow-sm"><Lock className="h-3 w-3 text-violet-500"/> Messages decrypt only on this device</div>
                    {messages.map(m=>{const mine=m.sender_id===user?.id;return <div key={m.id} className={`message-enter flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm md:max-w-[68%] ${mine?'rounded-br-md bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white':'rounded-bl-md border border-slate-100 bg-white text-slate-800'}`}><div className="flex items-start gap-2 text-sm leading-6">{m.locked?<Lock className="mt-1 h-3.5 w-3.5 shrink-0"/>:null}<span className="whitespace-pre-wrap break-words">{m.plaintext??'••••••••'}</span></div><div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${mine?'text-white/65':'text-slate-400'}`}>{formatDistanceToNow(new Date(m.created_at),{addSuffix:true})}{mine&&<ShieldCheck className="h-3 w-3"/>}</div></div></div>})}
                    <div ref={bottomRef}/>
                  </div>
                  <div className="shrink-0 border-t border-slate-100 bg-white/95 px-3 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:px-7 md:py-4">
                    <form className="mx-auto flex max-w-5xl items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-2 focus-within:border-violet-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-violet-50" onSubmit={e=>{e.preventDefault();void sendMessage()}}>
                      <button type="button" className="rounded-xl p-2.5 text-slate-400" title="Attachments are not enabled on web yet"><ImageIcon className="h-5 w-5"/></button>
                      <input className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-400" placeholder="Write a private message…" value={input} onChange={e=>setInput(e.target.value)} disabled={sending}/>
                      <button type="submit" disabled={sending||!input.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-200 transition hover:scale-[1.03] disabled:opacity-40"><Send className="h-4 w-4"/></button>
                    </form>
                    <p className="mt-2 text-center text-[9px] font-medium tracking-wide text-slate-300">PRIVATE BY DESIGN · UNLOCKED ONLY ON YOUR DEVICE</p>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

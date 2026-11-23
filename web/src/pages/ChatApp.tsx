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
  const [activeTab, setActiveTab] = useState<'chats' | 'stories' | 'discover'>('chats')
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
    try {
      await apiRequest('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username: other.username }) })
      alert('Connection request sent. Chat unlock will be available after they accept.')
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
    const newPasskey = window.prompt('Create a chat passkey (minimum 12 characters). Share it with the other person through a separate secure channel. It will never be sent to NEWGEN servers.')
    if (!newPasskey) return
    if (newPasskey.length < 12) { alert('Passkey must contain at least 12 characters.'); return }
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
      setPasskey(newPasskey)
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
    <div className="h-[100dvh] w-full flex overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <aside className={`${activeId ? 'hidden md:flex' : 'flex'} w-full md:w-[360px] md:max-w-[38vw] shrink-0 border-r border-[var(--border)] flex-col bg-[var(--panel)] min-h-0`}>
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xl font-black tracking-tight"><span className="w-9 h-9 rounded-2xl bg-[var(--accent)] text-white grid place-items-center"><MessageCircle className="w-5 h-5"/></span> NEWGEN</div>
            <p className="text-xs text-[var(--muted)] mt-1 ml-11">Private conversations, your control</p>
          </div>
          <button type="button" onClick={() => void signOut()} className="p-2.5 rounded-xl hover:bg-[var(--panel-2)] text-[var(--muted)]" title="Sign out"><LogOut className="w-4 h-4"/></button>
        </div>
        <div className="px-4 pb-3">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[var(--panel-2)]">
            {(['chats','stories','requests'] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`py-2 rounded-xl text-xs font-semibold capitalize transition ${activeTab===tab?'bg-[var(--panel)] shadow-sm text-[var(--text)]':'text-[var(--muted)]'}`}>{tab}</button>
            ))}
          </div>
        </div>
        {activeTab === 'chats' ? (
          <>
            <div className="px-4 pb-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"/>
                <input className="w-full pl-10 pr-3 py-3 rounded-2xl bg-[var(--panel-2)] border border-transparent focus:border-[var(--accent)] outline-none text-sm" placeholder="Search people by username" value={search} onChange={e => setSearch(e.target.value)}/>
              </div>
              {search.trim().length >= 2 && (
                <div className="mt-2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] overflow-hidden shadow-lg">
                  {searchResults.length ? searchResults.map(p => (
                    <button key={p.id} type="button" onClick={() => void sendConnectionRequest(p)} disabled={creatingChat} className="w-full text-left px-4 py-3 hover:bg-[var(--panel-2)] flex items-center gap-3 disabled:opacity-50">
                      <span className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white grid place-items-center"><Users className="w-4 h-4"/></span>
                      <span className="flex-1 min-w-0"><span className="block text-sm font-semibold">@{p.username}</span><span className="text-xs text-[var(--muted)]">Send connection request</span></span>
                      <Plus className="w-4 h-4"/>
                    </button>
                  )) : <p className="p-4 text-xs text-[var(--muted)]">No matching users found.</p>}
                </div>
              )}
            </div>
            <div className="px-5 pb-2 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[.18em] font-bold text-[var(--muted)]">Messages</span>
              <button type="button" onClick={() => void createGroup()} className="flex items-center gap-1 text-xs text-[var(--accent)] font-semibold"><Users className="w-4 h-4"/> New group</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversations.length === 0 && <div className="p-8 text-center text-sm text-[var(--muted)]"><MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-40"/>Search a username to start your first private chat.</div>}
              {conversations.map(c => (
                <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`w-full text-left px-4 py-3.5 flex items-center gap-3 border-b border-[var(--border)]/60 hover:bg-[var(--panel-2)] ${activeId===c.id?'bg-[var(--panel-2)]':''}`}>
                  <span className="relative w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white grid place-items-center shrink-0"><Users className="w-5 h-5"/><span className="absolute -bottom-0.5 -right-0.5 bg-[var(--panel)] rounded-full p-0.5"><Lock className="w-3 h-3 text-[var(--success)]"/></span></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2"><span className="font-semibold text-sm truncate">{displayName(c)}</span><span className="text-[10px] text-[var(--muted)]">{c.lastMessage ? formatDistanceToNow(new Date(c.lastMessage.created_at), { addSuffix: false }) : ''}</span></span>
                    <span className="block text-xs text-[var(--muted)] mt-1 truncate">****** · Encrypted message</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : activeTab === 'stories' ? (
          <div className="flex-1 p-6">
            <div className="flex items-center gap-2 font-bold mb-2"><Sparkles className="w-5 h-5 text-[var(--accent)]"/> Stories</div>
            <p className="text-sm text-[var(--muted)]">Encrypted photo, video and GIF stories are in the next implementation phase. This screen will not display unencrypted previews.</p>
          </div>
        ) : activeTab === 'requests' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <h2 className="font-bold">Connection requests</h2>
            {requests.length === 0 && <p className="text-sm text-[var(--muted)] py-6 text-center">No connection requests yet.</p>}
            {requests.map(request => (
              <div key={request.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3">
                <div className="font-semibold text-sm">@{request.other_username}</div>
                <div className="text-xs text-[var(--muted)] mt-1">{request.direction === 'incoming' ? 'Wants to connect with you' : 'Request sent · Waiting for acceptance'}</div>
                <div className="flex gap-2 mt-3">
                  {request.direction === 'incoming' ? <>
                    <button type="button" onClick={() => void respondToRequest(request, 'accept')} className="px-3 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold">Accept & start chat</button>
                    <button type="button" onClick={() => void respondToRequest(request, 'decline')} className="px-3 py-2 rounded-xl bg-[var(--panel)] border border-[var(--border)] text-xs">Decline</button>
                  </> : <button type="button" onClick={() => void respondToRequest(request, 'cancel')} className="px-3 py-2 rounded-xl bg-[var(--panel)] border border-[var(--border)] text-xs">Cancel request</button>}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="p-4 border-t border-[var(--border)] flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-[var(--panel-2)] grid place-items-center font-bold text-sm">{(profile?.username?.[0] || 'U').toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold truncate">@{profile?.username ?? '…'}</span><span className="text-[10px] text-[var(--muted)]">Account secured</span></span>
          <ShieldCheck className="w-4 h-4 text-[var(--success)]"/>
        </div>
      </aside>

      <main className={`${activeId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 min-h-0 overflow-hidden relative`}>
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="max-w-sm text-center">
              <div className="w-20 h-20 rounded-[28px] bg-[var(--panel)] border border-[var(--border)] grid place-items-center mx-auto mb-5 shadow-sm"><LockKeyhole className="w-9 h-9 text-[var(--accent)]"/></div>
              <h2 className="text-2xl font-bold mb-2">Your privacy, your key.</h2>
              <p className="text-sm text-[var(--muted)]">Choose a conversation to unlock it locally. Your passkey is never sent to NEWGEN servers.</p>
            </div>
          </div>
        ) : (
          <>
            <header className="h-[76px] shrink-0 border-b border-[var(--border)] px-4 md:px-6 flex items-center gap-3 bg-[var(--panel)]">
              <button type="button" onClick={leaveConversation} className="md:hidden p-2 rounded-xl hover:bg-[var(--panel-2)]" aria-label="Back"><ArrowLeft className="w-5 h-5"/></button>
              <span className="w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white grid place-items-center"><Users className="w-5 h-5"/></span>
              <span className="min-w-0 flex-1"><span className="block font-bold truncate">{displayName(activeConv)}</span><span className="text-xs text-[var(--muted)]">{isUnlocked ? 'Locally unlocked' : 'Locked · Messages hidden'}</span></span>
              <button type="button" onClick={() => isUnlocked ? lockChat() : setShowPasskeyDialog(true)} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold ${isUnlocked?'bg-[var(--success)]/10 text-[var(--success)]':'bg-[var(--panel-2)] text-[var(--text)]'}`}>
                {isUnlocked ? <ShieldCheck className="w-4 h-4"/> : <Lock className="w-4 h-4"/>}{isUnlocked?'Unlocked':'Unlock chat'}
              </button>
              <button type="button" className="p-2 rounded-xl hover:bg-[var(--panel-2)] text-[var(--muted)]" aria-label="More options"><MoreHorizontal className="w-5 h-5"/></button>
            </header>
            {!isUnlocked ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--panel)] p-7 text-center shadow-xl">
                  <div className="w-16 h-16 rounded-2xl bg-[var(--panel-2)] grid place-items-center mx-auto mb-4"><LockKeyhole className="w-8 h-8 text-[var(--accent)]"/></div>
                  <h2 className="text-xl font-bold">This chat is locked</h2>
                  <p className="text-sm text-[var(--muted)] mt-2 mb-5">Enter the shared chat passkey to decrypt messages on this device.</p>
                  <form onSubmit={e => { e.preventDefault(); void unlockChat() }} className="space-y-3">
                    <input type="password" autoComplete="off" value={passkeyEntry} onChange={e => setPasskeyEntry(e.target.value)} placeholder="Enter chat passkey" className="w-full px-4 py-3 rounded-xl bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)] text-sm"/>
                    {passkeyError && <p role="alert" className="text-xs text-[var(--danger)]">{passkeyError}</p>}
                    <button type="submit" className="w-full py-3 rounded-xl bg-[var(--accent)] text-white font-bold text-sm">Unlock messages</button>
                  </form>
                  <p className="text-[11px] text-[var(--muted)] mt-4">Passkeys are exchanged separately. Never paste them into chat or send them to this website.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 space-y-3" style={{ backgroundImage: 'radial-gradient(var(--border) 0.7px, transparent 0.7px)', backgroundSize: '18px 18px' }}>
                  <div className="mx-auto w-fit px-3 py-1.5 rounded-full bg-[var(--panel)]/90 border border-[var(--border)] text-[10px] text-[var(--muted)] flex items-center gap-1.5"><Lock className="w-3 h-3"/> Messages decrypt only on this device</div>
                  {messages.map(m => {
                    const mine = m.sender_id === user?.id
                    return (
                      <div key={m.id} className={`message-enter flex ${mine?'justify-end':'justify-start'}`}>
                        <div className={`max-w-[82%] md:max-w-[70%] px-4 py-3 rounded-2xl text-sm shadow-sm ${mine?'bg-[var(--accent)] text-white rounded-br-md':'bg-[var(--panel)] border border-[var(--border)] rounded-bl-md'}`}>
                          <div className="flex items-center gap-2">{m.locked ? <Lock className="w-3 h-3"/> : null}<span>{m.plaintext ?? '******'}</span></div>
                          <div className={`text-[10px] mt-1.5 ${mine?'text-white/70':'text-[var(--muted)]'}`}>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</div>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef}/>
                </div>
                <div className="shrink-0 p-3 md:p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[var(--border)] bg-[var(--panel)]">
                  <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); void sendMessage() }}>
                    <button type="button" className="p-3 rounded-xl text-[var(--muted)] hover:bg-[var(--panel-2)]" title="Attachments are not yet enabled on web"><ImageIcon className="w-5 h-5"/></button>
                    <input className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-[var(--panel-2)] border border-transparent focus:border-[var(--accent)] outline-none text-sm" placeholder="Write an encrypted message…" value={input} onChange={e => setInput(e.target.value)} disabled={sending}/>
                    <button type="submit" disabled={sending || !input.trim()} className="p-3 rounded-2xl bg-[var(--accent)] disabled:opacity-50 text-white"><Send className="w-5 h-5"/></button>
                  </form>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

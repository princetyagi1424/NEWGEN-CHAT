import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, Lock, LockKeyhole, LogOut, MessageCircle, Search, Send, Users,
  ShieldCheck, Plus
} from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { encryptWithConversationKey, decryptWithConversationKey } from '../crypto/passkey'
import type { Conversation, Message, Profile } from '../types/database'
import StoriesHub from '../components/StoriesHub'
import ProfileEditor from '../components/ProfileEditor'

type ConvWithMeta = Conversation & {
  members?: { user_id: string; role: string }[]
  otherProfile?: Profile | null
  lastMessage?: Message | null
}
type VisibleMessage = Message & { plaintext?: string; locked?: boolean; decryptError?: boolean }
type ConnectionRequest = { id: string; other_user_id: string; other_username: string; direction: 'incoming' | 'outgoing'; status: string }

export default function ChatApp() {
  const { user, profile, signOut, signOutAll, realtimeChannelToken } = useAuth()
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
  const [personalPinEntry, setPersonalPinEntry] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [showPasskeyDialog, setShowPasskeyDialog] = useState(false)
  const [showPinSetup, setShowPinSetup] = useState(false)
  const [setupPin, setSetupPin] = useState('')
  const [setupPinConfirm, setSetupPinConfirm] = useState('')
  const [setupSecurityAnswer, setSetupSecurityAnswer] = useState('')
  const [setupPinError, setSetupPinError] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [activeTab, setActiveTab] = useState<'chats' | 'stories' | 'requests'>('chats')
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageRequestVersion = useRef(0)
  const messagesRef = useRef<VisibleMessage[]>([])
  messagesRef.current = messages
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  const activeConv = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId])
  const isUnlocked = Boolean(passkey && activeId)
  const visibleConversations = conversations.filter(c => Boolean(c.lastMessage))

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
    messageRequestVersion.current += 1
    setPasskey(null)
    setPersonalPinEntry('')
    setPasskeyError('')
    setMessages(previous => previous.map(m => ({ ...m, plaintext: undefined, locked: true })))
  }, [])

  const loadRequests = useCallback(async () => {
    if (!user?.id) return
    try {
      const result = await apiRequest('/api/friends/requests')
      setRequests(result.requests ?? [])
    } catch (error) { console.error('Load connection requests failed:', error) }
  }, [user?.id, apiRequest])

  const loadConversations = useCallback(async () => {
    if (!user?.id) return
    try {
      const result = await apiRequest('/api/conversations')
      setConversations(result.conversations ?? [])
    } catch (error) {
      console.error('Load conversations failed:', error)
    }
  }, [user?.id, apiRequest])

  useEffect(() => { void loadConversations(); void loadRequests() }, [loadConversations, loadRequests])

  const loadMessages = useCallback(async (
    after?: string,
    replace = false,
    version = messageRequestVersion.current,
  ) => {
    if (!activeId || !user?.id) return
    const cursor = after ? `&after=${encodeURIComponent(after)}` : ''
    const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}${cursor}`)
    const rows: VisibleMessage[] = await Promise.all((result.messages ?? []).map(async (message: Message) => {
      if (!passkey) return { ...message, plaintext: undefined, locked: true }
      try {
        return { ...message, plaintext: await decryptWithConversationKey(passkey, message.ciphertext, message.iv), locked: false }
      } catch {
        return { ...message, plaintext: undefined, locked: true, decryptError: true }
      }
    }))
    if (version !== messageRequestVersion.current) return
    setMessages(previous => {
      if (replace) return rows
      const merged = new Map<string, VisibleMessage>(previous.map(message => [message.id, message]))
      for (const message of rows) merged.set(message.id, message)
      return [...merged.values()].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id)
      )
    })
  }, [activeId, passkey, user?.id, apiRequest])

  const refreshNewMessages = useCallback(() => {
    if (!activeId || !user?.id) return
    const current = messagesRef.current.filter(message => !message.id.startsWith('optimistic:'))
    const last = current[current.length - 1]
    const cursor = last ? `${last.created_at}|${last.id}` : undefined
    void loadMessages(cursor, false, messageRequestVersion.current)
  }, [activeId, user?.id, loadMessages])

  const realtimeHandlersRef = useRef<{
    requests: () => void
    conversations: () => void
    messages: () => void
  }>({
    requests: () => undefined,
    conversations: () => undefined,
    messages: () => undefined,
  })
  realtimeHandlersRef.current = {
    requests: () => { void loadRequests() },
    conversations: () => { void loadConversations() },
    messages: refreshNewMessages,
  }

  useEffect(() => {
    if (!user?.id || !realtimeChannelToken) return
    const channel = supabase.channel(`user:${realtimeChannelToken}`, {
      config: { broadcast: { self: false } },
    })
    channel
      .on('broadcast', { event: 'refresh' }, event => {
        const resource = event.payload?.resource
        const handlers = realtimeHandlersRef.current
        if (resource === 'friend_requests') handlers.requests()
        if (resource === 'conversations') handlers.conversations()
        if (resource === 'messages') {
          handlers.messages()
          handlers.conversations()
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          const handlers = realtimeHandlersRef.current
          handlers.requests()
          handlers.conversations()
          handlers.messages()
        }
      })
    return () => { void supabase.removeChannel(channel) }
  }, [user?.id, realtimeChannelToken])

  // Reconcile occasionally in case a device sleeps or a realtime packet is missed.
  useEffect(() => {
    if (!user?.id) return
    const timer = window.setInterval(() => {
      void loadRequests()
      void loadConversations()
    }, 30000)
    return () => window.clearInterval(timer)
  }, [user?.id, loadRequests, loadConversations])

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
    if (!activeId || !user?.id) {
      messageRequestVersion.current += 1
      setMessages([])
      return
    }
    const version = ++messageRequestVersion.current
    void loadMessages(undefined, true, version).catch(error => console.error('Load messages failed:', error))
    const fallback = window.setInterval(refreshNewMessages, 30000)
    return () => {
      window.clearInterval(fallback)
      if (messageRequestVersion.current === version) messageRequestVersion.current += 1
    }
  }, [activeId, passkey, user?.id, loadMessages, refreshNewMessages])

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
      const result = await apiRequest('/api/friends/requests', {
        method: 'POST', body: JSON.stringify({ username: other.username }),
      })
      const request = result.request
      if (request?.id) {
        setRequests(previous => [{
          id: request.id,
          other_user_id: other.id,
          other_username: other.username,
          direction: 'outgoing',
          status: request.status || 'pending',
        }, ...previous.filter(item => item.id !== request.id)])
      }
      setSearch('')
      setSearchResults([])
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not send request') }
  }

  function configurePersonalPin() {
    setSetupPin('')
    setSetupPinConfirm('')
    setSetupSecurityAnswer('')
    setSetupPinError('')
    setShowPinSetup(true)
  }

  async function savePersonalPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^[0-9]{4,12}$/.test(setupPin)) { setSetupPinError('PIN must contain 4–12 digits.'); return }
    if (setupPin !== setupPinConfirm) { setSetupPinError('Both PIN entries must match.'); return }
    if (setupSecurityAnswer.trim().length < 2) { setSetupPinError('Enter your security answer.'); return }
    setSavingPin(true)
    setSetupPinError('')
    try {
      await apiRequest('/api/auth/chat-pin', { method: 'POST', body: JSON.stringify({ action: 'set', pin: setupPin, securityAnswer: setupSecurityAnswer }) })
      setShowPinSetup(false)
      setSetupPin('')
      setSetupPinConfirm('')
      setSetupSecurityAnswer('')
      alert('Your personal chat PIN has been saved.')
    } catch (error) {
      setSetupPinError(error instanceof Error ? error.message : 'Could not save PIN')
    } finally { setSavingPin(false) }
  }

  async function respondToRequest(request: ConnectionRequest, action: 'accept' | 'decline' | 'cancel') {
    try {
      await apiRequest('/api/friends/requests', { method: 'PATCH', body: JSON.stringify({ request_id: request.id, action }) })
      setRequests(previous => previous.filter(item => item.id !== request.id))
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
      setShowPasskeyDialog(false)
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
    if (!activeId || !/^[0-9]{4,12}$/.test(personalPinEntry)) {
      setPasskeyError('Enter your personal 4–12 digit PIN.')
      return
    }
    try {
      const result = await apiRequest('/api/auth/chat-pin', {
        method: 'POST',
        body: JSON.stringify({ action: 'unlock', pin: personalPinEntry, conversationId: activeId }),
      })
      if (typeof result.key !== 'string') throw new Error('Could not unlock this chat.')
      setPasskey(result.key)
      setPersonalPinEntry('')
      setPasskeyError('')
      setShowPasskeyDialog(false)
    } catch (error) {
      setPasskeyError(error instanceof Error ? error.message : 'Incorrect PIN.')
    }
  }

  async function sendMessage() {
    const textToSend = input.trim()
    if (!textToSend || !activeId || !user || !passkey || sending) return
    const conversationId = activeId
    setSending(true)
    let optimisticId: string | null = null
    try {
      const encrypted = await encryptWithConversationKey(passkey, textToSend)
      optimisticId = `optimistic:${crypto.randomUUID()}`
      const optimistic: VisibleMessage = {
        id: optimisticId,
        conversation_id: conversationId,
        sender_id: user.id,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        content_type: 'text',
        media_path: null,
        media_mime: null,
        media_size: null,
        reply_to: null,
        created_at: new Date().toISOString(),
        expires_at: null,
        deleted_at: null,
        plaintext: textToSend,
        locked: false,
      }
      if (activeIdRef.current === conversationId) setMessages(previous => [...previous, optimistic])
      setInput('')
      const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(conversationId)}`, {
        method: 'POST', body: JSON.stringify(encrypted),
      })
      const saved = result.message as Message | undefined
      if (!saved?.id) throw new Error('The message was not confirmed by the server.')
      if (activeIdRef.current === conversationId) {
        setMessages(previous => {
          const next = previous.filter(message => message.id !== optimisticId && message.id !== saved.id)
          next.push({ ...saved, plaintext: textToSend, locked: false })
          return next.sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id)
          )
        })
      }
      setConversations(previous => previous.map(conversation =>
        conversation.id === conversationId
          ? { ...conversation, updated_at: saved.created_at, lastMessage: saved }
          : conversation
      ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()))
    } catch (error) {
      if (optimisticId && activeIdRef.current === conversationId) {
        setMessages(previous => previous.filter(message => message.id !== optimisticId))
        setInput(previous => previous || textToSend)
      }
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
    setPasskeyError('')
    setShowPasskeyDialog(false)
  }

  function leaveConversation() {
    lockChat()
    setActiveId(null)
    setShowPasskeyDialog(false)
  }

  return (
    <div className="newgen-app-shell w-full overflow-hidden text-slate-900">
      <div className="newgen-app-frame mx-auto flex w-full max-w-[1600px] min-w-0 overflow-hidden bg-white">
        <aside aria-label="Main navigation and conversations" className={`${activeId || showPinSetup ? 'hidden md:flex' : 'flex'} min-w-0 shrink-0 flex-col bg-white newgen-sidebar`}>
          <div className="newgen-brand-row flex items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-500 to-orange-400 text-white shadow-lg shadow-teal-200"><MessageCircle className="h-5 w-5"/></div>
              <div><div className="text-[21px] font-black tracking-tight">NEWGEN</div><div className="text-[10px] font-semibold uppercase tracking-[.22em] text-slate-400">Connect privately</div></div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              <button type="button" onClick={() => void createGroup()} title="Create group" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-emerald-600"><Users className="h-5 w-5"/></button>
              <button type="button" onClick={() => {
                if (window.confirm('Log out this account on every device? All active sessions will be revoked.')) {
                  void signOutAll().catch(error => window.alert(error instanceof Error ? error.message : 'Could not revoke all sessions.'))
                }
              }} title="Log out all devices" aria-label="Log out all devices" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-amber-600"><ShieldCheck className="h-5 w-5"/></button>
              <button type="button" onClick={() => void signOut()} title="Sign out" className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-rose-500"><LogOut className="h-5 w-5"/></button>
            </div>
          </div>

          <div className="shrink-0 px-3 pb-3 sm:px-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
              <input className="w-full rounded-2xl border border-slate-100 bg-slate-50 py-3 pl-11 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50" placeholder="Search people or chats" value={search} onChange={e => setSearch(e.target.value)}/>
            </div>
            {search.trim().length >= 2 && (
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl">
                {searchResults.length ? searchResults.map(p => (
                  <button key={p.id} type="button" onClick={() => void sendConnectionRequest(p)} disabled={creatingChat} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-emerald-50 disabled:opacity-50">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-pink-500 text-sm font-bold text-white">{p.username.slice(0,1).toUpperCase()}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">@{p.username}</span><span className="text-xs text-slate-400">Send connection request</span></span><Plus className="h-4 w-4 text-emerald-600"/>
                  </button>
                )) : <p className="p-4 text-xs text-slate-400">No matching users found.</p>}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 pb-3 sm:px-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-extrabold uppercase tracking-[.18em] text-slate-400">Your space</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600">PRIVATE BY DESIGN</span></div>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-100/80 p-1">
              {(['chats','stories','requests'] as const).map(tab => (
                <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-xl py-2.5 text-xs font-bold capitalize transition ${activeTab===tab?'bg-white text-emerald-700 shadow-sm':'text-slate-500 hover:text-slate-800'}`}>{tab}{tab==='requests' && requests.filter(r=>r.direction==='incoming').length>0 ? <span className="ml-1 rounded-full bg-teal-100 px-1.5 py-0.5 text-[9px] text-teal-700">{requests.filter(r=>r.direction==='incoming').length}</span> : null}</button>
              ))}
            </div>
          </div>

          {activeTab === 'chats' ? (
            <>
              <div className="px-5 pb-3 pt-1">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-extrabold text-slate-800">Recent conversations</h3><span className="text-[11px] font-medium text-slate-400">{visibleConversations.length} chats</span></div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  <div className="flex w-[62px] shrink-0 flex-col items-center gap-1.5">
                    <div className="relative grid h-[54px] w-[54px] place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 p-[2px]"><div className="grid h-full w-full place-items-center overflow-hidden rounded-full border-2 border-white bg-white text-xl font-bold text-emerald-600">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile?.display_name?.[0] || profile?.username?.[0] || 'Y').toUpperCase()}</div><span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-emerald-600 text-white"><Plus className="h-3 w-3"/></span></div>
                    <span className="w-full truncate text-center text-[10px] font-semibold text-slate-500">Your story</span>
                  </div>
                  {visibleConversations.filter(c=>c.type==='direct' && c.otherProfile).slice(0,8).map(c => (
                    <button key={c.id} type="button" onClick={() => openConversation(c.id)} className="flex w-[62px] shrink-0 flex-col items-center gap-1.5">
                      <span className="grid h-[54px] w-[54px] place-items-center rounded-full bg-gradient-to-tr from-amber-400 via-teal-500 to-emerald-600 p-[2px]"><span className="grid h-full w-full place-items-center rounded-full border-2 border-white bg-slate-100 text-sm font-extrabold text-slate-600">{(c.otherProfile?.username?.[0] || '?').toUpperCase()}</span></span>
                      <span className="w-full truncate text-center text-[10px] font-semibold text-slate-500">{c.otherProfile?.username}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mx-5 border-t border-slate-100"/>
              <div className="newgen-sidebar-list px-2 py-2">
                {visibleConversations.length===0 && <div className="px-7 py-12 text-center"><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-emerald-50 text-emerald-500"><MessageCircle className="h-7 w-7"/></div><p className="text-sm font-bold text-slate-700">Your conversations start here</p><p className="mt-1 text-xs leading-5 text-slate-400">Search a username above to connect and start a private chat.</p></div>}
                {visibleConversations.map(c => {
                  const name=displayName(c)
                  const online=c.otherProfile ? onlineIds.has(c.otherProfile.id) : false
                  return <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${activeId===c.id?'bg-emerald-50':'hover:bg-slate-50'}`}>
                    <span className="relative grid h-[50px] w-[50px] shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-base font-black text-white">{c.otherProfile?.avatar_url ? <img src={c.otherProfile.avatar_url} alt="" className="h-full w-full object-cover" /> : name.slice(0,1).toUpperCase()}<span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-white text-emerald-500"><Lock className="h-3 w-3"/></span>{online && <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400"/>}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-800">{name}</span><span className="shrink-0 text-[10px] text-slate-400">{c.lastMessage ? formatDistanceToNow(new Date(c.lastMessage.created_at),{addSuffix:false}) : ''}</span></span><span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><Lock className="h-3 w-3"/><span className="truncate">Private message · locked</span></span></span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400 opacity-0 transition group-hover:opacity-100"/>
                  </button>
                })}
              </div>
            </>
          ) : activeTab === 'stories' ? (
            <StoriesHub />
          ) : (
            <div className="newgen-sidebar-list p-4 sm:p-5">
              <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-500">Your circle</p><h2 className="mt-1 text-xl font-black">Connection requests</h2></div>
              {requests.length===0 && <div className="rounded-3xl bg-slate-50 p-8 text-center"><Users className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">All caught up</p><p className="mt-1 text-xs text-slate-400">New requests will appear here.</p></div>}
              <div className="space-y-3">{requests.map(request=><div key={request.id} className="rounded-2xl border border-slate-100 p-4 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-pink-500 font-bold text-white">{request.other_username.slice(0,1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">@{request.other_username}</p><p className="text-xs text-slate-400">{request.direction==='incoming'?'Wants to connect with you':'Waiting for acceptance'}</p></div></div><div className="mt-3 flex gap-2">{request.direction==='incoming'?<><button type="button" onClick={()=>void respondToRequest(request,'accept')} className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700">Accept & chat</button><button type="button" onClick={()=>void respondToRequest(request,'decline')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600">Decline</button></>:<button type="button" onClick={()=>void respondToRequest(request,'cancel')} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600">Cancel request</button>}</div></div>)}</div>
            </div>
          )}
          <div className="shrink-0 border-t border-slate-100 bg-white p-3 sm:p-4">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 font-black text-white">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (profile?.display_name?.[0] || profile?.username?.[0] || 'U').toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-800">{profile?.display_name || '@' + (profile?.username ?? '…')}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-emerald-700"><ShieldCheck className="h-3 w-3" /> Account protected</span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <ProfileEditor />
                <button type="button" onClick={configurePersonalPin} className="w-full rounded-xl border border-emerald-100 bg-white px-3 py-2.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Set / Change PIN</button>
              </div>
            </div>
          </div>
        </aside>

        <main aria-label="Chat workspace" className={`${activeId || showPinSetup?'flex':'hidden md:flex'} relative min-w-0 min-h-0 flex-1 flex-col overflow-hidden newgen-chat-panel`}>
          {showPinSetup ? (
            <section className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
              <div className="my-auto w-full max-w-[460px] rounded-[26px] border border-slate-100 bg-white p-5 shadow-[0_16px_48px_rgba(15,60,42,.08)] sm:p-7">
                <button type="button" onClick={() => setShowPinSetup(false)} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-emerald-700"><ArrowLeft className="h-4 w-4"/> Back</button>
                <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600"><ShieldCheck className="h-8 w-8"/></div>
                <p className="text-center text-[10px] font-extrabold uppercase tracking-[.22em] text-emerald-500">Account privacy</p>
                <h1 className="mt-2 text-center text-2xl font-black tracking-tight">Create your personal passkey</h1>
                <p className="mt-2 text-center text-sm leading-6 text-slate-400">This PIN belongs only to your account. You can use a different PIN from the person you chat with. To change it later, verify your security answer.</p>
                <form onSubmit={savePersonalPin} className="mt-6 space-y-3">
                  <label className="block text-left text-xs font-bold text-slate-600">New personal PIN</label>
                  <input required type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={12} value={setupPin} onChange={e=>setSetupPin(e.target.value.replace(/\D/g,''))} placeholder="4–12 digits" className="pin-mask w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50"/>
                  <label className="block text-left text-xs font-bold text-slate-600">Confirm personal PIN</label>
                  <input required type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={12} value={setupPinConfirm} onChange={e=>setSetupPinConfirm(e.target.value.replace(/\D/g,''))} placeholder="Re-enter your PIN" className="pin-mask w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50"/>
                  <label className="block text-left text-xs font-bold text-slate-600">Security question</label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm text-slate-600">What was the name of your first school?</div>
                  <input required type="text" autoComplete="off" value={setupSecurityAnswer} onChange={e=>setSetupSecurityAnswer(e.target.value)} placeholder="Your saved security answer" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50"/>
                  {setupPinError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-left text-xs text-rose-600">{setupPinError}</p>}
                  <button type="submit" disabled={savingPin} className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-200 disabled:opacity-50">{savingPin?'Saving securely…':'Save personal passkey'}</button>
                </form>
                <p className="mt-4 text-center text-[10px] leading-4 text-slate-400">Your PIN is stored as a one-way hash and is never displayed again.</p>
              </div>
            </section>
          ) : !activeConv ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-5 sm:p-8">
              <div className="max-w-md text-center"><div className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-[32px] bg-gradient-to-br from-emerald-100 to-pink-100 text-emerald-600"><MessageCircle className="h-10 w-10"/></div><p className="text-xs font-extrabold uppercase tracking-[.24em] text-emerald-500">Welcome to your private space</p><h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Good conversations.<br/>Better boundaries.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">Choose a chat to continue, or find someone new and build your circle. Your messages stay locked until you unlock them.</p><div className="mt-6 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-white px-4 py-2 text-xs font-semibold text-emerald-600 shadow-sm"><ShieldCheck className="h-4 w-4"/> Privacy-first by design</div></div>
            </div>
          ) : (
            <>
              <header className="newgen-chat-header flex min-h-[72px] shrink-0 items-center gap-3 border-b border-slate-100 px-3 sm:min-h-[76px] sm:px-5 lg:px-7">
                <button type="button" onClick={leaveConversation} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back"><ArrowLeft className="h-5 w-5"/></button>
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-lg font-black text-white">{activeConv.otherProfile?.avatar_url ? <img src={activeConv.otherProfile.avatar_url} alt="" className="h-full w-full object-cover" /> : displayName(activeConv).slice(0,1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-slate-900">{displayName(activeConv)}</span><span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'bg-emerald-400':'bg-slate-300'}`}/>{isUnlocked?'Unlocked on this device':activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'Online':'Private conversation · locked'}</span></span>
                <button type="button" onClick={()=>isUnlocked?lockChat():setShowPasskeyDialog(true)} className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-extrabold transition sm:px-4 ${isUnlocked?'bg-emerald-50 text-emerald-700 hover:bg-emerald-100':'bg-emerald-600 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-700'}`} aria-label={isUnlocked?'Lock chat':'Unlock chat'}>{isUnlocked?<ShieldCheck className="h-4 w-4"/>:<Lock className="h-4 w-4"/>}<span>{isUnlocked?'Lock':'Unlock'}</span></button>
              </header>
              {!isUnlocked ? (
                <>
                  <div className="newgen-message-list flex flex-1 min-h-0 flex-col gap-4 overscroll-contain px-3 py-5 sm:px-5 sm:py-6 lg:px-8" style={{backgroundImage:'radial-gradient(#e9e7f2 0.7px, transparent 0.7px)',backgroundSize:'20px 20px'}}>
                    <div className="mx-auto mb-2 flex items-center gap-2 rounded-full border border-slate-100 bg-white/90 px-4 py-2 text-[10px] font-semibold text-slate-400 shadow-sm"><Lock className="h-3 w-3 text-emerald-500"/> Your private messages are masked</div>
                    {messages.map(m=><div key={m.id} className={`flex ${m.sender_id===user?.id?'justify-end':'justify-start'}`}><div className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm ${m.sender_id===user?.id?'rounded-br-md bg-emerald-100 text-emerald-900':'rounded-bl-md border border-slate-100 bg-white text-slate-500'}`}><div className="text-sm tracking-[.18em]">✦ ✦ ✦ ✦ ✦ ✦</div><div className="mt-1 text-right text-[10px] text-slate-400">{formatDistanceToNow(new Date(m.created_at),{addSuffix:true})}</div></div></div>)}
                    {messages.length===0 && <div className="m-auto rounded-3xl bg-white p-8 text-center shadow-sm"><LockKeyhole className="mx-auto h-8 w-8 text-emerald-500"/><p className="mt-3 text-sm font-bold text-slate-700">Your private room</p><p className="mt-1 text-xs text-slate-400">Messages will appear here, hidden until you unlock them.</p></div>}
                    <div ref={bottomRef}/>
                  </div>
                  <div className="newgen-chat-composer border-t border-slate-100 p-3 pb-[max(.85rem,env(safe-area-inset-bottom))] sm:p-4">
                    {showPasskeyDialog ? <form onSubmit={e=>{e.preventDefault();void unlockChat()}} className="mx-auto max-w-lg space-y-2">
                      <p className="text-center text-sm font-extrabold text-slate-800">Unlock original messages</p>
                      <input type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" value={personalPinEntry} onChange={e=>setPersonalPinEntry(e.target.value.replace(/\D/g,''))} placeholder="Your personal PIN (4–12 digits)" className="pin-mask w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                      {passkeyError&&<p role="alert" className="text-xs text-rose-600">{passkeyError}</p>}
                      <div className="flex gap-2"><button type="button" onClick={()=>{setShowPasskeyDialog(false);setPersonalPinEntry('');setPasskeyError('')}} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600">Cancel</button><button type="submit" className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-extrabold text-white">Unlock messages</button></div>
                    </form> : <button type="button" onClick={()=>setShowPasskeyDialog(true)} className="mx-auto flex w-full max-w-lg items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-sm font-extrabold text-white"><LockKeyhole className="h-4 w-4"/> Enter personal PIN to view messages</button>}
                  </div>
                </>
              ) : (
                <>
                  <div className="newgen-message-list flex flex-1 min-h-0 flex-col gap-4 overscroll-contain px-3 py-5 sm:px-5 sm:py-6 lg:px-8" style={{backgroundImage:'radial-gradient(#e9e7f2 0.7px, transparent 0.7px)',backgroundSize:'20px 20px'}}>
                    <div className="mx-auto mb-2 flex items-center gap-2 rounded-full border border-slate-100 bg-white/90 px-4 py-2 text-[10px] font-semibold text-slate-400 shadow-sm"><Lock className="h-3 w-3 text-emerald-500"/> Messages decrypt only on this device</div>
                    {messages.map(m=>{const mine=m.sender_id===user?.id;return <div key={m.id} className={`message-enter flex ${mine?'justify-end':'justify-start'}`}><div className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm md:max-w-[68%] ${mine?'rounded-br-md bg-gradient-to-br from-emerald-600 to-teal-600 text-white':'rounded-bl-md border border-slate-100 bg-white text-slate-800'}`}><div className="flex items-start gap-2 text-sm leading-6">{m.locked?<Lock className="mt-1 h-3.5 w-3.5 shrink-0"/>:null}<span className="whitespace-pre-wrap break-words">{m.plaintext??(m.decryptError?'Old message (sent before PIN-only unlock) — cannot be shown':'✦ ✦ ✦ ✦ ✦ ✦')}</span></div><div className={`mt-1.5 flex items-center justify-end gap-1 text-[10px] ${mine?'text-white/65':'text-slate-400'}`}>{formatDistanceToNow(new Date(m.created_at),{addSuffix:true})}{mine&&<ShieldCheck className="h-3 w-3"/>}</div></div></div>})}
                    <div ref={bottomRef}/>
                  </div>
                  <div className="newgen-chat-composer border-t border-slate-100 px-3 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4 lg:px-7">
                    <form className="mx-auto flex max-w-5xl items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-2 focus-within:border-emerald-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-50" onSubmit={e=>{e.preventDefault();void sendMessage()}}>
                      <input className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-400" placeholder="Write a private message…" value={input} onChange={e=>setInput(e.target.value)} disabled={sending}/>
                      <button type="submit" disabled={sending||!input.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-200 transition hover:scale-[1.03] disabled:opacity-40"><Send className="h-4 w-4"/></button>
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

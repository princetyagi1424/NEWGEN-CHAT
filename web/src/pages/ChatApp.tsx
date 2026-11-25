import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, Bell, CircleDot, Lock, LockKeyhole, LogOut, MessageCircle, Search, Send, Users,
  ShieldCheck, Plus, UserRound, Trash2
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
  unread_count?: number
  last_read_at?: string | null
  created_by?: string
}
type VisibleMessage = Message & { plaintext?: string; locked?: boolean; decryptError?: boolean }
type ConnectionRequest = { id: string; other_user_id: string; other_username: string; direction: 'incoming' | 'outgoing'; status: string }
type SearchProfile = Profile & { is_friend?: boolean }

export default function ChatApp() {
  const { user, profile, signOut, signOutAll, realtimeChannelToken } = useAuth()
  const [conversations, setConversations] = useState<ConvWithMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<VisibleMessage[]>([])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchProfile[]>([])
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
  const [setupCurrentPassword, setSetupCurrentPassword] = useState('')
  const [setupSecurityQuestion, setSetupSecurityQuestion] = useState('Verify with your security answer or current account password')
  const [hasPersonalPin, setHasPersonalPin] = useState(false)
  const [loadingPinSettings, setLoadingPinSettings] = useState(false)
  const [setupPinError, setSetupPinError] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [activeTab, setActiveTab] = useState<'chats' | 'stories' | 'requests' | 'profile'>('chats')
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageRequestVersion = useRef(0)
  const messagesRef = useRef<VisibleMessage[]>([])
  messagesRef.current = messages
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  const activeFromList = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId])
  const [stickyConv, setStickyConv] = useState<ConvWithMeta | null>(null)
  const activeConv = activeFromList || (stickyConv && stickyConv.id === activeId ? stickyConv : null)
  const isUnlocked = Boolean(passkey && activeId)
  const visibleConversations = conversations

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
      const next = Array.isArray(result.conversations) ? result.conversations : []
      setConversations(next)
      // Keep sticky conversation in sync when the list still contains it
      setStickyConv(previous => {
        if (!previous) return previous
        const match = next.find((c: ConvWithMeta) => c.id === previous.id)
        return match ? match : previous
      })
    } catch (error) {
      console.error('Load conversations failed:', error)
      // Do not clear the existing list on a transient API error
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

  const realtimeHandlersRef = useRef({ requests: () => undefined as void, conversations: () => undefined as void, messages: () => undefined as void })
  realtimeHandlersRef.current = {
    requests: () => { void loadRequests() },
    conversations: () => { void loadConversations() },
    messages: refreshNewMessages,
  }

  useEffect(() => {
    if (!user?.id || !realtimeChannelToken) return
    const channel = supabase.channel(`user:${realtimeChannelToken}`, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'refresh' }, event => {
      const resource = event.payload?.resource
      const handlers = realtimeHandlersRef.current
      if (resource === 'friend_requests') handlers.requests()
      if (resource === 'conversations') handlers.conversations()
      if (resource === 'messages') { handlers.messages(); handlers.conversations() }
    }).subscribe(status => {
      if (status === 'SUBSCRIBED') {
        const handlers = realtimeHandlersRef.current
        handlers.requests(); handlers.conversations(); handlers.messages()
      }
    })
    return () => { void supabase.removeChannel(channel) }
  }, [user?.id, realtimeChannelToken])

  useEffect(() => {
    if (!user?.id) return
    const timer = window.setInterval(() => { void loadRequests(); void loadConversations() }, 30000)
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
    // Lock only when the page is actually hidden — not on input blur (mobile keyboards fire blur).
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') lockChat()
    }
    const onPageHide = () => lockChat()
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
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
        if (!cancelled) setSearchResults((result.users ?? []).map((p: { id: string; username: string; is_friend?: boolean }) => ({
          id: p.id, username: p.username, display_name: p.username, avatar_url: null, bio: null,
          created_at: '', updated_at: '', last_seen_at: null, is_friend: p.is_friend === true,
        })) as SearchProfile[])
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
      const result = await apiRequest('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username: other.username }) })
      const request = result.request
      if (request?.id) {
        setRequests(previous => [{
          id: request.id, other_user_id: other.id, other_username: other.username, direction: 'outgoing', status: request.status || 'pending',
        }, ...previous.filter(item => item.id !== request.id)])
      }
      setSearch(''); setSearchResults([])
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not send request') }
  }

  async function configurePersonalPin() {
    setSetupPin(''); setSetupPinConfirm(''); setSetupSecurityAnswer(''); setSetupCurrentPassword(''); setSetupPinError('')
    setShowPinSetup(true); setLoadingPinSettings(true)
    try {
      const settings = await apiRequest('/api/auth/chat-pin')
      setSetupSecurityQuestion(typeof settings.securityQuestion === 'string' && settings.securityQuestion.trim() ? settings.securityQuestion : 'Your account security question')
      setHasPersonalPin(settings.hasPin === true)
    } catch (error) {
      setSetupPinError(error instanceof Error ? error.message : 'Could not load PIN settings')
    } finally { setLoadingPinSettings(false) }
  }

  async function savePersonalPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^[0-9]{4,12}$/.test(setupPin)) { setSetupPinError('PIN must contain 4–12 digits.'); return }
    if (setupPin !== setupPinConfirm) { setSetupPinError('Both PIN entries must match.'); return }
    if (setupSecurityAnswer.trim().length < 2 && !setupCurrentPassword) { setSetupPinError('Enter your security answer or current account password.'); return }
    setSavingPin(true); setSetupPinError('')
    try {
      await apiRequest('/api/auth/chat-pin', { method: 'POST', body: JSON.stringify({ action: hasPersonalPin ? 'change' : 'set', pin: setupPin, securityAnswer: setupSecurityAnswer, currentPassword: setupCurrentPassword }) })
      setHasPersonalPin(true); setShowPinSetup(false); setSetupPin(''); setSetupPinConfirm(''); setSetupSecurityAnswer(''); setSetupCurrentPassword('')
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
      const result = await apiRequest('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ other_user_id: other.id }) })
      const conv = result.conversation as Conversation
      const next: ConvWithMeta = { ...conv, members: [{ user_id: user.id, role: 'owner' }, { user_id: other.id, role: 'member' }], otherProfile: other, lastMessage: null, unread_count: 0 }
      setConversations(previous => [next, ...previous.filter(item => item.id !== conv.id)])
      setStickyConv(next)
      setActiveId(conv.id); setPasskey(null); setShowPasskeyDialog(false); setSearch(''); setSearchResults([]); setActiveTab('chats')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not start chat')
    } finally { setCreatingChat(false) }
  }

  async function createGroup() {
    if (!user) return
    const name = window.prompt('Group name')
    if (!name?.trim()) return
    try {
      const result = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setConversations(previous => [result.conversation, ...previous])
      setStickyConv(result.conversation)
      setActiveId(result.conversation.id); setPasskey(null); setShowPasskeyDialog(true)
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
      const result = await apiRequest('/api/auth/chat-pin', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: personalPinEntry, conversationId: activeId }) })
      if (typeof result.key !== 'string') throw new Error('Could not unlock this chat.')
      setPasskey(result.key); setPersonalPinEntry(''); setPasskeyError(''); setShowPasskeyDialog(false)
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
        id: optimisticId, conversation_id: conversationId, sender_id: user.id, ciphertext: encrypted.ciphertext, iv: encrypted.iv,
        content_type: 'text', media_path: null, media_mime: null, media_size: null, reply_to: null,
        created_at: new Date().toISOString(), expires_at: null, deleted_at: null, plaintext: textToSend, locked: false,
      }
      if (activeIdRef.current === conversationId) setMessages(previous => [...previous, optimistic])
      setInput('')
      const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(conversationId)}`, { method: 'POST', body: JSON.stringify(encrypted) })
      const saved = result.message as Message | undefined
      if (!saved?.id) throw new Error('The message was not confirmed by the server.')
      if (activeIdRef.current === conversationId) {
        setMessages(previous => {
          const next = previous.filter(message => message.id !== optimisticId && message.id !== saved.id)
          next.push({ ...saved, plaintext: textToSend, locked: false })
          return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id))
        })
      }
      setConversations(previous => previous.map(conversation =>
        conversation.id === conversationId ? { ...conversation, updated_at: saved.created_at, lastMessage: saved } : conversation
      ).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()))
    } catch (error) {
      if (optimisticId && activeIdRef.current === conversationId) {
        setMessages(previous => previous.filter(message => message.id !== optimisticId))
        setInput(previous => previous || textToSend)
      }
      alert(error instanceof Error ? error.message : 'Message could not be sent')
    } finally { setSending(false) }
  }

  async function deleteMessage(messageId: string) {
    if (!messageId || messageId.startsWith('optimistic:')) return
    if (!window.confirm('Delete this message?')) return
    try {
      await apiRequest(`/api/messages?message_id=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
      setMessages(previous => previous.filter(m => m.id !== messageId))
      void loadConversations()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete message')
    }
  }

  async function deleteConversation() {
    if (!activeId || !activeConv) return
    const isGroup = activeConv.type === 'group'
    const ok = window.confirm(isGroup
      ? 'Delete this group for everyone? This cannot be undone.'
      : 'Remove this chat from your list?')
    if (!ok) return
    try {
      await apiRequest(`/api/conversations?conversation_id=${encodeURIComponent(activeId)}`, { method: 'DELETE' })
      setConversations(previous => previous.filter(c => c.id !== activeId))
      leaveConversation()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete conversation')
    }
  }

  const displayName = (c: ConvWithMeta) => c.type === 'group'
    ? (c.name || 'Group')
    : (c.otherProfile?.display_name || c.otherProfile?.username || 'Direct chat')

  function openConversation(id: string) {
    const found = conversations.find(c => c.id === id) || null
    if (found) setStickyConv({ ...found, unread_count: 0 })
    setPasskey(null)
    setPersonalPinEntry('')
    setPasskeyError('')
    setMessages([])
    setActiveId(id)
    setShowPasskeyDialog(false)
    setConversations(previous => previous.map(c => c.id === id ? { ...c, unread_count: 0 } : c))
  }

  function leaveConversation() {
    setPasskey(null)
    setPersonalPinEntry('')
    setPasskeyError('')
    setMessages([])
    setActiveId(null)
    setStickyConv(null)
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
              <button type="button" onClick={() => void createGroup()} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" title="New group"><Users className="h-4 w-4"/></button>
              <button type="button" onClick={() => void signOut()} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" title="Sign out"><LogOut className="h-4 w-4"/></button>
            </div>
          </div>
          <div className="flex gap-1 px-4 pb-2 sm:px-5">
            {(['chats','stories','requests','profile'] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${activeTab===tab?'bg-emerald-600 text-white':'text-slate-500 hover:bg-slate-100'}`}>{tab}</button>
            ))}
          </div>
          {activeTab === 'chats' ? (
            <>
              <div className="px-4 pb-3 sm:px-5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people or chats" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-emerald-300 focus:bg-white"/>
                </div>
                {searchResults.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-slate-100 bg-white shadow-lg">
                    {searchResults.map(p => (
                      <button key={p.id} type="button" onClick={() => void (p.is_friend ? startDirectChat(p) : sendConnectionRequest(p))} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                        <span className="font-semibold text-slate-800">@{p.username}</span>
                        <span className="text-xs text-emerald-600">{p.is_friend ? 'Chat' : 'Request'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="newgen-sidebar-list px-2 py-2">
                {visibleConversations.length===0 && <div className="px-7 py-12 text-center"><div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-emerald-50 text-emerald-500"><MessageCircle className="h-7 w-7"/></div><p className="text-sm font-bold text-slate-700">Your conversations start here</p><p className="mt-1 text-xs leading-5 text-slate-400">Search a username above to connect and start a private chat.</p></div>}
                {visibleConversations.map(c => {
                  const name=displayName(c)
                  const online=c.otherProfile ? onlineIds.has(c.otherProfile.id) : false
                  const unread = Number(c.unread_count || 0)
                  return <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${activeId===c.id?'bg-emerald-50':'hover:bg-slate-50'}`}>
                    <span className="relative grid h-[50px] w-[50px] shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-base font-black text-white">{c.otherProfile?.avatar_url ? <img src={c.otherProfile.avatar_url} alt="" className="h-full w-full object-cover" /> : name.slice(0,1).toUpperCase()}<span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-white text-emerald-500"><Lock className="h-3 w-3"/></span>{online && <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-400"/>}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${unread>0?'font-extrabold text-slate-900':'font-bold text-slate-800'}`}>{name}</span><span className="flex shrink-0 items-center gap-1.5"><span className="text-[10px] text-slate-400">{c.lastMessage ? formatDistanceToNow(new Date(c.lastMessage.created_at),{addSuffix:false}) : ''}</span>{unread>0 && <span className="min-w-[1.25rem] rounded-full bg-emerald-600 px-1.5 py-0.5 text-center text-[10px] font-black text-white">{unread>99?'99+':unread}</span>}</span></span><span className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><Lock className="h-3 w-3"/><span className="truncate">{unread>0?`${unread} new message${unread===1?'':'s'}`:(c.type==='group'?'Group · locked':'Private message · locked')}</span></span></span>
                  </button>
                })}
              </div>
            </>
          ) : activeTab === 'stories' ? (
            <StoriesHub />
          ) : activeTab === 'requests' ? (
            <div className="newgen-sidebar-list space-y-2 px-4 py-3">
              {requests.length===0 && <p className="px-2 py-8 text-center text-sm text-slate-400">No pending requests</p>}
              {requests.map(r => (
                <div key={r.id} className="rounded-2xl border border-slate-100 p-3">
                  <div className="text-sm font-bold text-slate-800">@{r.other_username}</div>
                  <div className="mt-1 text-xs text-slate-400">{r.direction === 'incoming' ? 'Wants to connect' : 'Request sent'}</div>
                  <div className="mt-2 flex gap-2">
                    {r.direction === 'incoming' ? (
                      <>
                        <button type="button" onClick={() => void respondToRequest(r, 'accept')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Accept</button>
                        <button type="button" onClick={() => void respondToRequest(r, 'decline')} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600">Decline</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => void respondToRequest(r, 'cancel')} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-slate-600">Cancel</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="newgen-sidebar-list px-4 py-3">
              <ProfileEditor />
              <button type="button" onClick={() => void configurePersonalPin()} className="mt-3 w-full rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-700">Set / Change PIN</button>
              <button type="button" onClick={() => void signOutAll()} className="mt-2 w-full rounded-2xl py-3 text-sm font-bold text-rose-600">Sign out all devices</button>
            </div>
          )}
        </aside>

        <main className={`${!activeId && !showPinSetup ? 'hidden md:flex' : 'flex'} min-h-0 min-w-0 flex-1 flex-col newgen-chat-panel`}>
          {showPinSetup ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
              <button type="button" onClick={() => setShowPinSetup(false)} className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4"/> Back</button>
              <form onSubmit={e => void savePersonalPin(e)} className="mx-auto w-full max-w-md space-y-3 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-black text-slate-900">{hasPersonalPin ? 'Change personal PIN' : 'Set personal PIN'}</h2>
                {loadingPinSettings && <p className="text-xs text-slate-400">Loading…</p>}
                <input type="password" inputMode="numeric" value={setupPin} onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))} placeholder="New PIN (4–12 digits)" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                <input type="password" inputMode="numeric" value={setupPinConfirm} onChange={e => setSetupPinConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Confirm PIN" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                <p className="text-xs text-slate-400">{setupSecurityQuestion}</p>
                <input value={setupSecurityAnswer} onChange={e => setSetupSecurityAnswer(e.target.value)} placeholder="Security answer" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                <input type="password" value={setupCurrentPassword} onChange={e => setSetupCurrentPassword(e.target.value)} placeholder="Or current account password" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                {setupPinError && <p className="text-xs text-rose-600">{setupPinError}</p>}
                <button type="submit" disabled={savingPin} className="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-extrabold text-white disabled:opacity-50">{savingPin ? 'Saving…' : 'Save PIN'}</button>
              </form>
            </div>
          ) : !activeConv ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-5 sm:p-8">
              <div className="max-w-md text-center"><div className="mx-auto mb-6 grid h-24 w-24 place-items-center rounded-[32px] bg-gradient-to-br from-emerald-100 to-pink-100 text-emerald-600"><MessageCircle className="h-10 w-10"/></div><p className="text-xs font-extrabold uppercase tracking-[.24em] text-emerald-500">Welcome to your private space</p><h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Good conversations.<br/>Better boundaries.</h2><p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-slate-400">Choose a chat to continue, or find someone new.</p></div>
            </div>
          ) : (
            <>
              <header className="newgen-chat-header flex min-h-[72px] shrink-0 items-center gap-3 border-b border-slate-100 px-3 sm:min-h-[76px] sm:px-5 lg:px-7">
                <button type="button" onClick={leaveConversation} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Back"><ArrowLeft className="h-5 w-5"/></button>
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-lg font-black text-white">{activeConv.otherProfile?.avatar_url ? <img src={activeConv.otherProfile.avatar_url} alt="" className="h-full w-full object-cover" /> : displayName(activeConv).slice(0,1).toUpperCase()}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-slate-900">{displayName(activeConv)}</span><span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'bg-emerald-400':'bg-slate-300'}`}/>{isUnlocked?'Unlocked on this device':activeConv.otherProfile && onlineIds.has(activeConv.otherProfile.id)?'Online':'Private conversation · locked'}</span></span>
                <button type="button" onClick={()=>isUnlocked?lockChat():setShowPasskeyDialog(true)} className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-extrabold transition sm:px-4 ${isUnlocked?'bg-emerald-50 text-emerald-700 hover:bg-emerald-100':'bg-emerald-600 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-700'}`} aria-label={isUnlocked?'Lock chat':'Unlock chat'}>{isUnlocked?<ShieldCheck className="h-4 w-4"/>:<Lock className="h-4 w-4"/>}<span>{isUnlocked?'Lock':'Unlock'}</span></button>
                {(activeConv.type === 'group' && (activeConv.created_by === user?.id || activeConv.members?.some(m => m.user_id === user?.id && m.role === 'owner'))) && (
                  <button type="button" onClick={() => void deleteConversation()} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-extrabold text-rose-600 transition hover:bg-rose-50" title="Delete group" aria-label="Delete group">
                    <Trash2 className="h-4 w-4"/><span className="hidden sm:inline">Delete</span>
                  </button>
                )}
                {activeConv.type === 'direct' && (
                  <button type="button" onClick={() => void deleteConversation()} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-extrabold text-slate-500 transition hover:bg-slate-100" title="Remove chat" aria-label="Remove chat">
                    <Trash2 className="h-4 w-4"/>
                  </button>
                )}
              </header>
              {!isUnlocked ? (
                <>
                  <div className="newgen-message-list flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
                    {messages.map(m => (
                      <div key={m.id} className={`flex ${m.sender_id===user?.id?'justify-end':'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-[22px] px-4 py-3 ${m.sender_id===user?.id?'rounded-br-md bg-emerald-100 text-emerald-900':'rounded-bl-md border border-slate-100 bg-white text-slate-500'}`}>
                          <div className="text-sm tracking-[.18em]">✦ ✦ ✦ ✦ ✦ ✦</div>
                          <div className="mt-1 text-right text-[10px] text-slate-400">{formatDistanceToNow(new Date(m.created_at),{addSuffix:true})}</div>
                        </div>
                      </div>
                    ))}
                    {messages.length===0 && <div className="m-auto rounded-3xl bg-white p-8 text-center shadow-sm"><LockKeyhole className="mx-auto h-8 w-8 text-emerald-500"/><p className="mt-3 text-sm font-bold text-slate-700">Your private room</p></div>}
                    <div ref={bottomRef}/>
                  </div>
                  <div className="newgen-chat-composer border-t border-slate-100 p-3 pb-[max(.85rem,env(safe-area-inset-bottom))] sm:p-4">
                    {showPasskeyDialog ? <form onSubmit={e=>{e.preventDefault();void unlockChat()}} className="mx-auto max-w-lg space-y-2">
                      <p className="text-center text-sm font-extrabold text-slate-800">Unlock original messages</p>
                      <input type="text" inputMode="numeric" autoComplete="off" value={personalPinEntry} onChange={e=>setPersonalPinEntry(e.target.value.replace(/\D/g,''))} placeholder="Your personal PIN (4–12 digits)" className="pin-mask w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-300"/>
                      {passkeyError&&<p role="alert" className="text-xs text-rose-600">{passkeyError}</p>}
                      <div className="flex gap-2"><button type="button" onClick={()=>{setShowPasskeyDialog(false);setPersonalPinEntry('');setPasskeyError('')}} className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600">Cancel</button><button type="submit" className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-sm font-extrabold text-white">Unlock messages</button></div>
                    </form> : <button type="button" onClick={()=>setShowPasskeyDialog(true)} className="mx-auto flex w-full max-w-lg items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3.5 text-sm font-extrabold text-white"><LockKeyhole className="h-4 w-4"/> Enter personal PIN to view messages</button>}
                  </div>
                </>
              ) : (
                <>
                  <div className="newgen-message-list flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6">
                    {messages.map(m=>{
                      const mine=m.sender_id===user?.id
                      return <div key={m.id} className={`message-enter group/msg flex ${mine?'justify-end':'justify-start'}`}>
                        <div className={`relative max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm md:max-w-[68%] ${mine?'rounded-br-md bg-gradient-to-br from-emerald-600 to-teal-600 text-white':'rounded-bl-md border border-slate-100 bg-white text-slate-800'}`}>
                          <div className="flex items-start gap-2 text-sm leading-6">{m.locked?<Lock className="mt-1 h-3.5 w-3.5 shrink-0"/>:null}<span className="whitespace-pre-wrap break-words">{m.plaintext??(m.decryptError?'Unable to decrypt':'✦ ✦ ✦ ✦ ✦ ✦')}</span></div>
                          <div className={`mt-1.5 flex items-center justify-end gap-2 text-[10px] ${mine?'text-white/65':'text-slate-400'}`}>
                            {formatDistanceToNow(new Date(m.created_at),{addSuffix:true})}
                            {mine&&!m.locked&&<button type="button" title="Delete message" onClick={()=>void deleteMessage(m.id)} className="rounded-md p-0.5 opacity-70 transition hover:opacity-100 hover:bg-white/15"><Trash2 className="h-3 w-3"/></button>}
                            {mine&&<ShieldCheck className="h-3 w-3"/>}
                          </div>
                        </div>
                      </div>
                    })}
                    <div ref={bottomRef}/>
                  </div>
                  <div className="newgen-chat-composer border-t border-slate-100 px-3 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4 lg:px-7">
                    <form className="mx-auto flex max-w-5xl items-center gap-2 rounded-[22px] border border-slate-200 bg-slate-50 p-2 focus-within:border-emerald-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-emerald-50" onSubmit={e=>{e.preventDefault();void sendMessage()}}>
                      <input className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-400" placeholder="Write a private message…" value={input} onChange={e=>setInput(e.target.value)} disabled={sending}/>
                      <button type="submit" disabled={sending||!input.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-200 transition hover:scale-[1.03] disabled:opacity-40"><Send className="h-4 w-4"/></button>
                    </form>
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

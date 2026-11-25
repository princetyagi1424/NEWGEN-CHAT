import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  ArrowLeft, Bell, CircleDot, Lock, LockKeyhole, MessageCircle, Plus, Search, Send, ShieldCheck, Users,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiRequest } from '../lib/api'
import { supabase } from '../lib/supabase'
import { encryptWithConversationKey, decryptWithConversationKey } from '../crypto/passkey'
import type { Conversation, Message, Profile } from '../types/database'
import Avatar from '../components/Avatar'
import ProfilePanel from '../components/ProfilePanel'
import StoryComposer from '../components/StoryComposer'
import StoryViewer, { type StoryGroup, type StoryItem } from '../components/StoryViewer'

type ConvWithMeta = Conversation & {
  members?: { user_id: string; role: string }[]
  otherProfile?: Profile | null
  lastMessage?: Message | null
}
type VisibleMessage = Message & { plaintext?: string; locked?: boolean; decryptError?: boolean }
type ConnectionRequest = {
  id: string; other_user_id: string; other_username: string; other_display_name?: string; other_avatar?: string | null
  direction: 'incoming' | 'outgoing'; status: string
}
type Tab = 'chats' | 'stories' | 'requests'
type Panel = null | 'profile' | 'pin'

const TAB_TITLES: Record<Tab, string> = { chats: 'Chats', stories: 'Stories', requests: 'Requests' }

function toProfile(base: { id: string; username: string; display_name?: string | null; avatar?: string | null }): Profile {
  return {
    id: base.id, username: base.username, display_name: base.display_name || base.username, avatar_url: base.avatar ?? null,
    bio: null, created_at: '', updated_at: '', last_seen_at: null,
  } as Profile
}

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso))

export default function ChatApp() {
  const { user, profile } = useAuth()
  const [conversations, setConversations] = useState<ConvWithMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<VisibleMessage[]>([])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [requests, setRequests] = useState<ConnectionRequest[]>([])
  const [stories, setStories] = useState<StoryItem[]>([])
  const [sending, setSending] = useState(false)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [passkey, setPasskey] = useState<string | null>(null)
  const [personalPinEntry, setPersonalPinEntry] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [showPasskeyDialog, setShowPasskeyDialog] = useState(false)
  const [setupPin, setSetupPin] = useState('')
  const [setupPinConfirm, setSetupPinConfirm] = useState('')
  const [setupSecurityAnswer, setSetupSecurityAnswer] = useState('')
  const [setupPinError, setSetupPinError] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [creatingChat, setCreatingChat] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chats')
  const [panel, setPanel] = useState<Panel>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [viewerStart, setViewerStart] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeConv = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId])
  const isUnlocked = Boolean(passkey && activeId)
  const visibleConversations = useMemo(() => conversations.filter(c => Boolean(c.lastMessage)), [conversations])
  const incomingCount = requests.filter(r => r.direction === 'incoming').length
  // On phones only one screen shows at a time: the list, or a chat / profile / PIN screen.
  const mainOnMobile = Boolean(activeId) || panel !== null

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => setNotice({ kind, text }), [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  const lockChat = useCallback(() => {
    setPasskey(null)
    setPersonalPinEntry('')
    setPasskeyError('')
    setMessages(previous => previous.map(m => ({ ...m, plaintext: undefined, locked: true })))
  }, [])

  const loadRequests = useCallback(async () => {
    if (!user) return
    try { setRequests((await apiRequest('/api/friends/requests')).requests ?? []) }
    catch (error) { console.error('Load connection requests failed:', error) }
  }, [user])

  const loadConversations = useCallback(async () => {
    if (!user) return
    try { setConversations((await apiRequest('/api/conversations')).conversations ?? []) }
    catch (error) { console.error('Load conversations failed:', error) }
  }, [user])

  const loadStories = useCallback(async () => {
    if (!user) return
    try { setStories((await apiRequest('/api/stories')).stories ?? []) }
    catch (error) { console.error('Load stories failed:', error) }
  }, [user])

  useEffect(() => { void loadConversations(); void loadRequests(); void loadStories() }, [loadConversations, loadRequests, loadStories])
  useEffect(() => {
    const timer = window.setInterval(() => { void loadStories() }, 45_000)
    return () => window.clearInterval(timer)
  }, [loadStories])

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
          if (!passkey) rows.push({ ...message, plaintext: undefined, locked: true })
          else {
            try { rows.push({ ...message, plaintext: await decryptWithConversationKey(passkey, message.ciphertext, message.iv), locked: false }) }
            catch { rows.push({ ...message, plaintext: undefined, locked: true, decryptError: true }) }
          }
        }
        if (!cancelled) setMessages(rows)
      } catch (error) { if (!cancelled) console.error('Load messages failed:', error) }
    }
    void refresh()
    const poll = window.setInterval(() => { void refresh() }, 2500)
    return () => { cancelled = true; window.clearInterval(poll) }
  }, [activeId, passkey, user])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    // Lock when the page is hidden or closed. Window "blur" is deliberately not used:
    // on phones it fires when the keyboard or a picker opens and would lock the chat mid-use.
    const onVisibility = () => { if (document.visibilityState === 'hidden') lockChat() }
    window.addEventListener('pagehide', lockChat)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', lockChat)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [lockChat])

  useEffect(() => {
    const query = search.trim().toLowerCase()
    if (query.length < 2) { setSearchResults([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiRequest(`/api/users/search?q=${encodeURIComponent(query)}`)
        if (!cancelled) setSearchResults((result.users ?? []).map(toProfile))
      } catch (error) {
        if (!cancelled) { console.error('User search failed:', error); setSearchResults([]) }
      }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [search])

  // ---- Stories ----
  const storyGroups = useMemo<StoryGroup[]>(() => {
    const byUser = new Map<string, StoryGroup>()
    for (const story of stories) {
      const group = byUser.get(story.user_id) ?? { userId: story.user_id, author: story.author, stories: [], allSeen: true }
      group.stories.push(story)
      if (!story.seen) group.allSeen = false
      byUser.set(story.user_id, group)
    }
    const latest = (g: StoryGroup) => g.stories[g.stories.length - 1].created_at
    return [...byUser.values()].sort((a, b) => {
      if (a.userId === user?.id) return -1
      if (b.userId === user?.id) return 1
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1
      return latest(b).localeCompare(latest(a))
    })
  }, [stories, user?.id])
  const myGroup = storyGroups.find(g => g.userId === user?.id)
  const friendGroups = storyGroups.filter(g => g.userId !== user?.id)
  const groupByUser = useMemo(() => new Map(storyGroups.map(g => [g.userId, g])), [storyGroups])

  function openStoryGroup(userId: string) {
    const index = storyGroups.findIndex(g => g.userId === userId)
    if (index >= 0) setViewerStart(index)
  }
  function onMyStoryTap() { if (myGroup) openStoryGroup(user!.id); else setComposerOpen(true) }
  const markSeen = useCallback((storyId: string) => {
    setStories(previous => previous.map(s => (s.id === storyId ? { ...s, seen: true } : s)))
  }, [])

  // ---- Navigation ----
  function selectTab(tab: Tab) { setActiveTab(tab); setPanel(null); setActiveId(null); lockChat() }
  function openProfile() { setPanel('profile'); lockChat(); setActiveId(null) }
  function openConversation(id: string) {
    lockChat(); setPanel(null); setActiveId(id); setPasskeyError(''); setShowPasskeyDialog(false)
  }
  function leaveConversation() { lockChat(); setActiveId(null); setShowPasskeyDialog(false) }

  // ---- Actions ----
  async function sendConnectionRequest(other: Profile) {
    try {
      await apiRequest('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username: other.username }) })
      notify('Connection request sent')
      setSearch(''); setSearchResults([])
      await loadRequests()
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not send request', 'error') }
  }

  function openPinSetup() {
    setSetupPin(''); setSetupPinConfirm(''); setSetupSecurityAnswer(''); setSetupPinError('')
    setPanel('pin'); lockChat(); setActiveId(null)
  }

  async function savePersonalPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^[0-9]{4,12}$/.test(setupPin)) { setSetupPinError('PIN must contain 4–12 digits.'); return }
    if (setupPin !== setupPinConfirm) { setSetupPinError('Both PIN entries must match.'); return }
    if (setupSecurityAnswer.trim().length < 2) { setSetupPinError('Enter your security answer.'); return }
    setSavingPin(true); setSetupPinError('')
    try {
      await apiRequest('/api/auth/chat-pin', { method: 'POST', body: JSON.stringify({ action: 'set', pin: setupPin, securityAnswer: setupSecurityAnswer }) })
      setPanel('profile')
      setSetupPin(''); setSetupPinConfirm(''); setSetupSecurityAnswer('')
      notify('Your chat PIN is saved')
    } catch (error) { setSetupPinError(error instanceof Error ? error.message : 'Could not save PIN') }
    finally { setSavingPin(false) }
  }

  async function respondToRequest(request: ConnectionRequest, action: 'accept' | 'decline' | 'cancel') {
    try {
      await apiRequest('/api/friends/requests', { method: 'PATCH', body: JSON.stringify({ request_id: request.id, action }) })
      await loadRequests()
      if (action === 'accept') {
        await startDirectChat(toProfile({ id: request.other_user_id, username: request.other_username, display_name: request.other_display_name, avatar: request.other_avatar }))
        void loadStories()
      }
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not update request', 'error') }
  }

  async function startDirectChat(other: Profile) {
    if (!user || creatingChat) return
    setCreatingChat(true)
    try {
      const result = await apiRequest('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ other_user_id: other.id }) })
      const conv = result.conversation as Conversation
      const next: ConvWithMeta = {
        ...conv, members: [{ user_id: user.id, role: 'owner' }, { user_id: other.id, role: 'member' }], otherProfile: other, lastMessage: null,
      }
      setConversations(previous => [next, ...previous.filter(item => item.id !== conv.id)])
      setActiveTab('chats'); setPanel(null); setActiveId(conv.id)
      setPasskey(null); setShowPasskeyDialog(false); setSearch(''); setSearchResults([])
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not start chat', 'error') }
    finally { setCreatingChat(false) }
  }

  async function createGroup() {
    if (!user) return
    const name = window.prompt('Group name')
    if (!name?.trim()) return
    try {
      const result = await apiRequest('/api/conversations', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setConversations(previous => [result.conversation, ...previous])
      setPanel(null); setActiveId(result.conversation.id); setPasskey(null); setShowPasskeyDialog(true)
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not create group', 'error') }
  }

  async function unlockChat() {
    if (!activeId || !/^[0-9]{4,12}$/.test(personalPinEntry)) { setPasskeyError('Enter your personal 4–12 digit PIN.'); return }
    try {
      const result = await apiRequest('/api/auth/chat-pin', { method: 'POST', body: JSON.stringify({ action: 'unlock', pin: personalPinEntry, conversationId: activeId }) })
      if (typeof result.key !== 'string') throw new Error('Could not unlock this chat.')
      setPasskey(result.key); setPersonalPinEntry(''); setPasskeyError(''); setShowPasskeyDialog(false)
    } catch (error) { setPasskeyError(error instanceof Error ? error.message : 'Incorrect PIN.') }
  }

  async function sendMessage() {
    if (!input.trim() || !activeId || !user || !passkey || sending) return
    setSending(true)
    try {
      const encrypted = await encryptWithConversationKey(passkey, input.trim())
      await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`, { method: 'POST', body: JSON.stringify(encrypted) })
      setInput('')
      const result = await apiRequest(`/api/messages?conversation_id=${encodeURIComponent(activeId)}`)
      const visible: VisibleMessage[] = []
      for (const m of result.messages ?? []) {
        try { visible.push({ ...m, plaintext: await decryptWithConversationKey(passkey, m.ciphertext, m.iv), locked: false }) }
        catch { visible.push({ ...m, locked: true, decryptError: true }) }
      }
      setMessages(visible)
      await loadConversations()
    } catch (error) { notify(error instanceof Error ? error.message : 'Message could not be sent', 'error') }
    finally { setSending(false) }
  }

  const nameOf = (c: ConvWithMeta) => c.type === 'group' ? (c.name || 'Group') : (c.otherProfile?.display_name || c.otherProfile?.username || 'Direct chat')
  const isOnline = (c: ConvWithMeta) => Boolean(c.otherProfile && onlineIds.has(c.otherProfile.id))
  const ringFor = (userId?: string) => {
    const group = userId ? groupByUser.get(userId) : undefined
    return group ? (group.allSeen ? 'seen' as const : 'new' as const) : 'none' as const
  }

  const tabButtons: { tab: Tab; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { tab: 'chats', label: 'Chats', icon: MessageCircle },
    { tab: 'stories', label: 'Stories', icon: CircleDot },
    { tab: 'requests', label: 'Requests', icon: Bell, badge: incomingCount },
  ]
  const inputClass = 'w-full rounded-2xl bg-[#F3F4F7] px-4 py-3.5 text-sm font-medium outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-200'

  // ---- Screens ----
  const listHeader = (
    <header className="safe-top flex items-center justify-between px-5 pb-2 pt-5 md:pt-6">
      <h1 className="text-[28px] font-extrabold tracking-tight">{TAB_TITLES[activeTab]}</h1>
      <div className="flex items-center gap-1">
        {activeTab === 'chats' && <button type="button" onClick={() => void createGroup()} aria-label="New group" title="New group" className="grid h-10 w-10 place-items-center rounded-full text-slate-600 transition hover:bg-slate-100"><Users className="h-5 w-5" /></button>}
        {activeTab === 'stories' && <button type="button" onClick={() => setComposerOpen(true)} aria-label="Add story" title="Add story" className="brand-gradient grid h-10 w-10 place-items-center rounded-full text-white shadow-md shadow-violet-200"><Plus className="h-5 w-5" /></button>}
      </div>
    </header>
  )

  const searchBox = (
    <div className="px-5 pb-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className={`${inputClass} pl-11`} placeholder="Search people to connect" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search people" />
      </div>
      {search.trim().length >= 2 && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg">
          {searchResults.length ? searchResults.map(p => (
            <button key={p.id} type="button" onClick={() => void sendConnectionRequest(p)} disabled={creatingChat} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50 disabled:opacity-50">
              <Avatar name={p.display_name || p.username} src={p.avatar_url} size={40} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{p.display_name}</span><span className="block truncate text-xs text-slate-400">@{p.username} · Send request</span></span>
              <Plus className="h-4 w-4 text-violet-600" />
            </button>
          )) : <p className="p-4 text-xs text-slate-400">No matching users found.</p>}
        </div>
      )}
    </div>
  )

  const storyStrip = (
    <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-4 pt-1">
      <div className="flex w-[64px] shrink-0 flex-col items-center gap-1.5">
        <Avatar
          name={profile?.display_name ?? 'You'} src={profile?.avatar} size={64} ring={myGroup ? (myGroup.allSeen ? 'seen' : 'new') : 'none'}
          onClick={onMyStoryTap} label="Your story"
          badge={<span role="button" tabIndex={0} aria-label="Add story" onClick={e => { e.stopPropagation(); setComposerOpen(true) }} onKeyDown={e => { if (e.key === 'Enter') setComposerOpen(true) }} className="brand-gradient absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white text-white"><Plus className="h-3.5 w-3.5" /></span>}
        />
        <span className="w-full truncate text-center text-[11px] font-semibold text-slate-500">Your story</span>
      </div>
      {friendGroups.map(group => (
        <div key={group.userId} className="flex w-[64px] shrink-0 flex-col items-center gap-1.5">
          <Avatar name={group.author.display_name} src={group.author.avatar} size={64} ring={group.allSeen ? 'seen' : 'new'} onClick={() => openStoryGroup(group.userId)} />
          <span className="w-full truncate text-center text-[11px] font-semibold text-slate-500">{group.author.display_name}</span>
        </div>
      ))}
    </div>
  )

  const chatsList = (
    <>
      {searchBox}
      {storyStrip}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visibleConversations.length === 0 && (
          <div className="px-8 py-14 text-center">
            <div className="brand-gradient mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl text-white"><MessageCircle className="h-7 w-7" /></div>
            <p className="text-base font-extrabold">No chats yet</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">Search a username above to connect and start a private chat.</p>
          </div>
        )}
        {visibleConversations.map(c => {
          const name = nameOf(c)
          const selected = activeId === c.id
          return (
            <button key={c.id} type="button" onClick={() => openConversation(c.id)} className={`flex w-full items-center gap-3.5 rounded-2xl px-3 py-3 text-left transition ${selected ? 'bg-[#F3F1FF]' : 'hover:bg-slate-50 active:bg-slate-100'}`}>
              <Avatar name={name} src={c.otherProfile?.avatar_url} size={54} ring={c.type === 'direct' ? ringFor(c.otherProfile?.id) : 'none'} online={isOnline(c)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2"><span className="truncate text-[15px] font-bold">{name}</span><span className="shrink-0 text-[11px] text-slate-400">{c.lastMessage ? ago(c.lastMessage.created_at) : ''}</span></span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-400"><Lock className="h-3 w-3 shrink-0" /><span className="truncate">Private message</span></span>
              </span>
            </button>
          )
        })}
      </div>
    </>
  )

  const storiesList = (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      <button type="button" onClick={onMyStoryTap} className="flex w-full items-center gap-3.5 rounded-2xl px-2 py-3 text-left transition hover:bg-slate-50">
        <Avatar name={profile?.display_name ?? 'You'} src={profile?.avatar} size={58} ring={myGroup ? (myGroup.allSeen ? 'seen' : 'new') : 'none'} badge={myGroup ? undefined : <span className="brand-gradient absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white text-white"><Plus className="h-3.5 w-3.5" /></span>} />
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">My story</span><span className="block text-[13px] text-slate-400">{myGroup ? `${myGroup.stories.length} active · tap to view` : 'Share a moment for 24 hours'}</span></span>
      </button>
      {[{ title: 'Recent updates', items: friendGroups.filter(g => !g.allSeen) }, { title: 'Viewed', items: friendGroups.filter(g => g.allSeen) }].map(section => section.items.length ? (
        <div key={section.title} className="mt-3">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[.14em] text-slate-400">{section.title}</p>
          {section.items.map(group => (
            <button key={group.userId} type="button" onClick={() => openStoryGroup(group.userId)} className="flex w-full items-center gap-3.5 rounded-2xl px-2 py-2.5 text-left transition hover:bg-slate-50">
              <Avatar name={group.author.display_name} src={group.author.avatar} size={54} ring={group.allSeen ? 'seen' : 'new'} />
              <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-bold">{group.author.display_name}</span><span className="block text-[13px] text-slate-400">{ago(group.stories[group.stories.length - 1].created_at)} ago</span></span>
            </button>
          ))}
        </div>
      ) : null)}
      {friendGroups.length === 0 && <p className="px-6 py-10 text-center text-sm leading-6 text-slate-400">When your connections share a story, it appears here. Stories disappear after 24 hours.</p>}
    </div>
  )

  const requestsList = (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      {requests.length === 0 && (
        <div className="px-6 py-14 text-center"><div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-3xl bg-slate-100 text-slate-400"><Users className="h-6 w-6" /></div><p className="text-base font-extrabold">All caught up</p><p className="mt-1 text-sm text-slate-400">New connection requests will appear here.</p></div>
      )}
      <div className="space-y-2.5">
        {requests.map(request => (
          <div key={request.id} className="rounded-3xl bg-[#F8F8FB] p-4">
            <div className="flex items-center gap-3">
              <Avatar name={request.other_display_name || request.other_username} src={request.other_avatar} size={48} />
              <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-bold">{request.other_display_name || request.other_username}</p><p className="truncate text-xs text-slate-400">@{request.other_username} · {request.direction === 'incoming' ? 'wants to connect' : 'waiting for reply'}</p></div>
            </div>
            <div className="mt-3 flex gap-2">
              {request.direction === 'incoming' ? (
                <><button type="button" onClick={() => void respondToRequest(request, 'accept')} className="brand-gradient flex-1 rounded-2xl py-2.5 text-sm font-extrabold text-white">Accept</button><button type="button" onClick={() => void respondToRequest(request, 'decline')} className="rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-slate-600">Decline</button></>
              ) : <button type="button" onClick={() => void respondToRequest(request, 'cancel')} className="rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-slate-600">Cancel request</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const bottomBar = (
    <nav className="safe-bottom flex shrink-0 items-center justify-around border-t border-slate-100 bg-white/95 px-2 pt-1.5 backdrop-blur md:hidden" aria-label="Main">
      {tabButtons.map(({ tab, label, icon: Icon, badge }) => {
        const active = activeTab === tab && panel === null
        return (
          <button key={tab} type="button" onClick={() => selectTab(tab)} className={`relative flex min-w-[64px] flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 text-[11px] font-bold transition ${active ? 'text-violet-600' : 'text-slate-400'}`}>
            <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />{label}
            {badge ? <span className="absolute right-3 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-pink-500 px-1 text-[9px] font-extrabold text-white">{badge}</span> : null}
          </button>
        )
      })}
      <button type="button" onClick={openProfile} className={`flex min-w-[64px] flex-col items-center gap-0.5 rounded-2xl px-3 py-1.5 text-[11px] font-bold ${panel ? 'text-violet-600' : 'text-slate-400'}`}>
        <Avatar name={profile?.display_name ?? 'Me'} src={profile?.avatar} size={24} />Me
      </button>
    </nav>
  )

  const pinSetup = (
    <section className="flex flex-1 flex-col overflow-y-auto bg-white">
      <div className="safe-top mx-auto w-full max-w-[460px] px-5 pb-10 pt-4">
        <button type="button" onClick={() => setPanel('profile')} className="mb-2 flex items-center gap-2 rounded-xl py-2 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Back</button>
        <div className="brand-gradient mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white"><ShieldCheck className="h-7 w-7" /></div>
        <h1 className="text-3xl font-extrabold tracking-tight">Chat PIN</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">This PIN belongs only to your account. Use it to unlock your private chats. You can pick a different PIN from the people you chat with.</p>
        <form onSubmit={savePersonalPin} className="mt-6 space-y-4">
          <div><label htmlFor="setup-pin" className="mb-1.5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">New PIN</label>
            <input id="setup-pin" required type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={12} value={setupPin} onChange={e => setSetupPin(e.target.value.replace(/\D/g, ''))} placeholder="4–12 digits" className={`pin-mask ${inputClass}`} /></div>
          <div><label htmlFor="setup-pin2" className="mb-1.5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Confirm PIN</label>
            <input id="setup-pin2" required type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={12} value={setupPinConfirm} onChange={e => setSetupPinConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Re-enter your PIN" className={`pin-mask ${inputClass}`} /></div>
          <div><label htmlFor="setup-answer" className="mb-1.5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">What was the name of your first school?</label>
            <input id="setup-answer" required type="text" autoComplete="off" value={setupSecurityAnswer} onChange={e => setSetupSecurityAnswer(e.target.value)} placeholder="Your security answer" className={inputClass} /></div>
          {setupPinError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">{setupPinError}</p>}
          <button type="submit" disabled={savingPin} className="brand-gradient w-full rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg shadow-violet-200 disabled:opacity-50">{savingPin ? 'Saving…' : 'Save PIN'}</button>
        </form>
        <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">Your PIN is stored as a one-way hash and never shown again.</p>
      </div>
    </section>
  )

  const emptyMain = (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="brand-gradient mx-auto mb-6 grid h-20 w-20 place-items-center rounded-[28px] text-white shadow-xl shadow-violet-200"><MessageCircle className="h-9 w-9" /></div>
        <h2 className="text-3xl font-extrabold leading-tight tracking-tight">Good conversations.<br />Better boundaries.</h2>
        <p className="mt-3 text-sm leading-6 text-slate-400">Pick a chat, or find someone new. Your messages stay hidden until you unlock them with your PIN.</p>
      </div>
    </div>
  )

  const chatView = activeConv && (
    <>
      <header className="safe-top flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white px-3 pb-3 pt-3 md:px-6">
        <button type="button" onClick={leaveConversation} aria-label="Back to chats" className="grid h-10 w-10 place-items-center rounded-full text-slate-700 transition hover:bg-slate-100 md:hidden"><ArrowLeft className="h-5 w-5" /></button>
        <Avatar name={nameOf(activeConv)} src={activeConv.otherProfile?.avatar_url} size={44} ring={activeConv.type === 'direct' ? ringFor(activeConv.otherProfile?.id) : 'none'} online={isOnline(activeConv)} onClick={activeConv.type === 'direct' && activeConv.otherProfile && groupByUser.has(activeConv.otherProfile.id) ? () => openStoryGroup(activeConv.otherProfile!.id) : undefined} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold">{nameOf(activeConv)}</p>
          <p className="truncate text-xs text-slate-400">{isUnlocked ? 'Unlocked' : isOnline(activeConv) ? 'Online' : 'Private conversation'}</p>
        </div>
        <button type="button" onClick={() => (isUnlocked ? lockChat() : setShowPasskeyDialog(true))} className={`flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-extrabold transition ${isUnlocked ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F3F1FF] text-violet-700 hover:bg-violet-100'}`}>
          {isUnlocked ? <ShieldCheck className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{isUnlocked ? 'Unlocked' : 'Unlock'}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain bg-[#FAFAFC] px-4 py-5 md:px-8">
        <div className="mx-auto mb-2 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-semibold text-slate-400 shadow-sm"><Lock className="h-3 w-3 text-violet-500" />{isUnlocked ? 'Messages are readable only while unlocked' : 'Messages are hidden until you unlock'}</div>
        {messages.map(m => {
          const mine = m.sender_id === user?.id
          return (
            <div key={m.id} className={`message-enter flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-[22px] px-4 py-2.5 md:max-w-[62%] ${mine ? 'brand-gradient rounded-br-md text-white' : 'rounded-bl-md bg-white text-slate-800 shadow-sm'}`}>
                <p className={`whitespace-pre-wrap break-words text-[15px] leading-6 ${m.plaintext === undefined ? 'tracking-[.2em] opacity-80' : ''}`}>
                  {m.plaintext ?? (m.decryptError ? 'Older message — cannot be shown' : '✦ ✦ ✦ ✦ ✦ ✦')}
                </p>
                <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{ago(m.created_at)}</p>
              </div>
            </div>
          )
        })}
        {messages.length === 0 && <div className="m-auto text-center"><LockKeyhole className="mx-auto h-8 w-8 text-violet-400" /><p className="mt-3 text-sm font-bold text-slate-600">Your private room</p><p className="mt-1 text-xs text-slate-400">Say hello after you unlock.</p></div>}
        <div ref={bottomRef} />
      </div>

      <div className="safe-bottom shrink-0 border-t border-slate-100 bg-white px-3 pt-3 md:px-6">
        {!isUnlocked ? (
          showPasskeyDialog ? (
            <form onSubmit={e => { e.preventDefault(); void unlockChat() }} className="mx-auto max-w-lg space-y-2 pb-3">
              <p className="text-center text-sm font-extrabold">Enter your PIN</p>
              <input autoFocus type="text" inputMode="numeric" autoComplete="off" data-lpignore="true" data-1p-ignore="true" maxLength={12} value={personalPinEntry} onChange={e => setPersonalPinEntry(e.target.value.replace(/\D/g, ''))} placeholder="Your personal PIN" aria-label="Personal PIN" className={`pin-mask ${inputClass} text-center ${personalPinEntry ? 'tracking-[.3em]' : ''}`} />
              {passkeyError && <p role="alert" className="text-center text-xs font-medium text-rose-600">{passkeyError}</p>}
              <div className="flex gap-2"><button type="button" onClick={() => { setShowPasskeyDialog(false); setPersonalPinEntry(''); setPasskeyError('') }} className="flex-1 rounded-2xl bg-[#F3F4F7] py-3 text-sm font-bold text-slate-600">Cancel</button><button type="submit" className="brand-gradient flex-1 rounded-2xl py-3 text-sm font-extrabold text-white">Unlock</button></div>
            </form>
          ) : (
            <div className="pb-3"><button type="button" onClick={() => setShowPasskeyDialog(true)} className="brand-gradient mx-auto flex w-full max-w-lg items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg shadow-violet-200"><LockKeyhole className="h-4 w-4" /> Enter PIN to read messages</button></div>
          )
        ) : (
          <form className="mx-auto flex max-w-4xl items-center gap-2 pb-3" onSubmit={e => { e.preventDefault(); void sendMessage() }}>
            <input className="min-w-0 flex-1 rounded-full bg-[#F3F4F7] px-5 py-3.5 text-[15px] outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-200" placeholder="Message…" value={input} onChange={e => setInput(e.target.value)} disabled={sending} aria-label="Message" />
            <button type="submit" disabled={sending || !input.trim()} aria-label="Send" className="brand-gradient grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-md shadow-violet-200 transition active:scale-95 disabled:opacity-40"><Send className="h-5 w-5" /></button>
          </form>
        )}
      </div>
    </>
  )

  return (
    <div className="h-[100dvh] w-full bg-white md:bg-[#F1F2F6] md:p-4">
      <div className="mx-auto flex h-full max-w-[1480px] overflow-hidden bg-white md:rounded-[28px] md:shadow-[0_30px_80px_rgba(20,22,40,.12)]">
        {/* Desktop rail */}
        <nav className="hidden w-[76px] shrink-0 flex-col items-center border-r border-slate-100 py-5 md:flex" aria-label="Main">
          <div className="brand-gradient grid h-11 w-11 place-items-center rounded-2xl text-white shadow-md shadow-violet-200" title="NEWGEN"><MessageCircle className="h-5 w-5" /></div>
          <div className="mt-8 flex flex-col gap-2">
            {tabButtons.map(({ tab, label, icon: Icon, badge }) => {
              const active = activeTab === tab && panel === null
              return (
                <button key={tab} type="button" onClick={() => selectTab(tab)} title={label} aria-label={label} className={`relative grid h-12 w-12 place-items-center rounded-2xl transition ${active ? 'bg-[#F3F1FF] text-violet-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} />
                  {badge ? <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-pink-500 px-1 text-[9px] font-extrabold text-white">{badge}</span> : null}
                </button>
              )
            })}
          </div>
          <div className="mt-auto"><Avatar name={profile?.display_name ?? 'Me'} src={profile?.avatar} size={44} ring={myGroup ? (myGroup.allSeen ? 'seen' : 'new') : 'none'} onClick={openProfile} label="Profile" /></div>
        </nav>

        <aside className={`${mainOnMobile ? 'hidden md:flex' : 'flex'} min-h-0 w-full flex-col md:w-[372px] md:shrink-0 md:border-r md:border-slate-100`}>
          {listHeader}
          {activeTab === 'chats' ? chatsList : activeTab === 'stories' ? storiesList : requestsList}
          {bottomBar}
        </aside>

        <main className={`${mainOnMobile ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
          {panel === 'pin' ? pinSetup : panel === 'profile' ? <ProfilePanel onBack={() => setPanel(null)} onOpenPin={openPinSetup} /> : activeConv ? chatView : emptyMain}
        </main>
      </div>

      {composerOpen && <StoryComposer onClose={() => setComposerOpen(false)} onPosted={() => { notify('Story shared'); void loadStories() }} />}
      {viewerStart !== null && user && (
        <StoryViewer groups={storyGroups} startIndex={viewerStart} meId={user.id} onClose={() => setViewerStart(null)} onSeen={markSeen} onDeleted={() => void loadStories()} />
      )}
      {notice && <div role="status" className={`toast-enter fixed left-1/2 top-4 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full px-5 py-3 text-sm font-bold shadow-xl ${notice.kind === 'ok' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>{notice.text}</div>}
    </div>
  )
}

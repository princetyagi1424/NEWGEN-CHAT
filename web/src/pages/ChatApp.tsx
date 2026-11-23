import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { LogOut, MessageCircle, Search, Send, Users, Circle } from 'lucide-react'
import { getAuthToken, useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { encryptAesGcm, decryptAesGcmToString, generateConversationKey, exportAesKey, importAesKey } from '../crypto/keys'
import { getConversationKeyB64, storeConversationKey } from '../lib/localStore'
import type { Conversation, Message, Profile } from '../types/database'

type ConvWithMeta = Conversation & { members?: { user_id: string; role: string }[]; otherProfile?: Profile | null; lastMessage?: Message | null }
type DecryptedMessage = Message & { plaintext?: string; decryptError?: boolean }

export default function ChatApp() {
  const { user, profile, signOut } = useAuth()
  const [conversations, setConversations] = useState<ConvWithMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DecryptedMessage[]>([])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [sending, setSending] = useState(false)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const activeConv = useMemo(() => conversations.find((c) => c.id === activeId) ?? null, [conversations, activeId])

  const loadConversations = useCallback(async () => {
    if (!user) return
    const { data: memberships } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id)
    const ids = (memberships ?? []).map((m) => m.conversation_id)
    if (!ids.length) { setConversations([]); return }
    const { data: convs } = await supabase.from('conversations').select('*').in('id', ids).order('updated_at', { ascending: false })
    const enriched: ConvWithMeta[] = []
    for (const c of convs ?? []) {
      const { data: members } = await supabase.from('conversation_members').select('user_id, role').eq('conversation_id', c.id)
      let otherProfile: Profile | null = null
      if (c.type === 'direct') {
        const otherId = (members ?? []).find((m) => m.user_id !== user.id)?.user_id
        if (otherId) {
          const { data: p } = await supabase.from('profiles').select('*').eq('id', otherId).maybeSingle()
          otherProfile = p as Profile | null
        }
      }
      const { data: lastMsgs } = await supabase.from('messages').select('*').eq('conversation_id', c.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1)
      enriched.push({ ...c, members: members ?? [], otherProfile, lastMessage: lastMsgs?.[0] ?? null })
    }
    setConversations(enriched)
  }, [user])

  useEffect(() => { loadConversations() }, [loadConversations])

  useEffect(() => {
    if (!user) return
    const channel = supabase.channel('online-users', { config: { presence: { key: user.id } } })
    channel.on('presence', { event: 'sync' }, () => setOnlineIds(new Set(Object.keys(channel.presenceState()))))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ user_id: user.id, username: profile?.username, online_at: new Date().toISOString() })
      })
    return () => { supabase.removeChannel(channel) }
  }, [user, profile?.username])

  useEffect(() => {
    if (!activeId || !user) { setMessages([]); return }
    let cancelled = false
    async function loadAndDecrypt() {
      const { data } = await supabase.from('messages').select('*').eq('conversation_id', activeId!).is('deleted_at', null).order('created_at', { ascending: true }).limit(200)
      const keyB64 = await getConversationKeyB64(activeId!)
      let key: CryptoKey | null = null
      if (keyB64) { try { key = await importAesKey(keyB64) } catch { /* */ } }
      const decrypted: DecryptedMessage[] = []
      for (const m of data ?? []) {
        if (!key) { decrypted.push({ ...m, plaintext: '[Encrypted — key not available]', decryptError: true }); continue }
        try { decrypted.push({ ...m, plaintext: await decryptAesGcmToString(key, m.ciphertext, m.iv) }) }
        catch { decrypted.push({ ...m, plaintext: '[Unable to decrypt]', decryptError: true }) }
      }
      if (!cancelled) setMessages(decrypted)
    }
    loadAndDecrypt()
    const channel = supabase.channel(`messages:${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` }, async (payload) => {
        const m = payload.new as Message
        const keyB64 = await getConversationKeyB64(activeId!)
        let plaintext = '[Encrypted]'; let decryptError = true
        if (keyB64) { try { const key = await importAesKey(keyB64); plaintext = await decryptAesGcmToString(key, m.ciphertext, m.iv); decryptError = false } catch { /* */ } }
        setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, plaintext, decryptError }])
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.user_id === user.id) return
        setTypingUsers((prev) => prev.includes(payload.username) ? prev : [...prev, payload.username])
        setTimeout(() => setTypingUsers((prev) => prev.filter((u) => u !== payload.username)), 2500)
      })
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [activeId, user])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typingUsers])

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

  async function startDirectChat(other: Profile) {
    if (!user) return
    const { data: myMemberships } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', user.id)
    const myConvIds = (myMemberships ?? []).map((m) => m.conversation_id)
    if (myConvIds.length) {
      const { data: shared } = await supabase.from('conversation_members').select('conversation_id').eq('user_id', other.id).in('conversation_id', myConvIds)
      if (shared?.length) {
        const { data: conv } = await supabase.from('conversations').select('*').eq('id', shared[0].conversation_id).eq('type', 'direct').maybeSingle()
        if (conv) { setActiveId(conv.id); setSearch(''); setSearchResults([]); return }
      }
    }
    const convKey = await generateConversationKey()
    const keyB64 = await exportAesKey(convKey)
    const { data: conv, error } = await supabase.from('conversations').insert({ type: 'direct', created_by: user.id }).select().single()
    if (error || !conv) return
    await supabase.from('conversation_members').insert([
      { conversation_id: conv.id, user_id: user.id, role: 'owner', encrypted_conversation_key: keyB64 },
      { conversation_id: conv.id, user_id: other.id, role: 'member', encrypted_conversation_key: keyB64 },
    ])
    await storeConversationKey(conv.id, keyB64)
    await loadConversations()
    setActiveId(conv.id)
    setSearch('')
    setSearchResults([])
  }

  async function createGroup() {
    if (!user) return
    const name = window.prompt('Group name')
    if (!name?.trim()) return
    const convKey = await generateConversationKey()
    const keyB64 = await exportAesKey(convKey)
    const { data: conv, error } = await supabase.from('conversations').insert({ type: 'group', name: name.trim(), created_by: user.id }).select().single()
    if (error || !conv) return
    await supabase.from('conversation_members').insert({ conversation_id: conv.id, user_id: user.id, role: 'owner', encrypted_conversation_key: keyB64 })
    await storeConversationKey(conv.id, keyB64)
    await loadConversations()
    setActiveId(conv.id)
  }

  async function sendMessage() {
    if (!input.trim() || !activeId || !user || sending) return
    setSending(true)
    try {
      let keyB64 = await getConversationKeyB64(activeId)
      if (!keyB64) {
        const { data: mem } = await supabase.from('conversation_members').select('encrypted_conversation_key').eq('conversation_id', activeId).eq('user_id', user.id).maybeSingle()
        if (mem?.encrypted_conversation_key) { keyB64 = mem.encrypted_conversation_key; await storeConversationKey(activeId, keyB64) }
      }
      if (!keyB64) { alert('No conversation key on this device.'); return }
      const key = await importAesKey(keyB64)
      const { ciphertext, iv } = await encryptAesGcm(key, input.trim())
      const { error } = await supabase.from('messages').insert({ conversation_id: activeId, sender_id: user.id, ciphertext, iv, content_type: 'text' })
      if (error) { alert(error.message); return }
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', activeId)
      setInput('')
    } finally { setSending(false) }
  }

  const displayName = (c: ConvWithMeta) => c.type === 'group' ? (c.name || 'Group') : (c.otherProfile?.display_name || c.otherProfile?.username || 'Direct chat')

  return (
    <div className="h-[100dvh] w-full flex overflow-hidden bg-[var(--bg)]">
      <aside className={`${activeId ? 'hidden md:flex' : 'flex'} w-full md:w-80 md:max-w-xs shrink-0 border-r border-[var(--border)] flex-col bg-[var(--panel)] min-h-0`}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold"><MessageCircle className="w-5 h-5 text-[var(--accent)]" /> NEWGEN</div>
          <div className="flex gap-1">
            <button type="button" onClick={createGroup} className="p-2 rounded-lg hover:bg-[var(--panel-2)] text-[var(--muted)]" title="New group"><Users className="w-4 h-4" /></button>
            <button type="button" onClick={() => signOut()} className="p-2 rounded-lg hover:bg-[var(--panel-2)] text-[var(--muted)]" title="Sign out"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-3 border-b border-[var(--border)]">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--panel-2)] border border-[var(--border)] text-sm outline-none focus:border-[var(--accent)]" placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
              {searchResults.map((p) => (
                <button key={p.id} type="button" onClick={() => startDirectChat(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--border)] flex items-center gap-2">
                  <Circle className={`w-2 h-2 ${onlineIds.has(p.id) ? 'fill-[var(--success)] text-[var(--success)]' : 'fill-[var(--muted)] text-[var(--muted)]'}`} />
                  <span>@{p.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && <p className="p-4 text-sm text-[var(--muted)]">Search for a user to start chatting.</p>}
          {conversations.map((c) => (
            <button key={c.id} type="button" onClick={() => setActiveId(c.id)} className={`w-full text-left px-4 py-3 border-b border-[var(--border)]/50 hover:bg-[var(--panel-2)] ${activeId === c.id ? 'bg-[var(--panel-2)]' : ''}`}>
              <div className="font-medium text-sm truncate">{displayName(c)}</div>
              <div className="text-xs text-[var(--muted)] mt-0.5">{c.lastMessage ? formatDistanceToNow(new Date(c.lastMessage.created_at), { addSuffix: true }) : 'No messages'}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--border)] text-xs text-[var(--muted)] truncate">@{profile?.username ?? '…'}</div>
      </aside>
      <main className={`${activeId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0 min-h-0 overflow-hidden`}>
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-[var(--muted)]">
            <div className="text-center"><MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-40" /><p>Select or start a conversation</p><Link to="/" className="text-sm text-[var(--accent)] mt-2 inline-block">Home</Link></div>
          </div>
        ) : (
          <>
            <header className="h-14 shrink-0 border-b border-[var(--border)] px-3 md:px-4 flex items-center gap-3 bg-[var(--panel)]">
              <button type="button" onClick={() => setActiveId(null)} className="md:hidden p-2 -ml-1 rounded-lg hover:bg-[var(--panel-2)]" aria-label="Back to chats">
                <span className="text-xl leading-none">‹</span>
              </button>
              <div className="min-w-0 flex-1 font-medium truncate">{displayName(activeConv)}</div>
              <span className="text-xs text-[var(--muted)]">NEWGEN CHAT</span>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 md:p-4 space-y-3">
              {messages.map((m) => {
                const mine = m.sender_id === user?.id
                return (
                  <div key={m.id} className={`message-enter flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3.5 py-2 rounded-2xl text-sm ${mine ? 'bg-[var(--accent)] text-white rounded-br-md' : 'bg-[var(--panel-2)] border border-[var(--border)] rounded-bl-md'} ${m.decryptError ? 'opacity-70 italic' : ''}`}>
                      {m.plaintext}
                      <div className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-[var(--muted)]'}`}>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</div>
                    </div>
                  </div>
                )
              })}
              {typingUsers.length > 0 && <div className="text-xs text-[var(--muted)]">{typingUsers.join(', ')} typing…</div>}
              <div ref={bottomRef} />
            </div>
            <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[var(--border)] bg-[var(--panel)]">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); sendMessage() }}>
                <input className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--panel-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)] text-sm" placeholder="Encrypted message…" value={input} onChange={(e) => setInput(e.target.value)} disabled={sending} />
                <button type="submit" disabled={sending || !input.trim()} className="px-4 py-2.5 rounded-xl bg-[var(--accent)] disabled:opacity-50 text-white"><Send className="w-4 h-4" /></button>
              </form>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

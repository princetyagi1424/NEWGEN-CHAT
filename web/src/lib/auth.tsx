import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from './supabase'
import { getOrCreateDeviceIdentity } from './localStore'
import type { Profile } from '../types/database'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  configured: boolean
  signUp: (username: string, password: string) => Promise<{ error: string | null }>
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// Supabase Auth requires an email-shaped identifier. This reserved, non-deliverable
// address is generated internally; users never provide or need an email address.
function usernameAuthId(username: string) {
  return `${username.trim().toLowerCase()}@accounts.newgenchat.com`
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

function validUsername(username: string) {
  return /^[a-z0-9_]{3,24}$/.test(username)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const configured = isSupabaseConfigured()

  const loadProfile = useCallback(async (uid: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (!error && data) setProfile(data as Profile)
    else setProfile(null)
  }, [])

  useEffect(() => {
    if (!configured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      if (data.session?.user) {
        loadProfile(data.session.user.id).finally(() => setLoading(false))
        getOrCreateDeviceIdentity().then(async (device) => {
          await supabase.from('devices').upsert({
            id: device.id,
            user_id: data.session!.user.id,
            device_name: device.deviceName,
            public_key: device.publicKeyB64,
            last_seen_at: new Date().toISOString(),
          }, { onConflict: 'id' })
        }).catch(console.error)
      } else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) loadProfile(s.user.id)
      else setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [configured, loadProfile])

  const signUp = useCallback(async (username: string, password: string) => {
    if (!configured) return { error: 'Supabase is not configured.' }
    const cleanUser = normalizeUsername(username)
    if (!validUsername(cleanUser)) return { error: 'Username must be 3–24 characters and contain only letters, numbers, or underscores.' }
    if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

    const { data, error } = await supabase.auth.signUp({
      email: usernameAuthId(cleanUser),
      password,
      options: { data: { username: cleanUser } },
    })
    if (error) {
      if (/already registered|already been registered|user already/i.test(error.message)) {
        return { error: 'This username is already taken. Please choose another one.' }
      }
      return { error: error.message }
    }
    if (!data.user) return { error: 'Account creation failed. Please try again.' }
    if (!data.session) {
      return { error: 'Instant signup is not enabled yet. Disable email confirmation in Supabase Authentication settings, then try again.' }
    }

    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      username: cleanUser,
      display_name: username.trim(),
    })
    if (profileError) {
      await supabase.auth.signOut()
      return { error: profileError.code === '23505' ? 'This username is already taken.' : 'Could not create your profile. Please try again.' }
    }

    await loadProfile(data.user.id)

    try {
      const device = await getOrCreateDeviceIdentity()
      await supabase.from('devices').upsert({
        id: device.id,
        user_id: data.user.id,
        device_name: device.deviceName,
        public_key: device.publicKeyB64,
        last_seen_at: new Date().toISOString(),
      })
    } catch (e) { console.error(e) }
    return { error: null }
  }, [configured, loadProfile])

  const signIn = useCallback(async (username: string, password: string) => {
    if (!configured) return { error: 'Supabase is not configured.' }
    const cleanUser = normalizeUsername(username)
    if (!validUsername(cleanUser)) return { error: 'Enter a valid username.' }

    const { error } = await supabase.auth.signInWithPassword({
      email: usernameAuthId(cleanUser),
      password,
    })
    if (error) {
      return { error: 'Incorrect username or password.' }
    }
    try {
      const device = await getOrCreateDeviceIdentity()
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (currentUser) await supabase.from('devices').upsert({
        id: device.id,
        user_id: currentUser.id,
        device_name: device.deviceName,
        public_key: device.publicKeyB64,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'id' })
    } catch (e) { console.error(e) }
    return { error: null }
  }, [configured])

  const signOut = useCallback(async () => { await supabase.auth.signOut(); setProfile(null) }, [])
  const refreshProfile = useCallback(async () => { if (user) await loadProfile(user.id) }, [user, loadProfile])

  const value = useMemo(() => ({ session, user, profile, loading, configured, signUp, signIn, signOut, refreshProfile }), [session, user, profile, loading, configured, signUp, signIn, signOut, refreshProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

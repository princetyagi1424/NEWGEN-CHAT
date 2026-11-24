import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearLocalData, getOrCreateDeviceIdentity } from './localStore'

export interface AppUser {
  id: string
  username: string
}
export interface AppProfile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
}
interface AuthState {
  user: AppUser | null
  profile: AppProfile | null
  loading: boolean
  configured: boolean
  signUp: (username: string, password: string, securityAnswer: string) => Promise<{ error: string | null }>
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  signOutAll: () => Promise<void>
  refreshProfile: () => Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)
const API_URL = (((import.meta as any).env?.VITE_API_URL as string | undefined) || '').replace(/\/$/, '')
const TOKEN_KEY = 'newgen_access_token'
const USER_KEY = 'newgen_user'

async function authRequest(path: string, body: unknown) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Authentication failed. Please try again.')
  return data
}

function readSavedUser(): AppUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as AppUser : null
  } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const configured = true

  useEffect(() => {
    // Remove credentials written by earlier builds; tokens now remain tab-scoped.
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    const token = sessionStorage.getItem(TOKEN_KEY)
    const saved = readSavedUser()
    if (!token || !saved) {
      setLoading(false)
      return
    }
    fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) throw new Error('Session expired')
        const data = await response.json()
        setUser(data.user)
        sessionStorage.setItem(USER_KEY, JSON.stringify(data.user))
      })
      .catch(() => {
        sessionStorage.removeItem(TOKEN_KEY)
        sessionStorage.removeItem(USER_KEY)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const signUp = useCallback(async (username: string, password: string, securityAnswer: string) => {
    try {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) throw new Error('Username must be 3–24 letters, numbers, or underscores.')
      if (password.length < 10) throw new Error('Password must be at least 10 characters.')
      const data = await authRequest('/api/auth/register', { username: username.trim(), password, securityAnswer })
      const nextUser = data.user as AppUser
      sessionStorage.setItem(TOKEN_KEY, data.token)
      sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser))
      setUser(nextUser)
      // Register this browser's device identity locally; server-side device-key
      // registration will be connected with the account security workflow.
      await getOrCreateDeviceIdentity().catch(() => null)
      return { error: null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not create account.' }
    }
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const data = await authRequest('/api/auth/login', { username: username.trim(), password })
      const nextUser = data.user as AppUser
      sessionStorage.setItem(TOKEN_KEY, data.token)
      sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser))
      setUser(nextUser)
      await getOrCreateDeviceIdentity().catch(() => null)
      return { error: null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not sign in.' }
    }
  }, [])

  const signOut = useCallback(async () => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    if (token) {
      // Best-effort server revocation; local sign-out must still complete offline.
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => undefined)
    }
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    await clearLocalData().catch(() => undefined)
    setUser(null)
    setProfile(null)
  }, [])
  const signOutAll = useCallback(async () => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    try {
      if (token) {
        const response = await fetch(`${API_URL}/api/auth/logout-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || 'Could not revoke all sessions.')
        }
      }
    } finally {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(USER_KEY)
      await clearLocalData().catch(() => undefined)
      setUser(null)
      setProfile(null)
    }
  }, [])
  const refreshProfile = useCallback(async () => {
    const token = sessionStorage.getItem(TOKEN_KEY)
    if (!token) { setProfile(null); return }
    try {
      const response = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not load profile')
      setProfile(data.profile || {
        id: user?.id || data.user?.id || '',
        username: user?.username || data.user?.username || '',
        display_name: user?.username || data.user?.username || '',
        avatar_url: null,
        bio: null,
      })
    } catch (error) {
      console.error('Load profile failed:', error)
    }
  }, [user?.id, user?.username])
  useEffect(() => {
    if (!user) { setProfile(null); return }
    void refreshProfile()
  }, [user?.id, refreshProfile])
  const value = useMemo(() => ({ user, profile, loading, configured, signUp, signIn, signOut, signOutAll, refreshProfile }), [user, profile, loading, configured, signUp, signIn, signOut, signOutAll, refreshProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getAuthToken() {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(TOKEN_KEY)
}

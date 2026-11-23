import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getOrCreateDeviceIdentity } from './localStore'

export interface AppUser {
  id: string
  username: string
}
interface AuthState {
  user: AppUser | null
  profile: { id: string; username: string; display_name: string | null } | null
  loading: boolean
  configured: boolean
  signUp: (username: string, password: string) => Promise<{ error: string | null }>
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}
const AuthContext = createContext<AuthState | null>(null)
const API_URL = ((import.meta as any).env?.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const TOKEN_KEY = 'newgen_access_token'
const USER_KEY = 'newgen_user'

async function authRequest(path: string, body: unknown) {
  if (!API_URL) throw new Error('Backend URL is not configured. Set VITE_API_URL in Vercel.')
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
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as AppUser : null
  } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const configured = Boolean(API_URL)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    const saved = readSavedUser()
    if (!token || !saved || !API_URL) {
      setLoading(false)
      return
    }
    fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) throw new Error('Session expired')
        const data = await response.json()
        setUser(data.user)
        localStorage.setItem(USER_KEY, JSON.stringify(data.user))
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const signUp = useCallback(async (username: string, password: string) => {
    try {
      if (!/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) throw new Error('Username must be 3–24 letters, numbers, or underscores.')
      if (password.length < 10) throw new Error('Password must be at least 10 characters.')
      const data = await authRequest('/api/auth/register', { username: username.trim(), password })
      const nextUser = data.user as AppUser
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
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
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(nextUser))
      setUser(nextUser)
      await getOrCreateDeviceIdentity().catch(() => null)
      return { error: null }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not sign in.' }
    }
  }, [])

  const signOut = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
  }, [])
  const refreshProfile = useCallback(async () => {}, [])
  const profile = user ? { id: user.id, username: user.username, display_name: user.username } : null
  const value = useMemo(() => ({ user, profile, loading, configured, signUp, signIn, signOut, refreshProfile }), [user, profile, loading, configured, signUp, signIn, signOut, refreshProfile])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getAuthToken() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)
}

import { getAuthToken } from './auth'

/** Authenticated JSON request against the NEWGEN serverless API. */
export async function apiRequest(path: string, options: RequestInit = {}) {
  const token = getAuthToken()
  if (!token) throw new Error('Please sign in again')
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    cache: 'no-store',
  })
  if (response.status === 204) return {}
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Request failed')
  return result
}

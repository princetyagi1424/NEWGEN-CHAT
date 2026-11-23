import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { exportPrivateKey, exportPublicKey, generateDeviceKeyPair, importPrivateKey } from '../crypto/keys'

interface NewgenDB extends DBSchema {
  device: { key: string; value: { id: string; publicKeyB64: string; privateKey: CryptoKey; deviceName: string; createdAt: string } }
  meta: { key: string; value: { key: string; value: string } }
}

const DB_NAME = 'newgen-chat-v1'
const DB_VERSION = 3
let dbPromise: Promise<IDBPDatabase<NewgenDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<NewgenDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1 stored exportable private-key bytes. Version 2 also introduced
        // plaintext conversation-key and decrypted-message stores. Drop all legacy
        // secret-bearing stores during upgrade; they are intentionally not migrated.
        if (oldVersion < 2 && db.objectStoreNames.contains('device')) db.deleteObjectStore('device')
        if (oldVersion < 3) {
          if (db.objectStoreNames.contains('conversationKeys')) db.deleteObjectStore('conversationKeys')
          if (db.objectStoreNames.contains('messageCache')) db.deleteObjectStore('messageCache')
        }
        if (!db.objectStoreNames.contains('device')) db.createObjectStore('device')
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export async function getOrCreateDeviceIdentity(deviceName?: string) {
  const db = await getDb()
  const existing = await db.get('device', 'current')
  if (existing) {
    return { id: existing.id, publicKeyB64: existing.publicKeyB64, privateKey: existing.privateKey, deviceName: existing.deviceName }
  }
  const pair = await generateDeviceKeyPair()
  const publicKeyB64 = await exportPublicKey(pair.publicKey)
  const privateKeyB64 = await exportPrivateKey(pair.privateKey)
  // Re-import as non-extractable before persisting. IndexedDB stores the CryptoKey,
  // not a plaintext PKCS#8 string that can be copied from browser storage.
  const privateKey = await importPrivateKey(privateKeyB64)
  const id = crypto.randomUUID()
  const name = deviceName || `${navigator.platform || 'Web'} · ${new Date().toLocaleDateString()}`
  await db.put('device', { id, publicKeyB64, privateKey, deviceName: name, createdAt: new Date().toISOString() }, 'current')
  return { id, publicKeyB64, privateKey, deviceName: name }
}

export async function getDevicePrivateKey() {
  const db = await getDb()
  const existing = await db.get('device', 'current')
  if (!existing) return null
  return existing.privateKey
}

/** Remove locally persisted device identity and metadata when the user signs out. */
export async function clearLocalData() {
  const db = await getDb()
  await db.clear('device')
  await db.clear('meta')
}

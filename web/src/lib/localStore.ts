import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { exportPublicKey, generateDeviceKeyPair } from '../crypto/keys'

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
        // The typed DBSchema intentionally omits obsolete stores. Use the native
        // IndexedDB type only for deleting those legacy names during migration.
        const legacyDb = db as unknown as IDBDatabase
        // Version 1 stored exportable private-key bytes. Version 2 also introduced
        // plaintext conversation-key and decrypted-message stores. Drop all legacy
        // secret-bearing stores during upgrade; they are intentionally not migrated.
        if (oldVersion < 2 && legacyDb.objectStoreNames.contains('device')) legacyDb.deleteObjectStore('device')
        if (oldVersion < 3) {
          if (legacyDb.objectStoreNames.contains('conversationKeys')) legacyDb.deleteObjectStore('conversationKeys')
          if (legacyDb.objectStoreNames.contains('messageCache')) legacyDb.deleteObjectStore('messageCache')
        }
        if (!legacyDb.objectStoreNames.contains('device')) db.createObjectStore('device')
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
  // The key pair is briefly extractable because WebCrypto cannot generate an
  // exportable public key and non-extractable private key in one call. Export the
  // private bytes only in memory, immediately re-import them as non-extractable,
  // and wipe the temporary byte buffer before persisting the CryptoKey.
  const privateKeyBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let privateKey: CryptoKey
  try {
    privateKey = await crypto.subtle.importKey(
      'pkcs8', privateKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey', 'deriveBits']
    )
  } finally {
    privateKeyBytes.fill(0)
  }
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

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { exportPrivateKey, exportPublicKey, generateDeviceKeyPair, importPrivateKey } from '../crypto/keys'

interface NewgenDB extends DBSchema {
  device: { key: string; value: { id: string; publicKeyB64: string; privateKeyB64: string; deviceName: string; createdAt: string } }
  conversationKeys: { key: string; value: { conversationId: string; keyB64: string; updatedAt: string } }
  messageCache: { key: string; value: { id: string; conversationId: string; plaintext: string; contentType: string; createdAt: string }; indexes: { 'by-conversation': string } }
  meta: { key: string; value: { key: string; value: string } }
}

const DB_NAME = 'newgen-chat-v1'
let dbPromise: Promise<IDBPDatabase<NewgenDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<NewgenDB>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('device')) db.createObjectStore('device')
        if (!db.objectStoreNames.contains('conversationKeys')) db.createObjectStore('conversationKeys')
        if (!db.objectStoreNames.contains('messageCache')) {
          const store = db.createObjectStore('messageCache', { keyPath: 'id' })
          store.createIndex('by-conversation', 'conversationId')
        }
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
    return { id: existing.id, publicKeyB64: existing.publicKeyB64, privateKey: await importPrivateKey(existing.privateKeyB64), deviceName: existing.deviceName }
  }
  const pair = await generateDeviceKeyPair()
  const publicKeyB64 = await exportPublicKey(pair.publicKey)
  const privateKeyB64 = await exportPrivateKey(pair.privateKey)
  const id = crypto.randomUUID()
  const name = deviceName || `${navigator.platform || 'Web'} · ${new Date().toLocaleDateString()}`
  await db.put('device', { id, publicKeyB64, privateKeyB64, deviceName: name, createdAt: new Date().toISOString() }, 'current')
  return { id, publicKeyB64, privateKey: pair.privateKey, deviceName: name }
}

export async function getDevicePrivateKey() {
  const db = await getDb()
  const existing = await db.get('device', 'current')
  if (!existing) return null
  return importPrivateKey(existing.privateKeyB64)
}

export async function storeConversationKey(conversationId: string, keyB64: string) {
  const db = await getDb()
  await db.put('conversationKeys', { conversationId, keyB64, updatedAt: new Date().toISOString() })
}

export async function getConversationKeyB64(conversationId: string) {
  const db = await getDb()
  const row = await db.get('conversationKeys', conversationId)
  return row?.keyB64 ?? null
}

export async function cacheDecryptedMessage(msg: { id: string; conversationId: string; plaintext: string; contentType: string; createdAt: string }) {
  const db = await getDb()
  await db.put('messageCache', msg)
}

export async function getCachedMessages(conversationId: string) {
  const db = await getDb()
  return db.getAllFromIndex('messageCache', 'by-conversation', conversationId)
}

export async function clearLocalData() {
  const db = await getDb()
  await db.clear('device')
  await db.clear('conversationKeys')
  await db.clear('messageCache')
  await db.clear('meta')
}

/** NEWGEN CHAT client crypto — Web Crypto AES-GCM + ECDH P-256. NOT Signal Protocol. */
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}
function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
}
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return bufToBase64(await crypto.subtle.exportKey('spki', key))
}
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64ToBuf(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  return bufToBase64(await crypto.subtle.exportKey('pkcs8', key))
}
export async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', base64ToBuf(b64), { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
}
export async function generateConversationKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}
export async function exportAesKey(key: CryptoKey): Promise<string> {
  return bufToBase64(await crypto.subtle.exportKey('raw', key))
}
export async function importAesKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64ToBuf(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}
export async function encryptAesGcm(key: CryptoKey, plaintext: string | Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = typeof plaintext === 'string' ? textEncoder.encode(plaintext) : plaintext
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { ciphertext: bufToBase64(ct), iv: bufToBase64(iv) }
}
export async function decryptAesGcm(key: CryptoKey, ciphertextB64: string, ivB64: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBuf(ivB64) }, key, base64ToBuf(ciphertextB64))
  return new Uint8Array(pt)
}
export async function decryptAesGcmToString(key: CryptoKey, ciphertextB64: string, ivB64: string) {
  return textDecoder.decode(await decryptAesGcm(key, ciphertextB64, ivB64))
}
export { bufToBase64, base64ToBuf }

const ENVELOPE_INFO = textEncoder.encode('NEWGEN-CHAT device key envelope v1')

async function deriveEnvelopeKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  salt: Uint8Array
): Promise<CryptoKey> {
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  ))
  try {
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: ENVELOPE_INFO },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  } finally {
    shared.fill(0)
  }
}

/**
 * Wraps a random conversation key to one recipient device. The server should
 * receive only ciphertext + nonce; sender/recipient device IDs and conversation
 * ID are authenticated as AES-GCM additional data by the caller-supplied context.
 */
export async function wrapConversationKeyForDevice(
  senderPrivateKey: CryptoKey,
  recipientPublicKey: CryptoKey,
  conversationKeyB64: string,
  context: string
): Promise<{ ciphertext: string; nonce: string }> {
  if (!context || context.length > 512) throw new Error('Invalid key-envelope context')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveEnvelopeKey(senderPrivateKey, recipientPublicKey, salt)
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: textEncoder.encode(context) },
    wrappingKey,
    base64ToBuf(conversationKeyB64)
  ))
  const combined = new Uint8Array(salt.length + encrypted.length)
  combined.set(salt, 0)
  combined.set(encrypted, salt.length)
  return { ciphertext: bufToBase64(combined), nonce: bufToBase64(nonce) }
}

export async function unwrapConversationKeyForDevice(
  recipientPrivateKey: CryptoKey,
  senderPublicKey: CryptoKey,
  ciphertextB64: string,
  nonceB64: string,
  context: string
): Promise<string> {
  if (!context || context.length > 512) throw new Error('Invalid key-envelope context')
  const combined = base64ToBuf(ciphertextB64)
  const nonce = base64ToBuf(nonceB64)
  if (combined.length < 16 + 16 || nonce.length !== 12) throw new Error('Invalid key envelope')
  const salt = combined.slice(0, 16)
  const encrypted = combined.slice(16)
  const wrappingKey = await deriveEnvelopeKey(recipientPrivateKey, senderPublicKey, salt)
  const rawKey = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: textEncoder.encode(context) },
    wrappingKey,
    encrypted
  ))
  try { return bufToBase64(rawKey) } finally { rawKey.fill(0) }
}

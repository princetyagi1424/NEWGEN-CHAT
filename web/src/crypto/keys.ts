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

/** Passphrase-based local message encryption for the web prototype.
 * Passphrases are never sent to the API. This is not a reviewed E2EE protocol.
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()
function toB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function fromB64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}
async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 256) throw new Error('Passkey must be 12–256 characters.')
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
/** Stores salt + nonce in the existing iv column; neither contains secret key material. */
export async function encryptWithPasskey(passphrase: string, plaintext: string | Uint8Array) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await derivePassphraseKey(passphrase, salt)
  const clear = typeof plaintext === 'string' ? encoder.encode(plaintext) : plaintext
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, clear))
  const metadata = new Uint8Array(salt.length + nonce.length)
  metadata.set(salt); metadata.set(nonce, salt.length)
  return { ciphertext: toB64(ciphertext), iv: toB64(metadata) }
}
export async function decryptWithPasskey(passphrase: string, ciphertext: string, iv: string): Promise<Uint8Array> {
  const metadata = fromB64(iv)
  if (metadata.length !== 28) throw new Error('Unsupported encrypted message format.')
  const salt = metadata.slice(0, 16)
  const nonce = metadata.slice(16)
  const key = await derivePassphraseKey(passphrase, salt)
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, fromB64(ciphertext))
  return new Uint8Array(clear)
}
export async function decryptWithPasskeyToString(passphrase: string, ciphertext: string, iv: string) {
  return decoder.decode(await decryptWithPasskey(passphrase, ciphertext, iv))
}

/** Direct AES-256-GCM with a server-released conversation key (base64). The 12-byte
 * nonce marks the new format; legacy passphrase messages use a 28-byte salt+nonce. */
async function importConversationKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64)
  if (raw.length !== 32) throw new Error('Invalid conversation key.')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
export async function encryptWithConversationKey(keyB64: string, plaintext: string) {
  const key = await importConversationKey(keyB64)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoder.encode(plaintext)))
  return { ciphertext: toB64(ciphertext), iv: toB64(nonce) }
}
export async function decryptWithConversationKey(keyB64: string, ciphertext: string, iv: string) {
  const nonce = fromB64(iv)
  if (nonce.length !== 12) throw new Error('Legacy message format.')
  const key = await importConversationKey(keyB64)
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, fromB64(ciphertext)))
}

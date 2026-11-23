package com.newgenchat.app.security

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * Local symmetric encryption for the NEWGEN CHAT MVP.
 * The same strong chat passphrase must be shared with the other participant out-of-band.
 * The passphrase is never serialized into the payload. The server receives ciphertext only.
 *
 * This is NOT Matrix/Signal protocol E2EE: it has no forward secrecy, device identity,
 * key rotation, multi-device verification or audited protocol state machine. Do not use
 * it as a substitute for a reviewed messaging protocol in a public production release.
 */
object ChatCipher {
    const val ALGORITHM = "AES-256-GCM-PBKDF2-SHA256"
    private const val ITERATIONS = 310_000
    private const val KEY_BITS = 256
    private const val SALT_BYTES = 16
    private const val NONCE_BYTES = 12
    private const val TAG_BITS = 128
    private val random = SecureRandom()

    data class EncryptedPayload(
        val ciphertext: String,
        val nonce: String,
        val salt: String,
        val algorithm: String = ALGORITHM
    )

    fun encrypt(plaintext: String, passphrase: CharArray): EncryptedPayload =
        encryptBytes(plaintext.toByteArray(Charsets.UTF_8), passphrase)

    fun encryptBytes(plaintext: ByteArray, passphrase: CharArray): EncryptedPayload {
        require(plaintext.isNotEmpty()) { "Content cannot be empty" }
        require(passphrase.size >= 12) { "Chat passphrase must be at least 12 characters" }
        val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val key = deriveKey(passphrase, salt)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
            val encrypted = cipher.doFinal(plaintext)
            EncryptedPayload(
                ciphertext = Base64.encodeToString(encrypted, Base64.NO_WRAP),
                nonce = Base64.encodeToString(nonce, Base64.NO_WRAP),
                salt = Base64.encodeToString(salt, Base64.NO_WRAP)
            )
        } finally {
            key.encoded?.fill(0)
        }
    }

    @Throws(AEADBadTagException::class)
    fun decrypt(payload: EncryptedPayload, passphrase: CharArray): String =
        String(decryptBytes(payload, passphrase), Charsets.UTF_8)

    @Throws(AEADBadTagException::class)
    fun decryptBytes(payload: EncryptedPayload, passphrase: CharArray): ByteArray {
        require(payload.algorithm == ALGORITHM) { "Unsupported encryption algorithm" }
        require(passphrase.size >= 12) { "Invalid chat passphrase" }
        val salt = Base64.decode(payload.salt, Base64.NO_WRAP)
        val nonce = Base64.decode(payload.nonce, Base64.NO_WRAP)
        val encrypted = Base64.decode(payload.ciphertext, Base64.NO_WRAP)
        require(salt.size == SALT_BYTES && nonce.size == NONCE_BYTES) { "Invalid encrypted payload" }
        val key = deriveKey(passphrase, salt)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
            cipher.doFinal(encrypted)
        } finally {
            key.encoded?.fill(0)
        }
    }

    private fun deriveKey(passphrase: CharArray, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(passphrase, salt, ITERATIONS, KEY_BITS)
        return try {
            val raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try { SecretKeySpec(raw, "AES") } finally { raw.fill(0) }
        } finally {
            spec.clearPassword()
        }
    }
}

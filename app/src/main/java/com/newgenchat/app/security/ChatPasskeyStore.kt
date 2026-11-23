package com.newgenchat.app.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device-bound encrypted passkey ring.
 * The current passkey encrypts new messages; previous passkeys are retained locally
 * so existing message history remains readable after a passkey rotation.
 * Passkeys are never uploaded to the server.
 */
object ChatPasskeyStore {
    private const val ALIAS = "newgen_chat_passkeys_v1"
    private const val PREFS = "newgen_secure_chat_keys"
    private const val IV = "iv"
    private const val DATA = "data"
    private const val MAX_KEYS = 5

    @Synchronized
    fun loadAll(context: Context): List<String> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val ivText = prefs.getString(IV, null) ?: return emptyList()
        val dataText = prefs.getString(DATA, null) ?: return emptyList()
        return try {
            val iv = Base64.decode(ivText, Base64.NO_WRAP)
            val encrypted = Base64.decode(dataText, Base64.NO_WRAP)
            require(iv.size == 12 && encrypted.size >= 17) { "Stored passkey data is invalid" }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            val clear = cipher.doFinal(encrypted)
            try {
                val json = JSONArray(String(clear, Charsets.UTF_8))
                (0 until json.length()).mapNotNull { json.optString(it).takeIf(String::isNotBlank) }
                    .distinct().take(MAX_KEYS)
            } finally { clear.fill(0) }
        } catch (_: Exception) {
            clear(context)
            emptyList()
        }
    }

    /** Saves a new current key and retains up to four older keys for historical messages. */
    @Synchronized
    fun setCurrent(context: Context, passphrase: CharArray) {
        require(passphrase.size in 12..256) { "Passkey must be 12–256 characters" }
        val value = String(passphrase)
        val keys = (listOf(value) + loadAll(context).filterNot { it == value }).take(MAX_KEYS)
        val json = JSONArray()
        keys.forEach(json::put)
        val clear = json.toString().toByteArray(Charsets.UTF_8)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val encrypted = cipher.doFinal(clear)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString(DATA, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .apply()
        } finally {
            clear.fill(0)
            passphrase.fill('\u0000')
        }
    }

    @Synchronized
    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        runCatching {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (store.containsAlias(ALIAS)) store.deleteEntry(ALIAS)
        }
    }

    private fun getOrCreateKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}

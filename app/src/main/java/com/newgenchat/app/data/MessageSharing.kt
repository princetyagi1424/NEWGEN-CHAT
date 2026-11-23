package com.newgenchat.app.data

import com.newgenchat.app.security.ChatCipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * In-app message forwarding.
 *
 * Plaintext exists only transiently in this process. The server receives a fresh
 * destination-chat envelope, never the source ciphertext or either passphrase.
 * The use case clears both passphrase CharArrays in a `finally` block.
 */
object MessageSharing {
    suspend fun forward(
        accessToken: String,
        destinationUserId: String,
        sourceMessageId: String,
        sourceEnvelope: ChatCipher.EncryptedPayload,
        sourceChatPasskey: CharArray,
        destinationChatPasskey: CharArray
    ): String {
        require(sourceChatPasskey.size >= 12) { "Source chat passkey is too short" }
        require(destinationChatPasskey.size >= 12) { "Destination chat passkey is too short" }
        var plaintext: ByteArray? = null
        return try {
            val clear = withContext(Dispatchers.Default) { ChatCipher.decryptBytes(sourceEnvelope, sourceChatPasskey) }
            plaintext = clear
            val destinationEnvelope = withContext(Dispatchers.Default) { ChatCipher.encryptBytes(clear, destinationChatPasskey) }
            clear.fill(0)
            plaintext = null
            require(
                destinationEnvelope.ciphertext != sourceEnvelope.ciphertext ||
                destinationEnvelope.nonce != sourceEnvelope.nonce ||
                destinationEnvelope.salt != sourceEnvelope.salt
            ) { "A fresh destination encryption envelope is required" }

            NewgenApi.forwardMessage(
                accessToken = accessToken,
                destinationUserId = destinationUserId,
                sourceMessageId = sourceMessageId,
                destinationPayload = destinationEnvelope
            )
        } finally {
            plaintext?.fill(0)
            sourceChatPasskey.fill('\u0000')
            destinationChatPasskey.fill('\u0000')
        }
    }
}

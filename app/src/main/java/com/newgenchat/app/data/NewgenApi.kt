package com.newgenchat.app.data

import com.newgenchat.app.BuildConfig
import com.newgenchat.app.security.ChatCipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class AuthSession(val userId: String, val username: String, val accessToken: String)


data class ApiUser(val id: String, val username: String)
data class ApiMessage(
    val id: String,
    val senderId: String,
    val recipientId: String,
    val ciphertext: String,
    val nonce: String,
    val salt: String,
    val algorithm: String,
    val createdAt: Long = 0L
)
data class ApiGroup(val id: String, val name: String)
data class ApiGroupMessage(
    val id: String,
    val senderId: String,
    val ciphertext: String,
    val nonce: String,
    val salt: String,
    val algorithm: String,
    val createdAt: Long,
    val expiresAt: Long? = null
)
data class ApiFriendRequest(val id: String, val userId: String, val username: String, val createdAt: Long)
data class ApiStatus(
    val id: String,
    val userId: String,
    val username: String,
    val ciphertext: String,
    val nonce: String,
    val salt: String,
    val expiresAt: Long,
    val createdAt: Long
)
data class ApiMedia(val id: String, val mimeType: String, val fileName: String, val byteLength: Int)

object NewgenApi {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    suspend fun register(username: String, password: String): AuthSession =
        authenticate("/api/auth/register", username, password)

    suspend fun login(username: String, password: String): AuthSession =
        authenticate("/api/auth/login", username, password)

    suspend fun restoreSession(accessToken: String): AuthSession = withContext(Dispatchers.IO) {
        val user = request("/api/me", "GET", null, accessToken).getJSONObject("user")
        AuthSession(user.getString("id"), user.getString("username"), accessToken).also {
            runCatching { registerCurrentPushToken(accessToken) }
        }
    }

    private suspend fun authenticate(path: String, username: String, password: String): AuthSession =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("username", username.trim())
                .put("password", password)
            val response = request(path, "POST", body, null)
            val user = response.getJSONObject("user")
            val session = AuthSession(
                userId = user.getString("id"),
                username = user.getString("username"),
                accessToken = response.getString("token")
            )
            // Firebase setup is optional for local development. Once google-services.json
            // is supplied, register this installation for content-free push events.
            runCatching { registerCurrentPushToken(session.accessToken) }
            session
        }

    suspend fun registerPushToken(accessToken: String, token: String) = withContext(Dispatchers.IO) {
        request("/api/push/token", "POST", JSONObject().put("token", token), accessToken)
    }

    private suspend fun registerCurrentPushToken(accessToken: String) {
        val token = FirebaseMessaging.getInstance().token.await()
        registerPushToken(accessToken, token)
    }

    suspend fun searchUsers(accessToken: String, query: String): List<ApiUser> =
        withContext(Dispatchers.IO) {
            val response = request("/api/users/search?q=" + encodePathSegment(query), "GET", null, accessToken)
            val array = response.getJSONArray("users")
            (0 until array.length()).map { i ->
                val item = array.getJSONObject(i)
                ApiUser(item.getString("id"), item.getString("username"))
            }
        }

    suspend fun sendMessage(
        accessToken: String,
        recipientId: String,
        payload: ChatCipher.EncryptedPayload,
        expiresInSeconds: Int? = null
    ): String = withContext(Dispatchers.IO) {
        val body = encryptedBody(payload)
        if (expiresInSeconds != null) body.put("expiresInSeconds", expiresInSeconds)
        request("/api/messages/${encodePathSegment(recipientId)}", "POST", body, accessToken)
            .getJSONObject("message").getString("id")
    }

    suspend fun getMessages(accessToken: String, otherUserId: String): List<ApiMessage> =
        withContext(Dispatchers.IO) {
            val response = request("/api/messages/${encodePathSegment(otherUserId)}", "GET", null, accessToken)
            val array = response.getJSONArray("messages")
            (0 until array.length()).map { i ->
                val item = array.getJSONObject(i)
                ApiMessage(
                    item.getString("id"), item.getString("senderId"), item.getString("recipientId"),
                    item.getString("ciphertext"), item.getString("nonce"), item.getString("salt"),
                    item.getString("algorithm"), item.optLong("createdAt", 0L)
                )
            }
        }

    suspend fun createGroup(accessToken: String, name: String, memberIds: List<String>): ApiGroup =
        withContext(Dispatchers.IO) {
            val ids = org.json.JSONArray()
            memberIds.forEach { ids.put(it) }
            val body = JSONObject().put("name", name).put("memberIds", ids)
            val group = request("/api/groups", "POST", body, accessToken).getJSONObject("group")
            ApiGroup(group.getString("id"), group.getString("name"))
        }

    suspend fun postStatus(accessToken: String, payload: ChatCipher.EncryptedPayload): String =
        withContext(Dispatchers.IO) {
            request("/api/status", "POST", encryptedBody(payload), accessToken)
                .getJSONObject("status").getString("id")
        }

    suspend fun uploadEncryptedMedia(
        accessToken: String,
        ciphertextB64: String,
        nonce: String,
        salt: String,
        mimeType: String,
        fileName: String,
        recipientId: String? = null,
        groupId: String? = null,
        expiresInSeconds: Int? = null
    ): ApiMedia = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("ciphertextB64", ciphertextB64)
            .put("nonce", nonce)
            .put("salt", salt)
            .put("mimeType", mimeType)
            .put("fileName", fileName)
        if (recipientId != null) body.put("recipientId", recipientId)
        if (groupId != null) body.put("groupId", groupId)
        if (expiresInSeconds != null) body.put("expiresInSeconds", expiresInSeconds)
        val media = request("/api/media", "POST", body, accessToken).getJSONObject("media")
        ApiMedia(media.getString("id"), media.getString("mimeType"), media.getString("fileName"), media.getInt("byteLength"))
    }

    suspend fun heartbeat(accessToken: String) = withContext(Dispatchers.IO) {
        request("/api/presence/heartbeat", "POST", JSONObject(), accessToken)
    }

    suspend fun setTyping(accessToken: String, roomKey: String, active: Boolean) =
        withContext(Dispatchers.IO) {
            request("/api/typing/${encodePathSegment(roomKey)}", "POST", JSONObject().put("active", active), accessToken)
        }


    suspend fun sendGroupMessage(
        accessToken: String,
        groupId: String,
        payload: ChatCipher.EncryptedPayload,
        expiresInSeconds: Int? = null
    ): String = withContext(Dispatchers.IO) {
        val body = encryptedBody(payload)
        if (expiresInSeconds != null) body.put("expiresInSeconds", expiresInSeconds)
        request("/api/groups/${encodePathSegment(groupId)}/messages", "POST", body, accessToken)
            .getJSONObject("message").getString("id")
    }

    suspend fun getGroupMessages(accessToken: String, groupId: String): List<ApiGroupMessage> =
        withContext(Dispatchers.IO) {
            val array = request("/api/groups/${encodePathSegment(groupId)}/messages", "GET", null, accessToken)
                .getJSONArray("messages")
            (0 until array.length()).map { i ->
                val item = array.getJSONObject(i)
                ApiGroupMessage(
                    item.getString("id"), item.getString("senderId"),
                    item.getString("ciphertext"), item.getString("nonce"), item.getString("salt"),
                    item.getString("algorithm"), item.optLong("createdAt", 0L),
                    if (item.isNull("expiresAt")) null else item.optLong("expiresAt")
                )
            }
        }

    suspend fun sendFriendRequest(accessToken: String, userId: String) =
        withContext(Dispatchers.IO) {
            request("/api/friends/requests/${encodePathSegment(userId)}", "POST", JSONObject(), accessToken)
        }

    suspend fun acceptFriendRequest(accessToken: String, requestId: String) =
        withContext(Dispatchers.IO) {
            request("/api/friends/requests/${encodePathSegment(requestId)}/accept", "POST", JSONObject(), accessToken)
        }

    suspend fun getFriendRequests(accessToken: String): JSONObject =
        withContext(Dispatchers.IO) {
            request("/api/friends/requests", "GET", null, accessToken)
        }

    suspend fun getIncomingFriendRequests(accessToken: String): List<ApiFriendRequest> = withContext(Dispatchers.IO) {
        val array = request("/api/friends/requests", "GET", null, accessToken).getJSONArray("incoming")
        (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            ApiFriendRequest(item.getString("id"), item.getString("user_id"), item.getString("username"), item.optLong("created_at", 0L))
        }
    }

    suspend fun getFriends(accessToken: String): List<ApiUser> =
        withContext(Dispatchers.IO) {
            val array = request("/api/friends", "GET", null, accessToken).getJSONArray("friends")
            (0 until array.length()).map { i ->
                val item = array.getJSONObject(i)
                ApiUser(item.getString("id"), item.getString("username"))
            }
        }

    suspend fun blockUser(accessToken: String, userId: String) = withContext(Dispatchers.IO) {
        request("/api/users/${encodePathSegment(userId)}/block", "POST", JSONObject(), accessToken)
    }

    suspend fun unblockUser(accessToken: String, userId: String) = withContext(Dispatchers.IO) {
        request("/api/users/${encodePathSegment(userId)}/block", "DELETE", null, accessToken)
    }

    suspend fun getBlockedUsers(accessToken: String): List<ApiUser> = withContext(Dispatchers.IO) {
        val array = request("/api/blocks", "GET", null, accessToken).getJSONArray("blocks")
        (0 until array.length()).map { index ->
            val item = array.getJSONObject(index)
            ApiUser(item.getString("userId"), item.getString("username"))
        }
    }

    suspend fun markMessageRead(accessToken: String, messageId: String) = withContext(Dispatchers.IO) {
        request("/api/messages/${encodePathSegment(messageId)}/read", "POST", JSONObject(), accessToken)
    }

    suspend fun deleteMessage(accessToken: String, messageId: String) = withContext(Dispatchers.IO) {
        request("/api/messages/${encodePathSegment(messageId)}", "DELETE", null, accessToken)
    }

    suspend fun expireMessage(accessToken: String, messageId: String, expiresInSeconds: Int) = withContext(Dispatchers.IO) {
        request("/api/messages/${encodePathSegment(messageId)}/expire", "POST", JSONObject().put("expiresInSeconds", expiresInSeconds), accessToken)
    }

    suspend fun setOffline(accessToken: String) = withContext(Dispatchers.IO) {
        request("/api/presence/offline", "POST", JSONObject(), accessToken)
    }

    suspend fun getGroupMembers(accessToken: String, groupId: String): List<ApiUser> = withContext(Dispatchers.IO) {
        val array = request("/api/groups/${encodePathSegment(groupId)}/members", "GET", null, accessToken).getJSONArray("members")
        (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            ApiUser(item.getString("id"), item.getString("username"))
        }
    }

    suspend fun getGroups(accessToken: String): List<ApiGroup> =
        withContext(Dispatchers.IO) {
            val array = request("/api/groups", "GET", null, accessToken).getJSONArray("groups")
            (0 until array.length()).map { i ->
                val item = array.getJSONObject(i)
                ApiGroup(item.getString("id"), item.getString("name"))
            }
        }

    suspend fun getEncryptedMedia(accessToken: String, mediaId: String): JSONObject =
        withContext(Dispatchers.IO) {
            request("/api/media/${encodePathSegment(mediaId)}", "GET", null, accessToken)
                .getJSONObject("media")
        }

    suspend fun deleteEncryptedMedia(accessToken: String, mediaId: String) = withContext(Dispatchers.IO) {
        request("/api/media/${encodePathSegment(mediaId)}", "DELETE", null, accessToken)
    }


    suspend fun rejectFriendRequest(accessToken: String, requestId: String) =
        withContext(Dispatchers.IO) {
            request("/api/friends/requests/${encodePathSegment(requestId)}/reject", "POST", JSONObject(), accessToken)
        }

    suspend fun createRecoveryCode(accessToken: String): String =
        withContext(Dispatchers.IO) {
            request("/api/account/recovery-code", "POST", JSONObject(), accessToken)
                .getString("recoveryCode")
        }

    suspend fun recoverPassword(username: String, recoveryCode: String, newPassword: String) =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("username", username)
                .put("recoveryCode", recoveryCode)
                .put("newPassword", newPassword)
            request("/api/account/recover-password", "POST", body, null)
        }

    suspend fun uploadMediaEncrypted(
        accessToken: String,
        plaintextBytes: ByteArray,
        chatPasskey: CharArray,
        mimeType: String,
        fileName: String,
        recipientId: String? = null,
        groupId: String? = null,
        expiresInSeconds: Int? = null
    ): ApiMedia {
        try {
            val envelope = withContext(Dispatchers.Default) { ChatCipher.encryptBytes(plaintextBytes, chatPasskey) }
            return uploadEncryptedMedia(
                accessToken,
                envelope.ciphertext,
                envelope.nonce,
                envelope.salt,
                mimeType,
                fileName,
                recipientId,
                groupId,
                expiresInSeconds
            )
        } finally {
            // The caller passes a dedicated mutable copy. Wipe it immediately after
            // local encryption, before the ciphertext upload waits on network I/O.
            plaintextBytes.fill(0)
            chatPasskey.fill('\u0000')
        }
    }

    suspend fun downloadAndDecryptMedia(
        accessToken: String,
        mediaId: String,
        chatPasskey: CharArray
    ): ByteArray {
        try {
            val item = getEncryptedMedia(accessToken, mediaId)
            val envelope = ChatCipher.EncryptedPayload(
                ciphertext = item.getString("ciphertextB64"),
                nonce = item.getString("nonce"),
                salt = item.getString("salt")
            )
            return withContext(Dispatchers.Default) { ChatCipher.decryptBytes(envelope, chatPasskey) }
        } finally {
            chatPasskey.fill('\u0000')
        }
    }

    suspend fun unregisterPushToken(accessToken: String, token: String) = withContext(Dispatchers.IO) {
        request("/api/push/token", "DELETE", JSONObject().put("token", token), accessToken)
    }

    suspend fun unregisterCurrentPushToken(accessToken: String) = withContext(Dispatchers.IO) {
        val token = runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        if (!token.isNullOrBlank()) request("/api/push/token", "DELETE", JSONObject().put("token", token), accessToken)
    }

    suspend fun deleteAccount(accessToken: String) = withContext(Dispatchers.IO) {
        request("/api/account", "DELETE", null, accessToken)
    }


    suspend fun getStatuses(accessToken: String): JSONObject =
        withContext(Dispatchers.IO) {
            request("/api/status", "GET", null, accessToken)
        }

    suspend fun getStatusFeed(accessToken: String): List<ApiStatus> = withContext(Dispatchers.IO) {
        val array = request("/api/status", "GET", null, accessToken).getJSONArray("statuses")
        (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            ApiStatus(
                item.getString("id"), item.getString("userId"), item.getString("username"),
                item.getString("ciphertext"), item.getString("nonce"), item.getString("salt"),
                item.getLong("expiresAt"), item.getLong("createdAt")
            )
        }
    }

    suspend fun getStatusDetails(accessToken: String, statusId: String): JSONObject = withContext(Dispatchers.IO) {
        request("/api/status/${encodePathSegment(statusId)}/details", "GET", null, accessToken)
    }

    suspend fun reactToStatus(accessToken: String, statusId: String, reaction: String) =
        withContext(Dispatchers.IO) {
            request(
                "/api/status/${encodePathSegment(statusId)}/reactions",
                "POST",
                JSONObject().put("reaction", reaction),
                accessToken
            )
        }

    suspend fun replyToStatus(
        accessToken: String,
        statusId: String,
        payload: ChatCipher.EncryptedPayload
    ) = withContext(Dispatchers.IO) {
        request("/api/status/${encodePathSegment(statusId)}/replies", "POST", encryptedBody(payload), accessToken)
    }

    suspend fun markStatusViewed(accessToken: String, statusId: String) =
        withContext(Dispatchers.IO) {
            request("/api/status/${encodePathSegment(statusId)}/view", "POST", JSONObject(), accessToken)
        }

    suspend fun getStatusViewers(accessToken: String, statusId: String): JSONObject =
        withContext(Dispatchers.IO) {
            request("/api/status/${encodePathSegment(statusId)}/viewers", "GET", null, accessToken)
        }

    private fun encryptedBody(payload: ChatCipher.EncryptedPayload): JSONObject =
        JSONObject()
            .put("ciphertext", payload.ciphertext)
            .put("nonce", payload.nonce)
            .put("salt", payload.salt)
            .put("algorithm", payload.algorithm)

    /**
     * Forwards only a newly encrypted destination envelope.
     * The caller must decrypt locally and encrypt again with the destination chat key.
     * Plaintext and passkeys are never accepted by this API method.
     */
    suspend fun forwardMessage(
        accessToken: String,
        destinationUserId: String,
        sourceMessageId: String,
        destinationPayload: ChatCipher.EncryptedPayload
    ): String = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("sourceMessageId", sourceMessageId)
            .put("ciphertext", destinationPayload.ciphertext)
            .put("nonce", destinationPayload.nonce)
            .put("salt", destinationPayload.salt)
            .put("algorithm", destinationPayload.algorithm)
        request(
            "/api/messages/${encodePathSegment(destinationUserId)}/forward",
            "POST",
            body,
            accessToken
        ).getJSONObject("message").getString("id")
    }

    private fun request(path: String, method: String, body: JSONObject?, token: String?): JSONObject {
        val configuredBase = BuildConfig.API_BASE_URL.trim().trimEnd('/')
        val baseUri = runCatching { java.net.URI(configuredBase) }.getOrNull()
        require(
            baseUri != null && baseUri.scheme.equals("https", ignoreCase = true) &&
                !baseUri.host.isNullOrBlank() && baseUri.rawUserInfo == null &&
                baseUri.rawQuery == null && baseUri.rawFragment == null
        ) {
            "Configure NEWGEN_API_BASE_URL as a valid HTTPS origin/path without credentials, query or fragment."
        }
        require(path.startsWith('/') && !path.startsWith("//")) { "Invalid API path" }
        val base = configuredBase
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            if (body != null) {
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > 10 * 1024 * 1024) throw IOException("Server response exceeded the 10 MB safety limit")
                    output.write(buffer, 0, count)
                }
                output.toString(Charsets.UTF_8.name())
            }.orEmpty()
            val json = if (responseText.isBlank()) JSONObject() else JSONObject(responseText)
            if (status in 300..399) throw IOException("Unexpected redirect from API; HTTPS endpoint must not redirect")
            if (status !in 200..299) {
                throw IOException(json.optString("error", "Request failed ($status)"))
            }
            return json
        } finally {
            connection.disconnect()
        }
    }

    private fun encodePathSegment(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

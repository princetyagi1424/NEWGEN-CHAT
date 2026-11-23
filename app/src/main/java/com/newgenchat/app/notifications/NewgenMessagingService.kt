package com.newgenchat.app.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.newgenchat.app.MainActivity
import com.newgenchat.app.data.NewgenApi
import com.newgenchat.app.security.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Receives opaque event hints only. Message text, sender, room IDs and media are never pushed. */
class NewgenMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // The authenticated app registers the current token on its next successful login.
        // Never log FCM tokens.
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            val accessToken = SessionStore.load(this@NewgenMessagingService)
            if (!accessToken.isNullOrBlank()) {
                runCatching { NewgenApi.registerPushToken(accessToken, token) }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["kind"] != "new_message") return
        ensureChannel()
        val launch = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this, 1001, launch,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("NEWGEN CHAT")
            .setContentText("You have a new message")
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(message.messageId?.hashCode() ?: System.currentTimeMillis().toInt(), notification) }
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                        description = "Private alerts that do not reveal message contents"
                        lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
                    }
                )
            }
        }
    }

    companion object { private const val CHANNEL_ID = "newgen_messages" }
}

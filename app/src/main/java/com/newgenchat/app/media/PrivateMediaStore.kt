package com.newgenchat.app.media

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileOutputStream

/**
 * App-private, short-lived cache for media that has already been decrypted locally.
 * Never use this directory with FileProvider or expose its paths to another app.
 * Call clearAll() when leaving the unlocked chat and on logout/app lock.
 */
class PrivateMediaStore(context: Context) {
    private val root = File(context.cacheDir, "newgen_decrypted_media").apply {
        if (!exists() && !mkdirs()) error("Unable to create private media cache")
        setReadable(false, false)
        setWritable(false, false)
        setExecutable(false, false)
        setReadable(true, true)
        setWritable(true, true)
    }

    fun writeDecrypted(bytes: ByteArray, extension: String = "bin"): File {
        require(bytes.isNotEmpty()) { "Media is empty" }
        val safeExtension = extension.lowercase().filter { it.isLetterOrDigit() }.take(8).ifBlank { "bin" }
        val target = File.createTempFile("view_", ".$safeExtension", root)
        try {
            FileOutputStream(target).use { output -> output.write(bytes); output.fd.sync() }
            target.setReadable(false, false)
            target.setWritable(false, false)
            target.setReadable(true, true)
            return target
        } catch (failure: Throwable) {
            target.delete()
            throw failure
        } finally {
            bytes.fill(0)
        }
    }

    /** Bounded read from Android's system picker; caller must encrypt before upload. */
    fun readPicked(context: Context, uri: Uri, maxBytes: Int = 6 * 1024 * 1024): PickedMedia {
        require(maxBytes in 1..(6 * 1024 * 1024))
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: "application/octet-stream"
        val name = resolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
            ?.take(120) ?: "attachment"
        val bytes = resolver.openInputStream(uri)?.use { input ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                total += count
                require(total <= maxBytes) { "File exceeds the 6 MB upload limit" }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: error("Unable to open selected file")
        return PickedMedia(bytes, mime, name)
    }

    fun clearAll() {
        root.listFiles()?.forEach { file ->
            // Best-effort overwrite before unlink; flash storage may not guarantee secure erasure.
            if (file.isFile && file.length() in 1..(6L * 1024 * 1024)) {
                runCatching {
                    FileOutputStream(file, false).use { out ->
                        val zeros = ByteArray(8192)
                        var remaining = file.length()
                        while (remaining > 0) {
                            val count = minOf(remaining, zeros.size.toLong()).toInt()
                            out.write(zeros, 0, count)
                            remaining -= count
                        }
                        out.fd.sync()
                    }
                }
            }
            file.delete()
        }
    }

    fun clearExpired(maxAgeMillis: Long = 10 * 60 * 1000L) {
        require(maxAgeMillis >= 0) { "maxAgeMillis cannot be negative" }
        val cutoff = System.currentTimeMillis() - maxAgeMillis
        root.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
    }

    data class PickedMedia(val bytes: ByteArray, val mimeType: String, val displayName: String) : AutoCloseable {
        /** Wipe the in-memory plaintext after encryption/upload or when the flow is cancelled. */
        override fun close() { bytes.fill(0) }
    }
}

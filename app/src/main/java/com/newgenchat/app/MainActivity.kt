package com.newgenchat.app

import android.os.Bundle
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.widget.MediaController
import android.widget.VideoView
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import com.newgenchat.app.media.PrivateMediaStore
import org.json.JSONObject
import java.io.File
import com.newgenchat.app.data.*
import com.newgenchat.app.security.ChatCipher
import com.newgenchat.app.security.SessionStore
import java.text.DateFormat
import java.util.Date

private val Ink = Color(0xFFF8F6FC)
private val Panel = Color(0xFFFFFFFF)
private val Panel2 = Color(0xFFF1ECFA)
private val Mint = Color(0xFF7652E8)
private val Muted = Color(0xFF89839B)
private val White = Color(0xFF211A35)
private val Danger = Color(0xFFDC4268)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4102)
        }
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_SECURE,
            android.view.WindowManager.LayoutParams.FLAG_SECURE
        )
        setContent { NewgenTheme { NewgenApp() } }
    }
}

@Composable
private fun NewgenTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Mint,
            onPrimary = Color.White,
            background = Ink,
            surface = Panel,
            onSurface = White,
            secondary = Muted,
            error = Danger
        ),
        content = content
    )
}

private data class ChatTarget(val id: String, val name: String, val isGroup: Boolean = false)
private data class AttachmentMeta(val mediaId: String, val fileName: String, val mimeType: String, val byteLength: Int)
private data class RenderedMessage(
    val id: String,
    val senderId: String,
    val text: String,
    val createdAt: Long,
    val encryptedPayload: ChatCipher.EncryptedPayload,
    val attachment: AttachmentMeta? = null
)

@Composable
private fun NewgenApp() {
    val context = LocalContext.current
    var session by remember { mutableStateOf<AuthSession?>(null) }
    var bootstrapping by remember { mutableStateOf(true) }
    var activeChat by remember { mutableStateOf<ChatTarget?>(null) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var lockRequest by remember { mutableIntStateOf(0) }
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestActiveChat by rememberUpdatedState(activeChat)
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && latestActiveChat != null) {
                lockRequest++
                runCatching { PrivateMediaStore(context).clearAll() }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(Unit) {
        val token = withContext(Dispatchers.IO) { SessionStore.load(context) }
        if (!token.isNullOrBlank()) {
            session = runCatching { NewgenApi.restoreSession(token) }.getOrNull()
            if (session == null) withContext(Dispatchers.IO) { SessionStore.clear(context) }
        }
        bootstrapping = false
    }

    Surface(Modifier.fillMaxSize(), color = Ink) {
        when {
            bootstrapping -> CenterMessage("Opening NEWGEN CHAT…")
            session == null -> WelcomeScreen(onAuthenticated = { authenticated ->
                runCatching { SessionStore.save(context, authenticated.accessToken) }
                    .onSuccess { session = authenticated }
                    .onFailure { session = authenticated }
            })
            activeChat != null -> ChatScreen(
                session = session!!,
                target = activeChat!!,
                lockRequest = lockRequest,
                onBack = { activeChat = null; refreshKey++ }
            )
            else -> MainHome(
                session = session!!,
                refreshKey = refreshKey,
                onRefresh = { refreshKey++ },
                onOpenChat = { activeChat = it },
                onLogout = {
                    SessionStore.clear(context)
                    activeChat = null
                    session = null
                },
                onAccountDeleted = {
                    SessionStore.clear(context)
                    activeChat = null
                    session = null
                }
            )
        }
    }
}

@Composable
private fun WelcomeScreen(onAuthenticated: (AuthSession) -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var recoveryCode by remember { mutableStateOf("") }
    var securityAnswer by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var isRegister by remember { mutableStateOf(false) }
    var recoverMode by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Box(
        Modifier.fillMaxSize().background(Color(0xFFF8F5FF)).imePadding(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(Modifier.size(68.dp).clip(RoundedCornerShape(24.dp)).background(Mint), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.ChatBubble, null, tint = Color.White, modifier = Modifier.size(34.dp))
            }
            Spacer(Modifier.height(16.dp))
            Text("NEWGEN CHAT", color = White, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = .4.sp)
            Text("Your people. Your moments. Your space.", color = Muted, fontSize = 13.sp)
            Spacer(Modifier.height(28.dp))
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Panel).padding(22.dp),
                verticalArrangement = Arrangement.spacedBy(13.dp)
            ) {
                Text(
                    when { recoverMode -> "Recover your account"; isRegister -> "Create your account"; else -> "Welcome back" },
                    color = White, fontSize = 23.sp, fontWeight = FontWeight.Bold
                )
                Text("Sign in to continue your private conversations.", color = Muted, fontSize = 13.sp)
                OutlinedTextField(
                    value = username, onValueChange = { username = it.trim() },
                    modifier = Modifier.fillMaxWidth(), label = { Text("Username") },
                    placeholder = { Text("your_username") }, singleLine = true,
                    shape = RoundedCornerShape(16.dp)
                )
                if (recoverMode) {
                    Text("Use your recovery code OR your security answer.", color = Muted, fontSize = 12.sp)
                    OutlinedTextField(value = recoveryCode, onValueChange = { recoveryCode = it.trim() }, modifier = Modifier.fillMaxWidth(), label = { Text("One-time recovery code (optional)") }, singleLine = true, shape = RoundedCornerShape(16.dp))
                    Text("OR · What was the name of your first school?", color = White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(value = securityAnswer, onValueChange = { securityAnswer = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Security answer (optional)") }, singleLine = true, shape = RoundedCornerShape(16.dp))
                    OutlinedTextField(value = newPassword, onValueChange = { newPassword = it }, modifier = Modifier.fillMaxWidth(), label = { Text("New password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, shape = RoundedCornerShape(16.dp))
                } else {
                    OutlinedTextField(value = password, onValueChange = { password = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, shape = RoundedCornerShape(16.dp))
                    if (isRegister) {
                        Text("Account recovery question", color = Muted, fontSize = 12.sp)
                        Text("What was the name of your first school?", color = White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                        OutlinedTextField(value = securityAnswer, onValueChange = { securityAnswer = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Your answer") }, singleLine = true, shape = RoundedCornerShape(16.dp))
                    }
                }
                error?.let { Text(it, color = Danger, fontSize = 12.sp) }
                info?.let { Text(it, color = Color(0xFF15966B), fontSize = 12.sp) }
                Button(
                    onClick = {
                        busy = true; error = null; info = null
                        scope.launch {
                            try {
                                when {
                                    recoverMode -> {
                                        if (recoveryCode.isNotBlank()) NewgenApi.recoverPassword(username, recoveryCode, newPassword) else NewgenApi.recoverPasswordWithSecurityAnswer(username, securityAnswer, newPassword)
                                        recoverMode = false; password = ""; recoveryCode = ""; securityAnswer = ""; newPassword = ""
                                        info = "Password reset complete. Sign in with your new password."
                                    }
                                    else -> {
                                        val authenticated = if (isRegister) NewgenApi.register(username, password, securityAnswer) else NewgenApi.login(username, password)
                                        onAuthenticated(authenticated)
                                    }
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Unable to connect to the NEWGEN CHAT server"
                            } finally { busy = false }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().height(54.dp),
                    enabled = !busy && username.length >= 3 && if (recoverMode) ((recoveryCode.length >= 20 || securityAnswer.length >= 2) && newPassword.length >= 10) else password.length >= 10 && (!isRegister || securityAnswer.trim().length >= 2),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Mint)
                ) {
                    Text(when { busy -> "Please wait…"; recoverMode -> "Reset password"; isRegister -> "Create account"; else -> "Sign in" }, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(18.dp))
            TextButton(onClick = { isRegister = !isRegister; recoverMode = false; error = null; info = null }) {
                Text(if (isRegister) "Already have an account? Sign in" else "No account? Create account", color = Mint, fontWeight = FontWeight.SemiBold)
            }
            TextButton(onClick = { recoverMode = !recoverMode; error = null; info = null }) {
                Text(if (recoverMode) "Back to sign in" else "Forgot password?", color = Muted)
            }
            Text("Your account password and chat passkeys serve different purposes.", color = Muted, fontSize = 10.sp)
        }
    }
}

@Composable
private fun MainHome(
    session: AuthSession,
    refreshKey: Int,
    onRefresh: () -> Unit,
    onOpenChat: (ChatTarget) -> Unit,
    onLogout: () -> Unit,
    onAccountDeleted: () -> Unit
) {
    var selectedTab by remember { mutableStateOf("Chats") }
    var friends by remember { mutableStateOf<List<ApiUser>>(emptyList()) }
    var groups by remember { mutableStateOf<List<ApiGroup>>(emptyList()) }
    var requests by remember { mutableStateOf<List<ApiFriendRequest>>(emptyList()) }
    var statuses by remember { mutableStateOf<List<ApiStatus>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val logoutAction: () -> Unit = {
        scope.launch {
            runCatching { NewgenApi.unregisterCurrentPushToken(session.accessToken) }
            runCatching { NewgenApi.setOffline(session.accessToken) }
            onLogout()
        }
    }

    LaunchedEffect(session.accessToken, refreshKey) {
        busy = true
        error = null
        runCatching { NewgenApi.heartbeat(session.accessToken) }
        val friendResult = runCatching { NewgenApi.getFriends(session.accessToken) }
        val groupResult = runCatching { NewgenApi.getGroups(session.accessToken) }
        val requestResult = runCatching { NewgenApi.getIncomingFriendRequests(session.accessToken) }
        val statusResult = runCatching { NewgenApi.getStatusFeed(session.accessToken) }
        friendResult.onSuccess { friends = it }.onFailure { error = it.message }
        groupResult.onSuccess { groups = it }
        requestResult.onSuccess { requests = it }
        statusResult.onSuccess { statuses = it }
        busy = false
    }

    Column(Modifier.fillMaxSize().background(Color(0xFFFCFAFF))) {
        Row(
            Modifier.fillMaxWidth().background(Panel).padding(horizontal = 20.dp, vertical = 17.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(Modifier.size(42.dp).clip(RoundedCornerShape(15.dp)).background(Mint), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.ChatBubble, null, tint = Color.White, modifier = Modifier.size(23.dp))
            }
            Spacer(Modifier.width(11.dp))
            Column(Modifier.weight(1f)) {
                Text("NEWGEN", color = White, fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, letterSpacing = -.3.sp)
                Text("@${session.username} · your private circle", color = Muted, fontSize = 11.sp)
            }
            IconButton(onClick = onRefresh) { Icon(Icons.Default.Refresh, "Refresh", tint = Muted) }
            IconButton(onClick = logoutAction) { Text("↪", color = Muted, fontSize = 22.sp) }
        }
        error?.let { Text(it, color = Danger, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp)) }
        when (selectedTab) {
            "Chats" -> ChatsPane(session, friends, groups, busy, onOpenChat, onRefresh)
            "Friends" -> FriendsPane(session, friends, requests, onRefresh, onOpenChat)
            "Status" -> StatusPane(session, statuses, onRefresh)
            else -> SettingsPane(session, logoutAction, onAccountDeleted)
        }
        Spacer(Modifier.weight(1f))
        NavigationBar(containerColor = Panel) {
            listOf("Chats", "Friends", "Status", "Settings").forEach { tab ->
                NavigationBarItem(
                    selected = selectedTab == tab,
                    onClick = { selectedTab = tab },
                    icon = { Icon(when (tab) { "Chats" -> Icons.Default.ChatBubble; "Friends" -> Icons.Default.People; "Status" -> Icons.Default.Circle; else -> Icons.Default.Settings }, contentDescription = tab) },
                    label = { Text(tab) }
                )
            }
        }
    }
}

@Composable
private fun ChatsPane(
    session: AuthSession,
    friends: List<ApiUser>,
    groups: List<ApiGroup>,
    loading: Boolean,
    onOpenChat: (ChatTarget) -> Unit,
    onRefresh: () -> Unit
) {
    var groupName by remember { mutableStateOf("") }
    var selectedMembers by remember { mutableStateOf(setOf<String>()) }
    var creating by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
        Text("Messages", color = White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        if (loading && friends.isEmpty() && groups.isEmpty()) Text("Loading your chats…", color = Muted)
        if (friends.isEmpty() && groups.isEmpty() && !loading) Text("No chats yet. Add a friend in the Friends tab to start.", color = Muted, fontSize = 13.sp)
        LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(friends, key = { "friend-${it.id}" }) { friend ->
                ChatListRow(friend.username, "Direct conversation", onClick = { onOpenChat(ChatTarget(friend.id, friend.username)) })
            }
            items(groups, key = { "group-${it.id}" }) { group ->
                ChatListRow(group.name, "Group conversation", onClick = { onOpenChat(ChatTarget(group.id, group.name, true)) })
            }
        }
        Spacer(Modifier.height(12.dp))
        HorizontalDivider(color = Panel2)
        Spacer(Modifier.height(10.dp))
        Text("Create a group", color = White, fontWeight = FontWeight.Bold)
        OutlinedTextField(value = groupName, onValueChange = { groupName = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Group name") }, singleLine = true)
        if (friends.isNotEmpty()) {
            Text("Choose friends", color = Muted, fontSize = 12.sp)
            friends.forEach { friend ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = friend.id in selectedMembers, onCheckedChange = { checked ->
                        selectedMembers = if (checked) selectedMembers + friend.id else selectedMembers - friend.id
                    })
                    Text(friend.username, color = White)
                }
            }
        }
        message?.let { Text(it, color = Mint, fontSize = 12.sp) }
        Button(
            onClick = {
                creating = true; message = null
                scope.launch {
                    try {
                        NewgenApi.createGroup(session.accessToken, groupName.trim(), selectedMembers.toList())
                        groupName = ""; selectedMembers = emptySet()
                        message = "Group created. Members must share the same group passkey securely out of band."
                        onRefresh()
                    } catch (e: Exception) { message = e.message ?: "Could not create group" }
                    finally { creating = false }
                }
            },
            enabled = !creating && groupName.isNotBlank(),
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (creating) "Creating…" else "Create group") }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun ChatListRow(name: String, subtitle: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(15.dp)).background(Panel).clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(Panel2), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), color = Mint, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, color = White, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = Muted, fontSize = 12.sp)
        }
        Text("›", color = Mint, fontSize = 24.sp)
    }
}

@Composable
private fun FriendsPane(
    session: AuthSession,
    friends: List<ApiUser>,
    requests: List<ApiFriendRequest>,
    onRefresh: () -> Unit,
    onOpenChat: (ChatTarget) -> Unit
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ApiUser>>(emptyList()) }
    var info by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
        Text("Find people by username", color = White, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(value = query, onValueChange = { query = it }, modifier = Modifier.weight(1f), label = { Text("Username") }, singleLine = true)
            Spacer(Modifier.width(8.dp))
            Button(onClick = {
                busy = true; info = null
                scope.launch {
                    try { results = NewgenApi.searchUsers(session.accessToken, query.trim()) }
                    catch (e: Exception) { info = e.message ?: "Search failed" }
                    finally { busy = false }
                }
            }, enabled = !busy && query.trim().length >= 2) { Text(if (busy) "…" else "Search") }
        }
        info?.let { Text(it, color = Mint, fontSize = 12.sp) }
        LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(results, key = { "result-${it.id}" }) { user ->
                Row(Modifier.fillMaxWidth().background(Panel, RoundedCornerShape(12.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("@${user.username}", color = White, modifier = Modifier.weight(1f))
                    TextButton(onClick = {
                        scope.launch {
                            runCatching { NewgenApi.sendFriendRequest(session.accessToken, user.id) }
                                .onSuccess { info = "Friend request sent to @${user.username}"; results = results.filterNot { it.id == user.id } }
                                .onFailure { info = it.message ?: "Request failed" }
                        }
                    }) { Text("Add", color = Mint) }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = Panel2)
        Text("Incoming requests · ${requests.size}", color = White, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 10.dp))
        if (requests.isEmpty()) Text("No pending requests.", color = Muted, fontSize = 12.sp)
        requests.forEach { request ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("@${request.username}", color = White, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    scope.launch {
                        runCatching { NewgenApi.acceptFriendRequest(session.accessToken, request.id) }
                            .onSuccess { info = "You are now friends with @${request.username}"; onRefresh() }
                            .onFailure { info = it.message }
                    }
                }) { Text("Accept", color = Mint) }
                TextButton(onClick = {
                    scope.launch {
                        runCatching { NewgenApi.rejectFriendRequest(session.accessToken, request.id) }
                            .onSuccess { onRefresh() }
                            .onFailure { info = it.message }
                    }
                }) { Text("Decline", color = Muted) }
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = Panel2)
        Text("Your friends", color = White, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 10.dp))
        friends.forEach { friend ->
            ChatListRow(friend.username, "Open encrypted conversation") { onOpenChat(ChatTarget(friend.id, friend.username)) }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun StatusPane(session: AuthSession, statuses: List<ApiStatus>, onRefresh: () -> Unit) {
    var newStory by remember { mutableStateOf("") }
    var sharedPasskey by remember { mutableStateOf("") }
    var revealed by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var replyDrafts by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var repliesByStatus by remember { mutableStateOf<Map<String, List<String>>>(emptyMap()) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp)) {
        Text("Encrypted status", color = White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("Stories expire after 24 hours. Share the status passkey with intended viewers using a separate secure channel.", color = Muted, fontSize = 12.sp)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(value = sharedPasskey, onValueChange = { sharedPasskey = it; revealed = emptyMap() }, modifier = Modifier.fillMaxWidth(), label = { Text("Status passkey · 12+ characters") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        OutlinedTextField(value = newStory, onValueChange = { newStory = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Write a text status") }, minLines = 2)
        Button(
            onClick = {
                busy = true; notice = null
                scope.launch {
                    val key = sharedPasskey.toCharArray()
                    try {
                        val encrypted = withContext(Dispatchers.Default) { ChatCipher.encrypt(newStory.trim(), key) }
                        NewgenApi.postStatus(session.accessToken, encrypted)
                        newStory = ""; notice = "Status posted. It will expire in 24 hours."; onRefresh()
                    } catch (e: Exception) { notice = e.message ?: "Could not post status" }
                    finally { key.fill('\u0000'); busy = false }
                }
            },
            enabled = !busy && newStory.isNotBlank() && sharedPasskey.length >= 12,
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (busy) "Posting…" else "Post encrypted status") }
        notice?.let { Text(it, color = Mint, fontSize = 12.sp) }
        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = Panel2)
        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Friends' stories", color = White, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text("${statuses.size}", color = Muted, fontSize = 12.sp)
        }
        LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(statuses, key = { it.id }) { status ->
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Panel).padding(12.dp)) {
                    Text("@${status.username}", color = Mint, fontWeight = FontWeight.SemiBold)
                    val content = revealed[status.id]
                    Text(content ?: "Encrypted story · tap Reveal after entering the correct passkey", color = if (content != null) White else Muted, fontSize = 13.sp)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = {
                            scope.launch {
                                try {
                                    val key = sharedPasskey.toCharArray()
                                    val text = try { withContext(Dispatchers.Default) { decryptPayload(ChatCipher.EncryptedPayload(status.ciphertext, status.nonce, status.salt), key) } }
                                        finally { key.fill('\u0000') }
                                    revealed = revealed + (status.id to text)
                                    NewgenApi.markStatusViewed(session.accessToken, status.id)
                                    notice = null
                                } catch (e: Exception) { notice = e.message ?: "Wrong passkey or invalid status" }
                            }
                        }, enabled = sharedPasskey.length >= 12) { Text("Reveal", color = Mint) }
                        TextButton(onClick = {
                            scope.launch {
                                runCatching { NewgenApi.reactToStatus(session.accessToken, status.id, "❤️") }
                                    .onSuccess { notice = "Reaction sent" }
                                    .onFailure { notice = it.message }
                            }
                        }) { Text("♥ React", color = Mint) }
                    }
                    if (content != null) {
                        OutlinedTextField(
                            value = replyDrafts[status.id].orEmpty(),
                            onValueChange = { value -> replyDrafts = replyDrafts + (status.id to value) },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Encrypted reply") },
                            singleLine = true
                        )
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = {
                                val text = replyDrafts[status.id].orEmpty().trim()
                                if (text.isNotBlank()) scope.launch {
                                    val key = sharedPasskey.toCharArray()
                                    try {
                                        val payload = withContext(Dispatchers.Default) { ChatCipher.encrypt(text, key) }
                                        NewgenApi.replyToStatus(session.accessToken, status.id, payload)
                                        replyDrafts = replyDrafts - status.id
                                        notice = "Encrypted reply sent"
                                    } catch (e: Exception) { notice = e.message ?: "Reply failed" }
                                    finally { key.fill('\u0000') }
                                }
                            }) { Text("Send reply", color = Mint) }
                            TextButton(onClick = {
                                scope.launch {
                                    try {
                                        val detail = NewgenApi.getStatusDetails(session.accessToken, status.id)
                                        val array = detail.getJSONArray("replies")
                                        val values = mutableListOf<String>()
                                        for (index in 0 until array.length()) {
                                            val item = array.getJSONObject(index)
                                            val key = sharedPasskey.toCharArray()
                                            val decoded = try {
                                                withContext(Dispatchers.Default) {
                                                    decryptPayload(
                                                        ChatCipher.EncryptedPayload(item.getString("ciphertext"), item.getString("nonce"), item.getString("salt")),
                                                        key
                                                    )
                                                }
                                            } finally { key.fill('\u0000') }
                                            values.add(decoded)
                                        }
                                        repliesByStatus = repliesByStatus + (status.id to values)
                                    } catch (e: Exception) { notice = e.message ?: "Could not load replies" }
                                }
                            }) { Text("Load replies", color = Muted) }
                        }
                        repliesByStatus[status.id].orEmpty().forEach { reply ->
                            Text("↳ $reply", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp, top = 3.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsPane(
    session: AuthSession,
    onLogout: () -> Unit,
    onAccountDeleted: () -> Unit
) {
    var recovery by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var blockedUsers by remember { mutableStateOf<List<ApiUser>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(session.accessToken) {
        runCatching { NewgenApi.getBlockedUsers(session.accessToken) }
            .onSuccess { blockedUsers = it }
    }
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(22.dp)) {
        Text("Account & privacy", color = White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text("Signed in as @${session.username}", color = Muted, fontSize = 13.sp)
        Spacer(Modifier.height(18.dp))
        Text("Account recovery", color = White, fontWeight = FontWeight.Bold)
        Text("Generate a one-time code and store it offline. It restores account login only; it cannot restore chat passkeys.", color = Muted, fontSize = 12.sp)
        Button(onClick = {
            busy = true; recovery = null; notice = null
            scope.launch {
                runCatching { NewgenApi.createRecoveryCode(session.accessToken) }
                    .onSuccess { recovery = it }
                    .onFailure { notice = it.message ?: "Could not create recovery code" }
                busy = false
            }
        }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Generating…" else "Generate new recovery code") }
        recovery?.let {
            Text("Save this code now. It is shown only once:", color = Mint, fontSize = 12.sp)
            Text(it, color = White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }
        notice?.let { Text(it, color = Danger, fontSize = 12.sp) }
        Spacer(Modifier.height(20.dp))
        HorizontalDivider(color = Panel2)
        Spacer(Modifier.height(14.dp))
        Text("Blocked accounts · ${blockedUsers.size}", color = White, fontWeight = FontWeight.Bold)
        if (blockedUsers.isEmpty()) Text("You have not blocked anyone.", color = Muted, fontSize = 12.sp)
        blockedUsers.forEach { blocked ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("@${blocked.username}", color = White, modifier = Modifier.weight(1f))
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        runCatching { NewgenApi.unblockUser(session.accessToken, blocked.id) }
                            .onSuccess { blockedUsers = blockedUsers.filterNot { it.id == blocked.id }; notice = "Unblocked @${blocked.username}" }
                            .onFailure { notice = it.message ?: "Unable to unblock user" }
                        busy = false
                    }
                }) { Text("Unblock", color = Mint) }
            }
        }
        Spacer(Modifier.height(20.dp))
        Text("Security notes", color = White, fontWeight = FontWeight.Bold)
        Text("• Screen capture is restricted with Android FLAG_SECURE.\n• The server receives encrypted message payloads, not chat passkeys.\n• This build uses a custom shared-passphrase AES-GCM prototype, not a reviewed Signal/Matrix protocol.", color = Muted, fontSize = 12.sp)
        Spacer(Modifier.height(20.dp))
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("Log out") }
        Spacer(Modifier.height(8.dp))
        Button(onClick = { confirmDelete = true }, colors = ButtonDefaults.buttonColors(containerColor = Danger), modifier = Modifier.fillMaxWidth()) { Text("Delete account permanently") }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete your account?") },
            text = { Text("This permanently deletes your account and server data associated with it. This action cannot be undone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false; busy = true
                    scope.launch {
                        runCatching { NewgenApi.deleteAccount(session.accessToken) }
                            .onSuccess { onAccountDeleted() }
                            .onFailure { notice = it.message ?: "Account deletion failed" }
                        busy = false
                    }
                }) { Text("Delete permanently", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun ChatScreen(session: AuthSession, target: ChatTarget, lockRequest: Int, onBack: () -> Unit) {
    val context = LocalContext.current
    val mediaStore = remember(context) { PrivateMediaStore(context) }
    var passkeyInput by remember { mutableStateOf("") }
    var chatKey by remember { mutableStateOf<CharArray?>(null) }
    var draft by remember { mutableStateOf("") }
    var messages by remember { mutableStateOf<List<RenderedMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var unlockGeneration by remember { mutableIntStateOf(0) }
    var expirySeconds by remember { mutableIntStateOf(0) }
    var expiryMenuExpanded by remember { mutableStateOf(false) }
    var confirmBlock by remember { mutableStateOf(false) }
    var forwardingMessage by remember { mutableStateOf<RenderedMessage?>(null) }
    var forwardFriends by remember { mutableStateOf<List<ApiUser>>(emptyList()) }
    var forwardDestination by remember { mutableStateOf<ApiUser?>(null) }
    var forwardPasskey by remember { mutableStateOf("") }
    var attachmentPreview by remember { mutableStateOf<AttachmentMeta?>(null) }
    var previewBitmap by remember { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    var previewFile by remember { mutableStateOf<File?>(null) }
    var audioPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var videoViewInstance by remember { mutableStateOf<VideoView?>(null) }
    var audioPreparing by remember { mutableStateOf(false) }
    var audioPlaying by remember { mutableStateOf(false) }
    var previewText by remember { mutableStateOf<String?>(null) }
    var previewNote by remember { mutableStateOf<String?>(null) }
    var previewBusy by remember { mutableStateOf(false) }
    var pendingAttachmentUri by remember { mutableStateOf<Uri?>(null) }
    val transientPasskeys = remember { mutableSetOf<CharArray>() }
    val scope = rememberCoroutineScope()

    fun lockConversation() {
        unlockGeneration++
        chatKey?.fill('\u0000')
        chatKey = null
        transientPasskeys.forEach { it.fill('\u0000') }
        transientPasskeys.clear()
        messages = emptyList()
        passkeyInput = ""
        draft = ""
        sending = false
        previewBusy = false
        forwardingMessage = null
        forwardFriends = emptyList()
        forwardDestination = null
        confirmBlock = false
        forwardPasskey = ""
        runCatching { audioPlayer?.release() }
        runCatching { videoViewInstance?.stopPlayback() }
        audioPlayer = null; videoViewInstance = null; audioPreparing = false; audioPlaying = false
        previewBitmap = null
        previewFile = null
        previewText = null
        previewNote = null
        attachmentPreview = null
        runCatching { mediaStore.clearAll() }
    }

    LaunchedEffect(lockRequest) {
        if (lockRequest > 0) lockConversation()
    }

    BackHandler { lockConversation(); onBack() }
    val latestChatKey by rememberUpdatedState(chatKey)
    val latestAudioPlayer by rememberUpdatedState(audioPlayer)
    val latestVideoView by rememberUpdatedState(videoViewInstance)
    val latestPendingAttachment by rememberUpdatedState(pendingAttachmentUri)
    DisposableEffect(Unit) {
        onDispose {
            latestChatKey?.fill('\u0000')
            runCatching { latestAudioPlayer?.release() }
            runCatching { latestVideoView?.stopPlayback() }
            latestPendingAttachment?.let { uri ->
                runCatching { context.contentResolver.releasePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            }
            runCatching { mediaStore.clearAll() }
        }
    }

    suspend fun loadMessages(secret: CharArray) {
        val generationAtStart = unlockGeneration
        loading = true; error = null
        try {
            val rendered = mutableListOf<RenderedMessage>()
            if (target.isGroup) {
                val history = NewgenApi.getGroupMessages(session.accessToken, target.id)
                for (message in history) {
                    val envelope = ChatCipher.EncryptedPayload(message.ciphertext, message.nonce, message.salt, message.algorithm)
                    val messageKey = secret.copyOf()
                    transientPasskeys.add(messageKey)
                    val text = try { withContext(Dispatchers.Default) { decryptPayload(envelope, messageKey) } }
                    catch (_: Exception) { "Unable to decrypt. Check this conversation's passkey." }
                    finally { transientPasskeys.remove(messageKey); messageKey.fill('\u0000') }
                    val decoded = decodeMessageContent(text)
                    rendered.add(RenderedMessage(message.id, message.senderId, decoded.first, message.createdAt, envelope, decoded.second))
                }
            } else {
                val history = NewgenApi.getMessages(session.accessToken, target.id)
                for (message in history) {
                    val envelope = ChatCipher.EncryptedPayload(message.ciphertext, message.nonce, message.salt, message.algorithm)
                    val messageKey = secret.copyOf()
                    transientPasskeys.add(messageKey)
                    val text = try { withContext(Dispatchers.Default) { decryptPayload(envelope, messageKey) } }
                    catch (_: Exception) { "Unable to decrypt. Check this conversation's passkey." }
                    finally { transientPasskeys.remove(messageKey); messageKey.fill('\u0000') }
                    if (message.senderId != session.userId) runCatching { NewgenApi.markMessageRead(session.accessToken, message.id) }
                    val decoded = decodeMessageContent(text)
                    rendered.add(RenderedMessage(message.id, message.senderId, decoded.first, message.createdAt, envelope, decoded.second))
                }
            }
            if (chatKey != null && generationAtStart == unlockGeneration) messages = rendered
        } catch (e: Exception) {
            if (chatKey != null && generationAtStart == unlockGeneration) error = e.message ?: "Could not load conversation"
        } finally { loading = false }
    }

    LaunchedEffect(chatKey != null, target.id) {
        val secret = chatKey?.copyOf() ?: return@LaunchedEffect
        transientPasskeys.add(secret)
        try {
            while (true) {
                loadMessages(secret)
                delay(6_000)
            }
        } finally { transientPasskeys.remove(secret); secret.fill('\u0000') }
    }

    suspend fun uploadAttachment(uri: Uri, secret: CharArray, generation: Int) {
        var uploadedMediaId: String? = null
        var plaintextCopy: ByteArray? = null
        try {
            if (generation != unlockGeneration || chatKey == null) return
            val picked = withContext(Dispatchers.IO) { mediaStore.readPicked(context, uri, 4_000_000) }
            picked.use { media ->
                if (generation != unlockGeneration || chatKey == null) return
                val apiMime = when (media.mimeType.lowercase()) {
                    "image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "audio/mpeg", "audio/mp4", "audio/ogg", "application/pdf" -> media.mimeType.lowercase()
                    else -> "application/octet-stream"
                }
                plaintextCopy = media.bytes.copyOf()
                // Only one plaintext copy remains during local encryption; the API
                // wipes it before network upload begins.
                media.bytes.fill(0)
                val uploaded = NewgenApi.uploadMediaEncrypted(
                    accessToken = session.accessToken,
                    plaintextBytes = plaintextCopy!!,
                    chatPasskey = secret.copyOf(),
                    mimeType = apiMime,
                    fileName = media.displayName,
                    recipientId = if (target.isGroup) null else target.id,
                    groupId = if (target.isGroup) target.id else null,
                    expiresInSeconds = expirySeconds.takeIf { it > 0 }
                )
                uploadedMediaId = uploaded.id
                if (generation != unlockGeneration || chatKey == null) {
                    runCatching { NewgenApi.deleteEncryptedMedia(session.accessToken, uploaded.id) }
                    uploadedMediaId = null
                    error = "The chat locked while uploading. The attachment was discarded; unlock and retry."
                    return
                }
                val manifest = JSONObject()
                    .put("_newgenType", "attachment")
                    .put("mediaId", uploaded.id)
                    .put("fileName", media.displayName)
                    .put("mimeType", media.mimeType)
                    .put("byteLength", media.bytes.size)
                    .toString()
                val envelope = withContext(Dispatchers.Default) { ChatCipher.encrypt(manifest, secret) }
                if (target.isGroup) NewgenApi.sendGroupMessage(session.accessToken, target.id, envelope, expirySeconds.takeIf { it > 0 })
                else NewgenApi.sendMessage(session.accessToken, target.id, envelope, expirySeconds.takeIf { it > 0 })
            }
            uploadedMediaId = null
            if (generation == unlockGeneration && chatKey != null) {
                loadMessages(secret)
                if (generation == unlockGeneration && chatKey != null) error = "Attachment sent securely."
            }
        } catch (e: Exception) {
            uploadedMediaId?.let { runCatching { NewgenApi.deleteEncryptedMedia(session.accessToken, it) } }
            if (generation == unlockGeneration && chatKey != null) error = e.message ?: "Attachment was not sent"
        } finally {
            plaintextCopy?.fill(0)
            transientPasskeys.remove(secret)
            secret.fill('\u0000')
            runCatching { context.contentResolver.releasePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        }
    }

    fun launchAttachmentUpload(uri: Uri, secret: CharArray, generation: Int) {
        transientPasskeys.add(secret)
        scope.launch { uploadAttachment(uri, secret, generation) }
    }

    // Do not start a LaunchedEffect keyed by pendingAttachmentUri: clearing that state
    // would cancel the effect itself. The picker callback or explicit unlock action owns
    // the upload coroutine, so selecting a document cannot double-send or self-cancel.
    val attachmentPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching { context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) }
            pendingAttachmentUri = uri
            val secret = chatKey?.copyOf()
            if (secret == null) {
                error = "File selected. Unlock this chat again to encrypt and send it."
            } else {
                val generation = unlockGeneration
                pendingAttachmentUri = null
                launchAttachmentUpload(uri, secret, generation)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().background(Panel).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { lockConversation(); onBack() }) { Icon(Icons.Default.ArrowBack, "Back", tint = White) }
            Column(Modifier.weight(1f)) {
                Text(target.name, color = White, fontWeight = FontWeight.Bold)
                Text(if (chatKey == null) "Encrypted view · locked" else "Unlocked locally", color = if (chatKey == null) Muted else Mint, fontSize = 11.sp)
            }
            if (chatKey != null) IconButton(onClick = { lockConversation() }) { Icon(Icons.Default.LockOpen, "Lock chat", tint = Mint) }
            if (!target.isGroup) {
                IconButton(onClick = { confirmBlock = true }) { Icon(Icons.Default.Block, "Block user", tint = Danger) }
            }
        }
        if (chatKey == null) {
            Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(Icons.Default.Lock, null, tint = Mint, modifier = Modifier.size(44.dp))
                Spacer(Modifier.height(14.dp))
                Text("Conversation is encrypted", color = White, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                Text("Enter this chat's unique passkey. It is used locally and is never sent to the server.", color = Muted, fontSize = 13.sp)
                if (pendingAttachmentUri != null) Text("A file is selected. Unlock to encrypt and send it.", color = Mint, fontSize = 12.sp)
                Spacer(Modifier.height(18.dp))
                OutlinedTextField(value = passkeyInput, onValueChange = { passkeyInput = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Chat passkey · 12+ characters") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                    val key = passkeyInput.toCharArray()
                    passkeyInput = ""
                    chatKey = key
                    val selectedUri = pendingAttachmentUri
                    if (selectedUri != null) {
                        val generation = unlockGeneration
                        pendingAttachmentUri = null
                        launchAttachmentUpload(selectedUri, key.copyOf(), generation)
                    }
                }, enabled = passkeyInput.length >= 12, modifier = Modifier.fillMaxWidth()) { Text("Unlock chat") }
                error?.let { Text(it, color = Danger, fontSize = 12.sp) }
            }
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (loading && messages.isEmpty()) item { Text("Loading encrypted messages…", color = Muted) }
                if (!loading && messages.isEmpty()) item { Text("No messages yet. Send the first encrypted message.", color = Muted, fontSize = 13.sp) }
                items(messages, key = { it.id }) { message ->
                    val mine = message.senderId == session.userId
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                        if (message.attachment != null) {
                            Row(
                                Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(15.dp)).background(if (mine) Panel2 else Panel)
                                    .clickable {
                                        runCatching { audioPlayer?.release() }; runCatching { videoViewInstance?.stopPlayback() }; audioPlayer = null; videoViewInstance = null; audioPreparing = false; audioPlaying = false
                                        runCatching { mediaStore.clearAll() }
                                        attachmentPreview = message.attachment; previewBitmap = null; previewFile = null; previewText = null; previewNote = null
                                    }
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.AttachFile, null, tint = Mint)
                                Spacer(Modifier.width(8.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(message.attachment.fileName, color = White, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("Encrypted attachment · ${message.attachment.byteLength} bytes", color = Muted, fontSize = 10.sp)
                                }
                            }
                        } else {
                            Box(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(15.dp)).background(if (mine) Panel2 else Panel).padding(12.dp)) {
                                Text(message.text, color = White, fontSize = 14.sp)
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(formatTime(message.createdAt), color = Muted, fontSize = 9.sp, modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp))
                            if (!target.isGroup && message.attachment == null) TextButton(onClick = { forwardingMessage = message; forwardDestination = null; forwardPasskey = ""; scope.launch { runCatching { NewgenApi.getFriends(session.accessToken) }.onSuccess { forwardFriends = it }.onFailure { error = it.message } } }) {
                                Icon(Icons.Default.Share, null, tint = Mint, modifier = Modifier.size(13.dp)); Text("Forward", color = Mint, fontSize = 10.sp)
                            }
                            if (mine && !target.isGroup) TextButton(onClick = {
                                scope.launch {
                                    runCatching { NewgenApi.expireMessage(session.accessToken, message.id, 3600) }
                                        .onSuccess { error = "Message will expire within one hour." }
                                        .onFailure { error = it.message ?: "Could not set expiry" }
                                }
                            }) { Text("Expire 1h", color = Muted, fontSize = 10.sp) }
                        }
                    }
                }
            }
            error?.let { Text(it, color = Danger, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 14.dp)) }
            Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    TextButton(onClick = { expiryMenuExpanded = true }) {
                        Text("Auto-delete: ${when (expirySeconds) { 60 -> "1m"; 3600 -> "1h"; 86400 -> "1d"; 604800 -> "7d"; else -> "Off" }}", color = Mint, fontSize = 11.sp)
                    }
                    DropdownMenu(expanded = expiryMenuExpanded, onDismissRequest = { expiryMenuExpanded = false }) {
                        listOf(0 to "Off", 60 to "After 1 minute", 3600 to "After 1 hour", 86400 to "After 1 day", 604800 to "After 7 days").forEach { (seconds, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { expirySeconds = seconds; expiryMenuExpanded = false })
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().background(Panel).padding(8.dp).imePadding(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(enabled = !sending, onClick = { attachmentPicker.launch(arrayOf("*/*")) }) { Icon(Icons.Default.AttachFile, "Attach encrypted file", tint = Mint) }
                OutlinedTextField(value = draft, onValueChange = { draft = it }, modifier = Modifier.weight(1f), placeholder = { Text("Message") }, shape = RoundedCornerShape(18.dp), singleLine = true)
                IconButton(enabled = !sending && draft.isNotBlank(), onClick = {
                    val clearText = draft.trim()
                    val secret = chatKey?.copyOf() ?: return@IconButton
                    val sendGeneration = unlockGeneration
                    transientPasskeys.add(secret)
                    draft = ""; sending = true; error = null
                    scope.launch {
                        try {
                            val payload = withContext(Dispatchers.Default) { ChatCipher.encrypt(clearText, secret) }
                            if (sendGeneration != unlockGeneration || chatKey == null) return@launch
                            if (target.isGroup) NewgenApi.sendGroupMessage(session.accessToken, target.id, payload, expirySeconds.takeIf { it > 0 })
                            else NewgenApi.sendMessage(session.accessToken, target.id, payload, expirySeconds.takeIf { it > 0 })
                            if (sendGeneration == unlockGeneration && chatKey != null) loadMessages(secret)
                        } catch (e: Exception) {
                            if (sendGeneration == unlockGeneration && chatKey != null) {
                                error = e.message ?: "Message was not sent"
                                draft = clearText
                            }
                        } finally { transientPasskeys.remove(secret); secret.fill('\u0000'); sending = false }
                    }
                }) { Icon(Icons.Default.Send, "Send encrypted message", tint = Mint) }
            }
            TextButton(onClick = { lockConversation() }, modifier = Modifier.align(Alignment.End)) { Text("Lock conversation", color = Mint) }
        }
    }

    if (confirmBlock) {
        AlertDialog(
            onDismissRequest = { confirmBlock = false },
            title = { Text("Block @${target.name}?") },
            text = { Text("This stops new contact and removes the friendship. You can unblock this account from Settings.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmBlock = false
                    scope.launch {
                        runCatching { NewgenApi.blockUser(session.accessToken, target.id) }
                            .onSuccess { lockConversation(); onBack() }
                            .onFailure { error = it.message ?: "Could not block this account" }
                    }
                }) { Text("Block", color = Danger) }
            },
            dismissButton = { TextButton(onClick = { confirmBlock = false }) { Text("Cancel") } }
        )
    }

    forwardingMessage?.let { source ->
        AlertDialog(
            onDismissRequest = { forwardingMessage = null; forwardDestination = null; forwardPasskey = "" },
            title = { Text("Forward encrypted message") },
            text = {
                Column(Modifier.fillMaxWidth()) {
                    Text("Choose the destination friend. Their chat passkey is used only on this device.", color = Muted, fontSize = 12.sp)
                    LazyColumn(Modifier.heightIn(max = 180.dp)) {
                        items(forwardFriends, key = { it.id }) { friend ->
                            Row(Modifier.fillMaxWidth().clickable { forwardDestination = friend }.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("@${friend.username}", color = White, modifier = Modifier.weight(1f))
                                if (forwardDestination?.id == friend.id) Text("Selected", color = Mint, fontSize = 11.sp)
                            }
                        }
                    }
                    forwardDestination?.let { Text("To @${it.username}", color = Mint, fontSize = 12.sp) }
                    OutlinedTextField(value = forwardPasskey, onValueChange = { forwardPasskey = it }, label = { Text("Destination chat passkey") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                }
            },
            confirmButton = {
                TextButton(enabled = !sending && forwardDestination != null && forwardPasskey.length >= 12, onClick = {
                    val destination = forwardDestination ?: return@TextButton
                    val sourceKey = chatKey?.copyOf() ?: return@TextButton
                    val destinationKey = forwardPasskey.toCharArray()
                    val forwardGeneration = unlockGeneration
                    transientPasskeys.add(sourceKey); transientPasskeys.add(destinationKey)
                    forwardingMessage = null; forwardPasskey = ""; sending = true
                    scope.launch {
                        try {
                            if (forwardGeneration != unlockGeneration || chatKey == null) return@launch
                            MessageSharing.forward(session.accessToken, destination.id, source.id, source.encryptedPayload, sourceKey, destinationKey)
                            if (forwardGeneration == unlockGeneration && chatKey != null) error = "Message forwarded to @${destination.username}"
                        } catch (e: Exception) {
                            if (forwardGeneration == unlockGeneration && chatKey != null) error = e.message ?: "Forward failed"
                        } finally {
                            transientPasskeys.remove(sourceKey); transientPasskeys.remove(destinationKey)
                            sourceKey.fill('\u0000'); destinationKey.fill('\u0000')
                            sending = false; forwardDestination = null
                        }
                    }
                }) { Text("Forward") }
            },
            dismissButton = { TextButton(onClick = { forwardingMessage = null; forwardDestination = null; forwardPasskey = "" }) { Text("Cancel") } }
        )
    }

    attachmentPreview?.let { attachment ->
        AlertDialog(
            onDismissRequest = { runCatching { audioPlayer?.release() }; runCatching { videoViewInstance?.stopPlayback() }; audioPlayer = null; videoViewInstance = null; audioPreparing = false; audioPlaying = false; attachmentPreview = null; previewBitmap = null; previewFile = null; previewText = null; previewNote = null; runCatching { mediaStore.clearAll() } },
            title = { Text(attachment.fileName) },
            text = {
                Column(Modifier.fillMaxWidth()) {
                    Text("Encrypted file · ${attachment.mimeType} · ${attachment.byteLength} bytes", color = Muted, fontSize = 11.sp)
                    Spacer(Modifier.height(10.dp))
                    when {
                        previewBitmap != null -> Image(previewBitmap!!, contentDescription = attachment.fileName, modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp))
                        previewText != null -> Text(previewText!!.take(6000), color = White, fontSize = 12.sp)
                        previewFile != null && attachment.mimeType.startsWith("video/") -> AndroidView(
                            factory = { viewContext -> VideoView(viewContext).apply {
                                videoViewInstance = this
                                setVideoPath(previewFile!!.absolutePath)
                                setMediaController(MediaController(viewContext))
                                start()
                            } }, modifier = Modifier.fillMaxWidth().height(220.dp)
                        )
                        previewFile != null && attachment.mimeType.startsWith("audio/") -> Column {
                            Text("Audio is decrypted locally and played from the private cache.", color = Muted, fontSize = 12.sp)
                            Button(enabled = !audioPreparing, onClick = {
                                val player = audioPlayer
                                if (player == null) {
                                    val created = MediaPlayer()
                                    audioPlayer = created
                                    audioPreparing = true
                                    created.setOnPreparedListener { it.start(); audioPreparing = false; audioPlaying = true }
                                    created.setOnCompletionListener { audioPlaying = false; runCatching { it.seekTo(0) } }
                                    created.setOnErrorListener { _, _, _ -> audioPreparing = false; audioPlaying = false; true }
                                    runCatching { created.setDataSource(previewFile!!.absolutePath); created.prepareAsync() }
                                        .onFailure { audioPreparing = false; previewNote = it.message ?: "Audio playback failed"; runCatching { created.release() }; audioPlayer = null }
                                } else if (audioPlaying) { player.pause(); audioPlaying = false }
                                else { runCatching { player.start(); audioPlaying = true }.onFailure { previewNote = it.message } }
                            }) { Text(when { audioPreparing -> "Loading audio…"; audioPlaying -> "Pause audio"; else -> "Play audio" }) }
                        }
                        else -> Text(previewNote ?: "The encrypted file stays private until you decrypt it here.", color = Muted, fontSize = 12.sp)
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = !previewBusy && previewFile == null, onClick = {
                    val secret = chatKey?.copyOf() ?: return@TextButton
                    val previewGeneration = unlockGeneration
                    transientPasskeys.add(secret)
                    previewBusy = true; previewNote = "Decrypting locally…"
                    scope.launch {
                        try {
                            val bytes = NewgenApi.downloadAndDecryptMedia(session.accessToken, attachment.mediaId, secret)
                            if (previewGeneration != unlockGeneration || chatKey == null) {
                                bytes.fill(0)
                                return@launch
                            }
                            val ext = attachment.fileName.substringAfterLast('.', "bin").lowercase().filter { it.isLetterOrDigit() }.take(8)
                            val file = withContext(Dispatchers.IO) { mediaStore.writeDecrypted(bytes, ext) }
                            if (previewGeneration != unlockGeneration || chatKey == null) {
                                file.delete()
                                mediaStore.clearAll()
                                return@launch
                            }
                            previewFile = file
                            when {
                                attachment.mimeType.startsWith("image/") -> {
                                    val bitmap = withContext(Dispatchers.IO) { decodeImagePreview(file) }
                                    if (bitmap != null) previewBitmap = bitmap.asImageBitmap() else previewNote = "The decrypted image could not be decoded."
                                }
                                attachment.mimeType == "application/pdf" -> {
                                    val bitmap = withContext(Dispatchers.IO) {
                                        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
                                            PdfRenderer(descriptor).use { renderer ->
                                                if (renderer.pageCount > 0) renderer.openPage(0).use { page ->
                                                    Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888).also { page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
                                                } else null
                                            }
                                        }
                                    }
                                    if (bitmap != null) previewBitmap = bitmap.asImageBitmap() else previewNote = "This PDF has no previewable page."
                                }
                                attachment.mimeType.startsWith("text/") -> previewText = withContext(Dispatchers.IO) { file.readText(Charsets.UTF_8).take(6000) }
                                else -> previewNote = "The file was decrypted into NEWGEN CHAT's private cache. Inline preview for this file type is not available in this build. Locking the chat clears the temporary decrypted file."
                            }
                            if (previewGeneration != unlockGeneration || chatKey == null) {
                                previewBitmap = null; previewText = null; previewFile = null
                                mediaStore.clearAll()
                            }
                        } catch (e: Exception) { if (previewGeneration == unlockGeneration && chatKey != null) previewNote = e.message ?: "Could not decrypt attachment" }
                        finally { secret.fill('\u0000'); previewBusy = false }
                    }
                }) { Text(when { previewBusy -> "Decrypting…"; previewFile != null -> "Decrypted"; else -> "Decrypt & preview" }) }
            },
            dismissButton = { TextButton(onClick = { runCatching { audioPlayer?.release() }; runCatching { videoViewInstance?.stopPlayback() }; audioPlayer = null; videoViewInstance = null; audioPreparing = false; audioPlaying = false; attachmentPreview = null; previewBitmap = null; previewFile = null; previewText = null; previewNote = null; runCatching { mediaStore.clearAll() } }) { Text("Close") } }
        )
    }
}

private fun decodeMessageContent(raw: String): Pair<String, AttachmentMeta?> {
    return runCatching {
        val json = JSONObject(raw)
        if (json.optString("_newgenType") != "attachment") raw to null
        else "" to AttachmentMeta(
            json.getString("mediaId"), json.getString("fileName"),
            json.optString("mimeType", "application/octet-stream"), json.optInt("byteLength", 0)
        )
    }.getOrElse { raw to null }
}

private fun decodeImagePreview(file: File): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
    return BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
}

private fun decryptPayload(payload: ChatCipher.EncryptedPayload, passkey: CharArray): String {
    return try {
        val clear = ChatCipher.decryptBytes(payload, passkey)
        try { String(clear, Charsets.UTF_8) } finally { clear.fill(0) }
    } finally { passkey.fill('\u0000') }
}

private fun formatTime(value: Long): String = if (value <= 0L) "" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(value))

@Composable
private fun CenterMessage(message: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(message, color = Muted) }
}

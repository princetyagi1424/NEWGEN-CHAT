# NEWGEN CHAT — Android + Web clients + Node.js API

NEWGEN CHAT is an Android-first username-based messaging project. This archive contains a connected **development MVP**, not a production-ready secure messenger. It deliberately does not claim Signal/Matrix-grade end-to-end encryption: the current client uses an AES-256-GCM + PBKDF2 shared-passphrase prototype while the production protocol work remains a release blocker.

## What is connected in this source

### Android app
- Username/password registration and login, plus recovery-code password reset.
- API session token encrypted at rest using an Android Keystore AES-GCM key.
- Username search, friend requests, incoming request accept/decline and friend list.
- Direct messages and group text messages using the local AES-GCM payload helper.
- Per-conversation passphrase gate. Locking/backing out or sending the app to the background clears the in-memory passphrase array, decrypted transcript, player state and private media cache. The chat route remains locked after a document-picker round-trip so the selected file can be encrypted only after re-unlocking.
- Message history refresh while a chat is unlocked, and read receipts for incoming direct messages.
- Visible direct-text forwarding decrypts locally and encrypts again with the selected destination chat passkey. Attachment and group forwarding are not exposed.
- Direct and group message auto-expiry choices (off, 1 minute, 1 hour, 1 day, 7 days); the backend deletes expired payloads during history reads.
- Block a user from a direct chat and manage/unblock blocked accounts from Settings.
- Encrypted file picker/upload for supported image, MP4 video, audio, PDF and generic files (4 MB plaintext limit); group media download is gated by current group membership. Decrypted images, first PDF page, text files, audio and MP4 video can be previewed or played in-app from private cache. Office formats are downloaded/decrypted only to private cache and have no in-app renderer.
- Group creation with selected accepted friends. The group passphrase/key still has to be distributed out of band by members.
- Text statuses encrypted before upload, 24-hour expiry, reveal/view, reactions, and encrypted replies.
- One-time account recovery code generation, permanent account deletion, logout/offline and FCM token unregister.
- Android `FLAG_SECURE`, no cleartext traffic, no broad storage/contacts/location permission, and generic private push notifications.

### Backend API
- Username registration/login with bcrypt, JWT authentication and session-version revocation after password recovery.
- Username search, friend requests, block/unblock endpoints, friends list.
- Ciphertext-only direct/group message relay, direct message expiry, sender delete, read/delivery receipts and client-side forwarding endpoint.
- Encrypted status payloads, 24-hour expiry, view receipts, reactions, encrypted replies and authorized status-detail retrieval.
- Opaque encrypted media blob endpoints with owner/recipient/group-membership ACLs, MIME allowlist and 6 MB ciphertext limit.
- Presence, short-lived typing state, account recovery/deletion and generic data-only FCM event delivery.
- SQLite storage, request validation, rate limits, Helmet, restricted CORS default, parameterized SQL and non-root Docker runtime.

## Important security and product limitations

1. **E2EE protocol:** the current passphrase AES-GCM implementation is a prototype, not a reviewed multi-device protocol. It has no forward secrecy, device identity verification, cross-signing, secure key backup/restore, or group key rotation. Do not advertise this build as a secure private messenger for sensitive communications.
2. **Media UX:** the chat UI has a bounded attachment picker, encrypted direct/group upload, private download/decryption, image/PDF-first-page/text previews and audio/MP4 playback. Office document rendering, thumbnails, streaming, attachment forwarding and richer media controls remain incomplete. The media relay caps ciphertext to 6 MB per file.
3. **Stories:** Web supports friend-only text/photo stories with 24-hour expiry, but story content is service-readable and is not end-to-end encrypted. Web video/GIF stories, story reactions/replies/views and scheduled object cleanup remain future work. Android text statuses retain their separate encrypted payload flow.
4. **Group keys:** group messages are encrypted payloads, but the app does not securely distribute, rotate, verify, or recover group keys. Sharing a group passphrase manually is a prototype workaround only.
5. **Other UX gaps:** direct text forwarding, direct-chat block/unblock management and per-message/chat auto-expiry controls are now visible. Typing/presence UI, privacy preferences, last-seen controls, delivery receipt UI, report/abuse workflows, richer group administration and full settings remain incomplete.
6. **Production infrastructure:** backend persistence is SQLite for single-instance development. PostgreSQL runtime migration, private object storage, a public HTTPS domain, TLS termination, backups, monitoring, abuse controls and production operations are not configured.
7. **Push notifications:** FCM is optional and remains disabled until an owner-configured Firebase project, `app/google-services.json`, and server service-account secret are supplied.
8. **Release QA:** no signed APK, Android Studio/Gradle build, emulator/device install, two-device chat test, real FCM delivery test, penetration test or independent security audit is included in this archive.

## Run the backend locally (Windows PowerShell)

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` and set `JWT_SECRET` to a cryptographically random value of at least 32 characters. Then:

```powershell
npm install
npm test
npm start
```

Health endpoint: `http://127.0.0.1:5000/api/health`

The server binds to `127.0.0.1` by default for local use. Docker Compose binds its published port to `127.0.0.1:5000`; put a properly configured HTTPS reverse proxy in front before allowing remote connections.

## Configure the Android app

The Android API client requires an HTTPS base URL and refuses redirects. Set `NEWGEN_API_BASE_URL` in your Gradle user properties or environment, for example:

```properties
NEWGEN_API_BASE_URL=https://your-api.example.com
```

Do not commit a production URL containing credentials or secret query parameters. Plain HTTP localhost endpoints will be rejected by the Android client.

Open the project root in Android Studio, sync Gradle, then use **Build → Build Bundle(s) / APK(s) → Build APK(s)**. This environment did not have Gradle or an Android SDK, so this archive does not include a verified APK.

## Optional FCM setup

1. Create a Firebase project and register Android package `com.newgenchat.app`.
2. Add the resulting `app/google-services.json` locally (it is git-ignored).
3. Configure the server environment variable `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` with the base64-encoded Firebase service account JSON.
4. Rebuild/redeploy the Android app and restart the backend.

The push payload is intentionally generic: it does not include message text, sender identity, conversation IDs, ciphertext, or media URLs.

## Automated checks and current release status

The current repository CI workflow validates the backend, Web client and Android debug APK. On the latest branch workflow snapshot (run 45238767834):

- Backend Node test suite: **67/67 passing**. These include source-contract/security tests and do not replace live HTTP integration.
- Web: **TypeScript validation and Vite production build passed**.
- Android: the debug APK build was still running when this status snapshot was written; check the workflow link before treating it as passed.

Before using Web profile photo upload or stories, apply `web/database/migrations/010_profile_stories.sql` in Supabase after the custom account schema and chat-auth bridge. See `docs/IMPLEMENTATION-STATUS.md`, `docs/SECURITY_AUDIT.md`, `docs/EXTERNAL_BLOCKERS.md` and `docs/RELEASE-GATE-2026-11-23.md` for the honest implementation/release assessment.

A successful CI build is not proof of live Supabase migrations, Firebase delivery, two-device behavior, production E2EE, WebRTC calling, or an independent security review.

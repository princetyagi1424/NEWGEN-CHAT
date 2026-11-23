# NEWGEN CHAT — Android Messenger + Node.js API

NEWGEN CHAT is an Android-first, username-based messaging development MVP.

> **Security status:** This is not a production-ready secure messenger. The current client-side AES-256-GCM + PBKDF2 passphrase implementation is a prototype, not a reviewed Signal/Matrix-grade end-to-end encryption protocol. Do not use it for sensitive communications.

## Included functionality

### Android
- Username/password registration and login, recovery-code password reset.
- Android Keystore-backed encrypted session storage.
- Username search, friend requests, friend list, direct and group text messaging.
- Per-conversation passphrase gate; backgrounding/locking clears in-memory plaintext and passphrase buffers.
- Direct text forwarding with local decrypt/re-encrypt.
- Direct/group message expiry controls.
- Block/unblock user controls.
- Encrypted file upload/download for supported image, MP4, audio, PDF and generic files; private-cache previews/playback for supported types.
- Text statuses, expiry, views, reactions and encrypted replies.
- Account recovery/deletion, logout, secure-window flag and generic private push notifications.

### Backend
- Express API with bcrypt password hashing, JWT authentication and session-version revocation.
- Friend requests, blocking, direct/group ciphertext relay, expiry and receipts.
- Encrypted statuses and media relay with access-control checks.
- Presence, typing state, account recovery/deletion and optional FCM events.
- SQLite development storage, request validation, rate limits, Helmet, restricted CORS and non-root Docker runtime.

## Known limitations / release blockers

1. Production E2EE protocol, device verification, forward secrecy, cross-signing, key backup and group key rotation are not implemented.
2. Status supports encrypted text; image/GIF/video story UI is incomplete.
3. Office document rendering, thumbnails, streaming, attachment forwarding and richer media controls are incomplete.
4. Group key distribution/rotation is not secure; group passphrases require out-of-band sharing in this prototype.
5. PostgreSQL runtime migration, production object storage, public HTTPS deployment, backups, monitoring and abuse operations are not configured.
6. FCM requires an owner-configured Firebase project, `app/google-services.json`, and server service-account secret.
7. No signed APK, full Android Gradle build, physical two-device test, live FCM test, penetration test or independent security audit is included.

## Run backend locally (Windows PowerShell)

```powershell
cd backend
Copy-Item .env.example .env
# Set JWT_SECRET in backend/.env to a cryptographically random value (at least 32 chars).
npm install
npm test
npm start
```

Health check: `http://127.0.0.1:5000/api/health`

## Android setup

Set `NEWGEN_API_BASE_URL` in Gradle user properties/environment to an HTTPS API endpoint, then open the project root in Android Studio, sync Gradle, and build/run the app. The API client rejects plain HTTP and redirects.

## Verification notes

The source archive's reported checks include 50/50 backend contract tests, backend syntax checks, SQLite schema validation, and limited Kotlin checks using local stubs. These are not live HTTP integration tests or proof of a complete Android APK build. The preparation environment lacked Android SDK/Gradle/Docker and dependency installation timed out.

See `docs/FINAL-VALIDATION.md`, `docs/IMPLEMENTATION-STATUS.md` and `docs/RELEASE-GATE-2026-11-23.md` for detailed status.

# NEWGEN CHAT — Production release gate

This is an engineering checklist, not a claim that these items have shipped. The project currently has a custom JWT/SQLite relay and a Compose prototype. Its AES-GCM passphrase helper is not a reviewed multi-device messaging protocol.

## Architecture decision: do not bolt Matrix onto the current relay

The Matrix Rust SDK owns a distinct client session, device identity, sync engine, room model, crypto store, cross-signing and key backup. NEWGEN's current API owns username/password accounts and custom message tables. A real rollout must choose one canonical message system. Recommended target:

1. Matrix homeserver (Synapse or another maintained homeserver) with PostgreSQL.
2. Android `sdk-android` FFI pinned to one matching stable release, including all native ABI libraries.
3. NEWGEN username mapped deterministically to a Matrix user ID on a fixed homeserver domain; no phone number required.
4. Matrix rooms as the source of truth for direct and group chat. The custom API becomes a minimal profile/discovery/policy service, not a parallel plaintext/message relay.
5. Matrix encrypted media APIs and the SDK's encrypted attachment support; do not store decrypted media on the server.
6. A local per-chat lock may gate access to the UI/SDK store, but must not become a second encryption protocol or be sent to the server.

## Required implementation sequence

### A. Matrix E2EE
- Pin SDK Android binding and native artifacts to the same stable release; commit dependency verification metadata and record checksums.
- Persist SDK session and crypto store in app-private storage; protect store secrets with Android Keystore.
- Use SDK-managed Olm/Megolm encryption, device list tracking, room key rotation, cross-signing and interactive SAS/QR verification.
- Implement recovery/key backup through Matrix Secret Storage and server-side key backup. Show recovery-key creation, confirmation, restore and reset UX. Explain that password reset alone cannot decrypt old history.
- Test new-device login, unverified-device warning, verified-device trust, key-change alerts, offline sync and recovery on clean reinstall.

### B. App screens and live data
- Replace `sampleChats` and demo message list with repository flows from the Matrix SDK.
- Add real chat list, timeline, compose/send, typing, receipts, reactions, edits/redactions, group creation/member roles, friend discovery/requests and status lifecycle.
- Keep loading/error/empty states and pagination; do not show sample rows in release builds.
- Direct text forwarding is now wired in the custom API prototype. Matrix-room forwarding still needs to be implemented after the Matrix SDK migration; attachment forwarding is intentionally withheld until media is copied/re-encrypted with destination access rights.

### C. Media and file lifecycle
- Use Android Photo Picker / OpenDocument with no broad storage permission.
- Validate MIME type, file signature, size and dimensions on device; encrypt before upload.
- Decrypt only after chat unlock into app-private cache. Never expose decrypted paths through public storage or FileProvider by default.
- Clear decrypted cache on lock, chat exit, logout, crash-recovery startup and short TTL. Flash storage overwrite is best-effort only; cryptographic erasure via short-lived per-file keys is preferable.
- Current source wires bounded picker reads, encrypted direct/group upload, group-membership authorization, private cache, image preview, first-page PDF preview, text preview and in-app audio/MP4 playback. Office rendering, encrypted thumbnails/streaming and attachment forwarding remain incomplete. Cache is cleared on chat lock/app background, and the document-picker lifecycle preserves a pending URI without keeping the chat unlocked.

### D. Notifications
- Use data-only FCM pushes containing an opaque event/wakeup identifier only—never sender, message body, attachment name, room title or crypto keys.
- Use a server-side Matrix push gateway (e.g. Sygnal) and per-device pushers; keep analytics disabled unless explicitly needed.
- On device, fetch/sync encrypted events, decrypt only inside the app, and default lock-screen notifications to “New message”. Add a user-controlled preview preference.
- Request Android 13+ notification permission in context. Test denied permission, locked screen, force-stop, token rotation and logout token deletion.

### E. Server / database / domain
- Provision a stable domain and DNS; terminate TLS with automatic certificate renewal and HSTS.
- Deploy Matrix homeserver with PostgreSQL, private network, persistent volumes, encrypted backups, restore drills, rate limits and monitoring.
- Keep PostgreSQL inaccessible from the public internet. Require TLS for remote DB connections; use least-privilege roles and rotation.
- The existing custom Node API is SQLite-backed and synchronous. It is **not** PostgreSQL-ready; a deliberate async repository/transaction migration and integration test suite is required before claiming PostgreSQL support.
- Store secrets in deployment secret manager, not `.env` in Git. Add retention/deletion policies and test backup restore.

### F. Release verification
- CI backend tests and Android debug APK build (workflow added at `.github/workflows/verify.yml`).
- Instrumentation tests on API 26 minimum and current Android release, plus at least two physical devices.
- Two-account tests: registration, friend request, DM, group membership change, verified device, encrypted image/video/file, forward, status expiry, block/delete, offline sync, notification privacy and recovery.
- Inspect server DB/object storage and network captures: no plaintext messages, passkeys, media or recovery secrets.
- Run OWASP MASVS/MASTG checks, dependency/SBOM scan, static analysis, dynamic testing and independent cryptographic/security review.

## Current verified state
- Backend Node test suite: 50/50 passing. The suite includes static contract/security tests, not full live HTTP integration coverage.
- Node syntax checks pass for server, database and push modules.
- `ChatCipher`, `NewgenApi` and `MessageSharing` compile against lightweight Android/Firebase/JSON stubs. The current expanded Compose source has no parser-level syntax diagnostics, but has not been type-checked against Android/Compose dependencies; Keystore session-store stub checks passed earlier.
- Android UI source now uses live APIs for auth, direct/group messages, friends/requests, text statuses/replies, recovery, account deletion, direct text forwarding, expiry controls, block management and encrypted attachment upload/download; hard-coded sample conversations were removed.
- SQLite schema/migration statements were executed with Python SQLite.
- Matrix SDK is not integrated; no Matrix homeserver is deployed.
- No runtime PostgreSQL migration, private object storage, public domain, TLS endpoint or Firebase credentials are configured.
- Dependency installation timed out. Gradle, Android SDK, Docker, emulator and ADB are unavailable in this execution environment; no APK build, Docker image, live backend integration, FCM delivery or physical two-device test is claimed.
- Status UI remains text-first. Group key management, Office media rendering, attachment forwarding and richer privacy controls remain incomplete.
- Independent cryptographic/security review remains a release requirement.

## Research references
- Matrix Rust SDK says it is production-ready and used by Element X: https://github.com/matrix-org/matrix-rust-sdk
- Matrix encryption module documents device verification, cross-signing, key backup and room key lifecycle: https://matrix-org.github.io/matrix-rust-sdk/matrix_sdk/encryption/index.html
- Matrix Rust SDK Android/Kotlin FFI API evolves; Element X is the working integration reference: https://github.com/element-hq/element-x-android
- Element X integration tests cover multiple sessions, encrypted sends, backup and verification: https://github.com/element-hq/element-x-android/blob/develop/docs/integration_tests.md
- Matrix specification recommends cross-signing and alerts for key changes: https://spec.matrix.org/unstable/client-server-api/index.html
- FCM Android setup and runtime notification permission: https://firebase.google.com/docs/cloud-messaging/android/get-started

# Implementation status — 2026-11-23

## Connected source features

### Android
- Username/password registration/login and one-time recovery-code password reset.
- Session token encrypted in Android Keystore-backed AES-GCM storage; restore validates `/api/me`.
- Live username search, friend request create/accept/decline, friend list.
- Direct and group text message send/history using the current local AES-GCM passphrase envelope.
- Per-chat passphrase gate, lock/back/background cleanup of key arrays, plaintext transcript state and app-private decrypted media cache; six-second history refresh while unlocked.
- Group creation from selected accepted friends. Group passkey distribution is manual/out-of-band and not a secure protocol key-management implementation.
- Text status create/reveal, view receipts, reactions, encrypted replies and reply retrieval.
- Recovery code generation, account deletion, logout/offline, FCM token registration/unregistration.
- `FLAG_SECURE`, cleartext HTTP disabled, notification previews are generic/private.

### Backend
- JWT/bcrypt authentication; auth requests rate-limited, password inputs constrained to bcrypt's UTF-8 size limit.
- Current-user DB check on protected requests; token-version migration revokes sessions after password recovery and makes deleted-account tokens invalid.
- Username discovery/friend request workflow, block/unblock API.
- Direct/group opaque ciphertext relay, direct-message expiry, read/delivery receipts and client-side forward endpoint.
- Status 24-hour expiry, views, reactions, encrypted replies and owner/friend-authorized status details.
- Opaque encrypted-media endpoints with direct-recipient and group-membership access control plus MIME/size bounds.
- Presence/typing endpoints, account recovery/deletion, optional generic FCM pushes.
- SQLite schema/migrations, parameterized SQL, request validation, Helmet, rate limits, Docker non-root runtime.

### Newly connected controls
- Visible direct text-message forwarding: client decrypts with source-chat passkey, re-encrypts with selected destination-chat passkey and sends a fresh envelope. Attachment forwarding remains disabled because it requires a destination-scoped media copy.
- Chat UI file picker and encrypted direct/group attachment upload/download. The plaintext picker cap is 4 MB. Image, first-page PDF and text previews, audio playback and MP4 video playback use app-private cache. Opening the system picker locks the chat but preserves the pending URI; re-unlock triggers encryption/upload. A generation guard discards an upload if the chat is locked before the media message is sent. Cache is cleared on lock/background. Office rendering remains incomplete.
- Direct and group message auto-expiry controls and server-side expiry purging.
- Block from a direct chat and a Settings list to unblock blocked users.

## Not complete / not production verified

- Matrix/Signal-grade E2EE, forward secrecy, identity/device verification, cross-signing, key backup and secure multi-device/group key distribution.
- Office document rendering, encrypted thumbnails/streaming, attachment forwarding and richer media controls. Other unsupported file types remain available only as decrypted bytes in app-private cache, without a renderer.
- Image/GIF/video status creation/viewing; current status UI is text-first.
- Group-message forwarding, attachment forwarding and status forwarding.
- Typing, presence and delivery/receipt controls fully surfaced in the UI; privacy preferences/last-seen controls; report/abuse workflows; rich chat settings.
- Runtime PostgreSQL migration and object storage; public domain, TLS deployment, backups, monitoring and abuse operations.
- Firebase owner configuration and live delivery test.
- Full Gradle build, APK signing, emulator/two-device tests, runtime integration suite and independent security audit.

## Validation snapshot

- Backend Node test suite: 50/50 pass. This suite includes static contract/security tests and is not a full HTTP integration test.
- `node --check`: server, database and push modules pass.
- Kotlin compilation of `ChatCipher`, `NewgenApi` and `MessageSharing` passes against lightweight Android/Firebase/JSON stubs. The expanded Compose screen has no parser-level diagnostics but has not had a classpath-backed Android/Gradle compile in this environment. Earlier Keystore session-store stub checks passed.
- SQLite schema and migrations validated with Python sqlite3.
- `npm install` timed out in this environment. Gradle, Android SDK, Docker, emulator and ADB are unavailable here; therefore no full backend runtime, Android APK, Docker image, FCM delivery or physical-device test is claimed.

Do not label this project production-ready or advertise the current custom passphrase encryption as audited E2EE.

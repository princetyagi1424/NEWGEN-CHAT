# NEWGEN CHAT — Implementation status

Updated: 2026-11-23  
Working branch: `fix/web-device-key-persistence`

## Connected source features

### Android

- Username/password registration/login and one-time account recovery-code password reset.
- Keystore-backed session token storage with session validation.
- Username search, friend requests, friend list, block/unblock controls.
- Direct and group text messaging using the existing local AES-GCM/PBKDF2 passphrase prototype.
- Per-chat passphrase gate with lock-on-back/background and private media cache cleanup.
- Direct/group encrypted attachment relay with bounded picker reads and selected previews.
- Text-first statuses with expiry, views, reactions and encrypted replies.
- Generic/private FCM notification source integration; live delivery requires Firebase owner configuration.
- Group creation/member management foundations; secure group key distribution and full admin UX remain incomplete.

### Backend

- JWT/bcrypt authentication, token-version revocation, request validation, Helmet, rate limiting and parameterized SQLite operations.
- Friend requests, direct/group ciphertext relay, message expiry and read/delivery receipts.
- Group membership checks and owner/admin/member role storage.
- Blocks, status lifecycle/reactions/replies/views, encrypted media ACLs, presence and short-lived typing indicators.
- One-time recovery codes, account deletion and generic data-only FCM dispatch.
- Device public-key registration and opaque per-device key-envelope relay primitives. These are not a complete E2EE/device-verification protocol.

### Web

- React/TypeScript/Vite app with username/password auth, friend requests, conversation list, direct/group conversation APIs, message timeline and local passphrase gate.
- PIN setup/change and in-chat PIN verification endpoint with bcrypt hashes.
- Browser device identity persistence with non-extractable private key storage in IndexedDB.
- Web access tokens are tab-scoped in sessionStorage (still readable by same-origin JavaScript). New Web JWTs carry `jti`; authenticated Vercel APIs check server-side revocation, with `/api/auth/logout` and `/api/auth/logout-all` endpoints. Apply migration `007_web_session_revocation.sql` before deploying these APIs.
- Unimplemented call, attachments and More options controls are disabled. Stories are clearly marked unavailable; publishing is not wired up.

## Security fixes in the current work branch

- Fixed WebCrypto device-key creation: the previous implementation generated a non-extractable ECDH pair and then tried to export its private key, causing first-time device setup to fail. The private key is now transiently exported in memory, re-imported as non-extractable, and the temporary byte buffer is zeroed.
- Removed Supabase RLS policies that allowed authenticated clients to self-insert conversation membership or update their own role. Browser membership reads are restricted to the caller's own row to avoid recursive RLS evaluation.
- Removed direct browser INSERT/UPDATE/DELETE access for conversations, membership rows and messages; mutations use authenticated server APIs.
- Fixed the Chat PIN handler's malformed success path that had placed the verification response inside a line comment.
- Replaced the PIN check-then-insert race with a transaction-scoped PostgreSQL advisory lock and account-wide quota. Eight attempts are allowed per account in a 15-minute window, across IPs/devices; successful verification clears that account's attempt window.
- Added server-side JWT session revocation: normal logout revokes the current jti, logout-all increments the token version, and both remove push registrations / mark offline as appropriate. Password recovery now also clears all registered push routes and presence atomically while revoking all sessions.
- Android explicit logout/account deletion clears the local SessionStore, encrypted ChatPasskeyStore and decrypted private media cache. A failed session restore clears only the token so temporary connectivity failure cannot destroy local message keys.
- Hardened group ownership: only the owner can transfer ownership or remove another admin; the current owner cannot be removed before transfer.
- Added regression tests for these cases and explicit Web TypeScript validation in CI.
- Disabled Web actions that were shown but had no implementation.

## Latest verified CI snapshot

Workflow: [GitHub Actions run 45238767834](https://github.com/princetyagi1424/NEWGEN-CHAT/actions/runs/45238767834)

- Backend: **67 tests passed, 0 failed**.
- Web: **TypeScript validation passed** and **Vite production build passed**.
- Android debug APK build: **in progress at the time of this status snapshot**. Do not mark it passed until the job and artifact upload complete.

The earlier CI run for commit `1e92ead0285db6068581edcd44276fb0d19a8062` completed all three jobs successfully, but a later PIN hardening change is being validated separately.

## Not complete / not production verified

- Matrix/Olm/Megolm or another reviewed E2EE protocol; forward secrecy, device verification, cross-signing, backup/recovery, room key rotation and multi-device sync.
- A complete end-to-end device-key distribution/recovery flow for Web and Android.
- Web stories publishing (text/image/video/GIF), encrypted Web attachments, and WebRTC audio/video calls with STUN/TURN.
- Full Android/Web group owner/admin screens, invitation lifecycle, permissions and moderation parity.
- Web HttpOnly-cookie/BFF sessions with CSRF protection.
- Full two-account/two-device live integration tests, hosted Supabase RLS tests, penetration testing and independent cryptographic review.
- Production PostgreSQL migration for the custom Node API, private object storage, backups/restore drills, public domain/TLS, monitoring and operational abuse controls.
- Live FCM delivery and TURN service are blocked on owner-managed credentials/infrastructure.

## Required hosted setup

Before validating the hosted Web PIN/security changes, apply the relevant Supabase migrations in order: the base schema/PIN migration if not already present, then `004_membership_rls_hardening.sql`, `005_atomic_chat_pin_rate_limit.sql`, and `006_server_only_conversation_writes.sql`. A committed migration is not proof that the hosted database has been changed.

Do not advertise this codebase as a production-ready secure messenger until the E2EE protocol, hosted migrations, two-device tests, live infrastructure and independent review are complete.

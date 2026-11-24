# NEWGEN CHAT — Implementation status

Updated: 2026-11-24  
Branch: `main`  
Merged PR: [#3](https://github.com/princetyagi1424/NEWGEN-CHAT/pull/3)  
Main commit: `08b66bab3cdc6d26fa4cdd154eb04865d4107039`

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
- Web access tokens are tab-scoped in `sessionStorage` (still readable by same-origin JavaScript); each JWT has a `jti`, protected Vercel APIs reject revoked tokens, and `/api/auth/logout` plus `/api/auth/logout-all` provide server-side revocation. Apply `007_web_session_revocation.sql` before deployment.
- Web login, registration and password recovery use atomic account-and-network attempt limiting through migration `008_atomic_web_auth_rate_limit.sql`.
- Supabase profile enumeration and browser receipt writes are blocked by migration `009_profile_and_receipt_rls_hardening.sql`.
- The Web client now has a confirmed “Log out all devices” action; successful logout-all invalidates every token version and clears local browser device metadata.
- Profile editor supports display name, bio and profile-photo updates; images use a private Supabase Storage bucket and short-lived signed URLs.
- Web Stories supports photo/text publishing, friend-only reads, a story viewer, owner deletion and 24-hour expiry. Story media is held in private storage; story content is not end-to-end encrypted in this browser MVP.
- Unimplemented call, chat attachments and More options controls remain disabled.

## Security fixes in the current work branch

- Fixed WebCrypto device-key creation: the previous implementation generated a non-extractable ECDH pair and then tried to export its private key, causing first-time device setup to fail. The private key is now transiently exported in memory, re-imported as non-extractable, and the temporary byte buffer is zeroed.
- Removed legacy direct-browser Supabase policies and revoked all anon/authenticated table privileges for devices, conversations, memberships, messages, receipts and push subscriptions. The browser chat client uses authenticated Vercel APIs and Realtime Presence only; service-role access remains server-side.
- Added covering indexes for the previously unindexed foreign keys used by membership, conversation, message, request and story-view queries.
- Profile and story tables remain RLS-enabled with direct browser access revoked; uploads and signed media reads run through authenticated Vercel APIs.
- Fixed the Chat PIN handler's malformed success path that had placed the verification response inside a line comment.
- Replaced the PIN check-then-insert race with a transaction-scoped PostgreSQL advisory lock and account-wide quota. Eight attempts are allowed per account in a 15-minute window, across IPs/devices; successful verification clears that account's attempt window.
- Added server-side JWT session revocation: normal logout revokes the current jti, logout-all increments the token version, and both remove push registrations / mark offline as appropriate. Password recovery now also clears all registered push routes and presence atomically while revoking all sessions.
- Android explicit logout/account deletion clears the local SessionStore, encrypted ChatPasskeyStore and decrypted private media cache. A failed session restore clears only the token so temporary connectivity failure cannot destroy local message keys.
- Hardened group ownership: only the owner can transfer ownership or remove another admin; the current owner cannot be removed before transfer.
- Added regression tests for these cases and explicit Web TypeScript validation in CI.
- Web JWTs now use `jti` revocation across all protected Vercel APIs; login/register/recovery use atomic account/network quotas; profile enumeration and direct receipt writes are blocked by Supabase RLS migrations 007–009.
- Disabled Web actions that were shown but had no implementation.

## Latest verified main CI snapshot

Workflow: [GitHub Actions run 45352686459](https://github.com/princetyagi1424/NEWGEN-CHAT/actions/runs/45352686459)  
Validated main commit: `08b66bab3cdc6d26fa4cdd154eb04865d4107039`

- Backend: **81 tests passed, 0 failed**.
- Backend dependency audit: passed.
- Web dependency audit: passed, **0 vulnerabilities reported**.
- Web TypeScript validation: passed.
- Web production build: passed.
- Android: `:app:assembleDebug` passed; debug APK artifact upload passed.

The Web production deployment for this commit is [READY](https://newgen-chat-eagle-9922.vercel.app). The hosted Supabase project has migrations `010_profile_stories_private_media_and_rls` and `011_server_only_data_access_and_fk_indexes` applied; both media buckets are private. Live page and auth-route availability were checked, but a signed-in profile/story end-to-end user journey and physical two-device exchange were not run. CI and deployment do not prove Firebase delivery, calls or production-grade E2EE.

## Not complete / not production verified

- Matrix/Olm/Megolm or another reviewed E2EE protocol; forward secrecy, device verification, cross-signing, backup/recovery, room key rotation and multi-device sync.
- A complete end-to-end device-key distribution/recovery flow for Web and Android.
- Web video/GIF stories, story reactions/replies/view receipts, encrypted Web stories and encrypted Web attachments; WebRTC audio/video calls with STUN/TURN.
- Full Android/Web group owner/admin screens, invitation lifecycle, permissions and moderation parity.
- Web HttpOnly-cookie/BFF sessions with CSRF protection.
- Full two-account/two-device live integration tests, hosted Supabase RLS tests, penetration testing and independent cryptographic review.
- Production PostgreSQL migration for the custom Node API, private object storage, backups/restore drills, public domain/TLS, monitoring and operational abuse controls.
- Live FCM delivery and TURN service are blocked on owner-managed credentials/infrastructure.

## Required hosted setup

Before validating the hosted Web PIN/security changes, apply the relevant Supabase migrations in order: the base schema/PIN migration if not already present, then `004_membership_rls_hardening.sql`, `005_atomic_chat_pin_rate_limit.sql`, `006_server_only_conversation_writes.sql`, `007_web_session_revocation.sql`, `008_atomic_web_auth_rate_limit.sql`, and `009_profile_and_receipt_rls_hardening.sql`. A committed migration is not proof that the hosted database has been changed.

Do not advertise this codebase as a production-ready secure messenger until the E2EE protocol, hosted migrations, two-device tests, live infrastructure and independent review are complete.

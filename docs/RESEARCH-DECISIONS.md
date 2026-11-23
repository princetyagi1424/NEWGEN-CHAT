# NEWGEN CHAT — Security and architecture research (2026-11-23)

## Findings

### 1. Messaging cryptography
The current `ChatCipher` helper (AES-256-GCM + PBKDF2) is a local prototype envelope, not a full multi-device messenger protocol. It does not implement identity keys, device verification, forward secrecy, key rotation, group membership key changes, or safe multi-device backup.

**Recommended protocol path:** Matrix Rust SDK / Matrix E2EE rather than custom protocol code. The upstream project describes the SDK as production-ready and used by Element X, and its encryption module documents device-level key distribution, room-key lifecycle, encrypted local storage and device verification. The project is Apache-2.0. Pin and validate an exact FFI release before integrating; do not depend on `main`.

Current research snapshot:
- Matrix Rust SDK: release 0.19.1; Apache-2.0.
- FFI changelog shows Android/Kotlin bindings and platform-specific changes, including Android TLS and JVM compatibility work.
- The FFI API evolves and includes breaking changes, so integration must pin both generated bindings and native libraries together.

### 2. Why Matrix is not wired into this build yet
The current backend has its own username/password accounts, SQLite schema and custom ciphertext relay. A Matrix homeserver has its own server name, account/session model, device IDs, room membership, event sync and key lifecycle. Adding only a Kotlin dependency would not turn this custom API into Matrix E2EE and could create two competing identity/message stores.

A real integration needs:
1. A stable public homeserver name/domain and HTTPS endpoint.
2. Synapse (or another Matrix homeserver) with PostgreSQL and persistent media/key state.
3. A deliberate identity mapping between NEWGEN usernames and Matrix IDs.
4. A migration decision for the existing custom account and message APIs.
5. FFI artifacts pinned to one release and verified on the target ABIs/devices.
6. Cross-device verification and recovery UX tests.

### 3. Per-chat passkeys
A user-entered chat passkey must remain local. It must never be sent to the API or used as the Matrix account password. The Matrix SDK owns protocol encryption keys and device verification. NEWGEN's per-chat passkey should be an additional local UI/key-access gate, designed around the SDK's local encrypted store/key lifecycle—not a replacement for protocol encryption.

### 4. Sharing / forwarding
In-app forwarding is distinct from Android external file sharing:
- In-app message forward: source device decrypts using source-chat authorization, re-encrypts for destination chat, then uploads only the new envelope.
- External file share: only after explicit user action, use Android `FileProvider` content URIs with temporary read grants and narrowly scoped paths. Do not expose app-private database/cache directories.
- Current app includes the in-app forward use case and API contract, but no visible share button or full chat timeline integration.
- Media/file forwarding is not implemented.

### 5. Android security baseline
- `FLAG_SECURE` is enabled, but cannot stop external cameras or compromised/rooted devices.
- `allowBackup=false` and HTTPS-only API URL are configured.
- Backend `.env`, SQLite data and node_modules are now Git-ignored.
- Docker uses separate build/runtime stages and runs as the unprivileged Node user.
- Proxy trust is disabled unless explicitly configured for one trusted reverse-proxy hop.
- OWASP MASVS storage/network requirements should guide subsequent testing; sensitive data leakage, key storage and TLS behavior must be verified on real devices.

## Implemented in this audit
- Android registration/login HTTP client, configured by `NEWGEN_API_BASE_URL`.
- Android client-side forwarding use case: decrypt source envelope and encrypt with destination chat passkey before API call; clears passphrase character arrays in `finally`.
- Backend forwarding requires caller participation in source conversation and accepted friendship with destination; exact reuse of the source ciphertext envelope is rejected.
- Username search escapes SQL LIKE wildcard characters.
- Malformed JSON and oversized request bodies return 400/413.
- Git secret exclusions, Docker build/runtime separation and opt-in one-hop proxy trust.
- `FLAG_SECURE` set on the Android activity.

## Still not release-ready
- Core Android UI flows for login, friend requests, direct/group text chat, text status, direct-message forwarding, block management, message expiry and encrypted attachment upload/download are connected to the custom API.
- Attachment/group forwarding, story image/GIF/video, full presence/typing and rich privacy/report controls are still incomplete.
- No Matrix FFI/homeserver client integration; therefore no production-grade multi-device E2EE claim. The `server/` folder is only a deployment base and is not integrated into the Android app's active message transport.
- No full Office viewer, media thumbnails/streaming or full external file sharing.
- Account recovery code, push registration and delete-account workflows exist in source, but live Firebase delivery and end-to-end server validation are not established.
- No Gradle/Android SDK available in the build environment; no APK or Android compile verification.
- No end-to-end two-device, penetration, backup/restore, accessibility or device-ABI testing.

## Release gate
Do not distribute this as a secure production messenger until the Matrix integration is complete, the Android UI is wired to real message data, media and sharing are tested, the homeserver is deployed on a stable HTTPS domain, two real devices verify each other's identities and exchange encrypted content, server-side inspection confirms ciphertext-only message storage, and an independent security review is completed.

## Primary references
- Matrix Rust SDK: https://github.com/matrix-org/matrix-rust-sdk
- Matrix Rust SDK FFI changelog: https://github.com/matrix-org/matrix-rust-sdk/blob/main/bindings/matrix-sdk-ffi/CHANGELOG.md
- Matrix E2EE module: https://docs.rs/matrix-sdk/latest/matrix_sdk/encryption/
- Android built-in Kotlin / AGP 9 migration: https://developer.android.com/build/migrate-to-built-in-kotlin
- Android secure file sharing: https://developer.android.com/training/secure-file-sharing
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- OWASP MASVS Storage: https://mas.owasp.org/MASVS/05-MASVS-STORAGE/
- OWASP MASVS Network: https://mas.owasp.org/MASVS/08-MASVS-NETWORK/


## Additional API feature implementation (2026-11-23)
- Added hashed, one-time account recovery codes. These recover only the login password and intentionally do not claim to recover E2EE keys.
- Added authenticated account deletion.
- Added opaque encrypted media relay with accepted-friend recipient ACLs, strict MIME allowlist and 6 MB ciphertext limit. A production deployment should move blobs to private object storage with short-lived signed access and quota/abuse controls.
- Added friend/group-authorized short-lived typing indicators, presence heartbeat, direct-message expiry, and status view receipts.
- Added Android API methods for username search, direct-message send/history, group creation, encrypted status, encrypted media upload, presence and typing. Screens are not all connected yet.
- Matrix SDK Android bindings: stable release `sdk-v26.11.17` (released 2026-11-17) was available at the time of research; use a pinned stable release rather than nightly. The Kotlin binding repository says its API follows Element X and can evolve; the FFI changelog shows breaking changes across releases. Do not add an unverified SDK dependency without compiling and exercising its session, sync, timeline and cross-signing APIs.

- Kotlin media crypto helpers now support arbitrary byte arrays for authenticated encrypted media payloads; the API client exposes status listing/reactions/replies/views and encrypted media retrieval.
- Expired statuses and encrypted media are purged when accessed; direct-message history purges expired message rows. Blocking also removes the block pair's direct media ACLs.

# NEWGEN CHAT — Validation report (2026-11-23)

## Source changes completed in this pass

- Replaced the hard-coded sample chats with Compose flows wired to the current API: authentication, session restore, direct/group chat history and send, friends/search/request acceptance, text statuses, status reactions/replies, recovery code, logout and account deletion.
- Added device-bound API token storage using an Android Keystore AES-GCM key. Tokens are deleted from preferences on logout and invalid-session restoration.
- Added chat lock cleanup for passphrase char arrays and decrypted transcript state; unlocked direct/group chat history refreshes periodically.
- Added FCM token re-registration after session restore and token rotation handling; logout attempts to unregister the active FCM token.
- Hardened API authentication with a database-backed token version. Password recovery increments the version, revoking all old sessions; protected API requests reject deleted/revoked accounts.
- Added an authorized status-detail endpoint that exposes reaction rows and still-encrypted replies, and connected encrypted replies in the status UI.
- Prevented a group from being left without an administrator.
- Added visible direct-text forwarding with local source decrypt/destination re-encrypt.
- Added direct and group message auto-expiry; group message schema migration and history cleanup are included.
- Added direct-chat block UI and Settings unblock list.
- Added encrypted media picker/upload/download flows, direct-recipient/group-member ACLs, app-private previews for images, the first PDF page and text files, plus in-app audio/MP4 playback. A pending picker URI survives the background-lock flow and uploads only after re-unlock; a generation guard removes an uploaded blob if the chat locks before its message is sent. Office rendering remains unsupported.
- Moved PBKDF2/AES work off the UI thread, track temporary chat-operation passkeys for wiping on lock, and wipe mutable plaintext media/forwarding buffers after encryption.
- Fixed an invalid Dockerfile line continuation and made fire-and-forget push dispatch failures non-fatal.
- Added source-contract tests for the new session, status, group-admin, UI and Docker behaviors.

## Checks observed

| Check | Result | Scope |
|---|---:|---|
| Node tests | 50/50 pass | Mainly static contract/security checks; includes the new lifecycle/picker regression contract |
| `node --check` | Pass | `server.js`, `db.js`, `push.js` |
| Kotlin compiler | Core modules pass; Compose parser pass | `ChatCipher`, `NewgenApi` and `MessageSharing` compile with lightweight Android/Firebase/JSON stubs. No Compose parser diagnostics; full Compose type-check/build still needs Android/Compose SDK classpath. |
| SQLite schema | Pass | Fresh schema and group-expiry/group-media columns executed and validated with Python sqlite3 |
| Android Gradle build | Not run | Gradle/Android SDK absent; added Compose/lifecycle/media UI changes are not compile-verified here |
| Backend HTTP integration | Not run | Dependency installation timed out; no node_modules |
| Docker image build | Not run | Docker unavailable |
| Emulator / physical device | Not run | No emulator/ADB/device access |
| FCM delivery | Not run | Firebase config and service credentials not supplied |
| Production security audit | Not run | Requires independent review and deployed environment |

## Release status

**Development MVP source, not production-ready.** There are still release blockers: reviewed Matrix/Signal protocol E2EE, device verification/key backup, robust group key distribution/rotation, full Office document rendering and story media UX, production PostgreSQL/object storage, public HTTPS deployment, Android build/signing, two-device QA, FCM live test and independent security assessment.

Do not distribute this as a secure production messenger or use it for sensitive/private communications until those gates are closed.

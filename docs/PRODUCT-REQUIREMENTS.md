# NEWGEN CHAT — Product requirements and implementation blueprint

This document consolidates the user's original product requirements and selected privacy/social options. It is a build plan, not a claim that every feature is already shipped.

## Product direction
A privacy-first messaging and social app combining WhatsApp-style communication with Instagram-style stories/discovery. Primary client is Android (Kotlin/Jetpack Compose); the current React/Vite web client is a companion client and must not claim feature parity until implemented.

## 1. Account and identity
- Signup/login with unique username (3–24 characters, letters/numbers/underscore) and password.
- No mandatory email address or phone number.
- Signup includes a security question and answer.
- Password recovery verifies the security answer, rate-limits attempts, resets password and revokes existing sessions.
- Usernames are globally unique and case-normalized.
- Search users by username; send, accept, decline and cancel connection requests; show accepted contacts.

## 2. Two separate secrets
- Account password authenticates the account.
- Chat passkey is a separate local secret used to unlock the readable view of encrypted conversation content.
- Chat passkey must never be sent to the API, database, analytics, crash reports or push notifications.
- A conversation may have its own passkey; the sender and recipient must establish the same secret through a trusted out-of-band exchange unless a reviewed device-key protocol is integrated.
- Chat opens locked by default. Locked timeline renders a constant mask (e.g. ******), not plaintext or previews.
- Entering the correct passkey unlocks the current conversation; entering it again locks it.
- Leaving the conversation, pressing Back, backgrounding/closing the app, logout, or process restart clears the in-memory unlocked state and returns to locked mode.
- No separate hidden Private Space and no configurable auto-lock settings. Manual toggle plus mandatory lock on leaving/background are retained.

## 3. Cryptography and recovery
- Do not invent a messaging protocol. Target a maintained, reviewed E2EE implementation (Matrix Rust SDK on Android is the documented target).
- Current custom AES-GCM/passphrase prototype is not Signal/Matrix-grade E2EE and must not be advertised as audited E2EE.
- Passkey unlock is a local display/key-access layer over protocol-managed encryption; toggling locked/unlocked does not re-encrypt server-side messages.
- Use per-device identity, device verification, room key rotation, forward secrecy, cross-signing and protocol-managed group key distribution.
- Security-question account recovery can reset account credentials, but it cannot magically reconstruct forgotten E2EE keys.
- Chat-history recovery requires a separate encrypted key-backup/recovery mechanism. Prefer a high-entropy recovery code/phrase; do not rely on a low-entropy security answer alone. Explain that if all recovery material is lost, old messages are unrecoverable.
- Store long-term private keys in Android Keystore-backed storage where supported. Never store plaintext passkeys.

## 4. Encrypted content
- Text, emoji, reactions, GIFs, images, video, audio, documents, and other attachments must be encrypted before leaving the sender device.
- Server and storage receive ciphertext only.
- Decrypt only after local chat unlock; decrypted media stays in app-private cache and is cleared on lock, back, background, logout and expiry.
- Secure downloads stay in app-private storage by default and do not automatically enter the shared gallery. Any export must be explicit.
- Support image/GIF/video/audio/file preview in-app; unsupported formats should be clearly identified rather than silently shown as plaintext.
- Forwarding must decrypt locally and re-encrypt for the destination conversation; never reuse source ciphertext under another chat's key.

## 5. Status / stories
- Instagram/WhatsApp-style 24-hour stories: text, image, video and GIF.
- Story media and captions are encrypted at rest and in transit.
- Locked stories show a masked/locked preview; unlocking with the relevant chat/story passkey reveals the content.
- Replies/comments are encrypted. A locked reply thread stays masked until locally unlocked.
- Track views/reactions without exposing story plaintext in server metadata.
- Current implementation is text-first; image/GIF/video status creation/viewing remains a required feature.

## 6. Messaging and social
- One-to-one chats and group chats.
- Connection requests and accepted-friend model.
- Online/offline status, last seen, typing indicator, sent/delivered/read receipts.
- Delete for me / delete for everyone, pin/archive chats.
- Group owner/admin roles and member permissions.
- Block/unblock and report/abuse workflow.
- Search and discovery controls that avoid exposing unnecessary profile information.

## 7. Selected privacy options (Option E)
- Hidden chats and Private Space were selected in the earlier option list, but the later explicit instruction removed hidden Private Space; do not implement a hidden Private Space.
- Hidden notification previews.
- Disappearing messages.
- Screenshot/privacy protection where platform supports it.
- Copy-message permission controls.
- Last-seen privacy and online-status privacy.
- Media privacy.
- Screenshot prevention is best-effort: it cannot prevent a second camera or a compromised device.

## 8. Selected social/group options (Option F)
- Online/offline and last seen.
- Typing indicator.
- Delivered/read receipts.
- Delete for me/everyone.
- Pin/archive chats.
- Group chats, admins and member permissions.
- Block/report.
- No additional auto-lock settings; lock on leaving/background is mandatory behavior.

## 9. UI direction
- Blend WhatsApp's clear chat list, conversation timeline, composer and status affordances with Instagram's story rings, visual profile cards, media-first story viewer and bottom navigation.
- Premium, responsive dark-first interface with optional light theme; strong contrast and accessible tap targets.
- Main navigation: Chats, Stories, Requests/Discover, Groups, Profile.
- Chat header: contact identity/presence, lock state, call/action affordances.
- Locked chat view: masked message bodies and a prominent local unlock control.
- Story viewer: full-screen media, masked locked state, encrypted reply composer.
- Avoid clutter and avoid a separate hidden Private Space screen.

## 10. Current implementation truth
- Android prototype has username/password auth, recovery code, friend requests, text chat, passphrase gate, text statuses/replies, some encrypted media handling, private media cache, and selected privacy behaviors.
- Web client has basic username/password auth, user search, direct/group API routes and encrypted text prototype, but lacks the full passkey-gated UI and social/story parity.
- Current Supabase web message implementation has legacy raw conversation keys in membership rows. This must be migrated before claiming the web passkey is private or production E2EE.
- Matrix SDK is not integrated; there is no production-grade cross-device/group E2EE yet.
- The current implementation is a prototype and needs integration tests, two-device tests and independent security review before release.

## 11. Delivery order
1. Security foundation: choose canonical messaging protocol; eliminate server-visible raw conversation keys; define device identity, passkey wrapping and recovery semantics.
2. Account flows: dynamic security question, unique username, password recovery, session revocation.
3. Core messaging: connection requests, direct/group chat, receipts, typing, delete/expiry, block/report.
4. Passkey UX: locked-by-default timeline, unlock/lock toggle, lock on back/background, no passkey transmission.
5. Encrypted media lifecycle: encrypted upload/download, in-app previews, private cache cleanup and secure export policy.
6. Stories: image/video/GIF/text stories, views, reactions and encrypted replies.
7. WhatsApp + Instagram visual redesign and responsive navigation.
8. Verification: backend/API integration tests, Android builds, web builds, two-account/two-device tests, network/database plaintext inspection and independent security review.

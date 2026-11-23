# Proposed architecture

## Android client

Kotlin + Jetpack Compose UI. A native Matrix Rust SDK Android binding is the leading E2EE candidate because it is maintained for Android use and under Apache-2.0. Pin a specific release only after validating current API stability, minimum Android version, build toolchain, and license notices.

## Messaging infrastructure

Matrix homeserver (Synapse or another compatible server) with PostgreSQL for durable server state. Synapse deployment needs a stable server name/domain, HTTPS reverse proxy, PostgreSQL, secure secrets and operational monitoring. A free-tier hobby host may sleep or impose storage/egress limits; do not promise always-on free service.

## Application-specific services

A small service may handle username directory, friend-request workflows, rate limiting and abuse reports. It must not receive plaintext messages or chat passkeys. Directory visibility and metadata retention need explicit privacy rules.

## Per-chat passkey behavior

Each conversation has local key material managed by the E2EE client. The user's chat passkey locally unlocks a wrapping key that unwraps the local conversation display/decryption material. Different chats can use different passkeys. The same chat passkey can toggle the local UI between ciphertext representation and plaintext representation. This is a presentation/access-control feature on the user's device; it does not re-encrypt the server's stored messages when the user toggles the view.

## Important protocol distinction

Matrix E2EE protects message content between devices, but a custom requirement to show ciphertext in the timeline and then reveal plaintext with a local passkey is an additional client-side display/key-wrapping layer. It must be designed around the SDK's key lifecycle rather than bypassing or reimplementing the protocol.

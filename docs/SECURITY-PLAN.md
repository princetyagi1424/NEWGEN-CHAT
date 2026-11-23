# NEWGEN CHAT security plan

## Threat model

Protect message contents, attachments, account credentials, device keys and recovery secrets against network observers, database readers, storage compromise and unauthorized devices. The system cannot fully prevent an authorized recipient from photographing, copying or recording content on a compromised device.

## Cryptographic design constraints

- Use a maintained, reviewed E2EE protocol implementation; do not design custom cryptography.
- Use unique device identities and device verification.
- Keep long-term private keys in Android Keystore-backed storage where supported.
- Use a memory-hard password KDF for account password verification on the server; never store plaintext passwords.
- Derive a wrapping key from the user's chat passkey using a reviewed KDF with a unique random salt and calibrated parameters. Use it only to wrap local conversation key material, not as the message key.
- Store only wrapped key material and salts in app-private storage; never send the passkey to the server.
- Use authenticated encryption and fresh nonces as required by the selected protocol.
- Define passkey reset/recovery honestly: losing all key material and recovery methods can make old content unrecoverable.
- For groups and multi-device sessions, rely on protocol-managed room/session key distribution and rotation.

## Media

- Encrypt media on the sender device before upload.
- Store ciphertext only on the media server.
- Authenticate media metadata and content hashes.
- Decrypt only after local authorization, stream to an app-private cache, and remove temporary plaintext after viewing/playback.
- Do not request broad storage permissions. Do not export to shared gallery unless a future explicit export flow is designed and clearly disclosed.

## Privacy and metadata

- Avoid phone number, contacts, location and ad identifiers.
- Minimize IP/device metadata retention and document what the homeserver necessarily sees.
- Do not claim metadata anonymity: a messaging server can still observe account identifiers, connection times, IP addresses and routing/delivery metadata unless separately mitigated.
- Keep message bodies, media plaintext, passkeys and recovery keys out of logs, crash reports and analytics.

## Release gates

No public beta until authentication, E2EE, device verification, recovery, media protection, access control, TLS, abuse prevention, deletion/retention and backup behavior have automated tests and a security review.


## Message sharing / forwarding
- Forwarding is a client-side cryptographic operation: the sender device decrypts the source message only after local authorization, then encrypts it again using the destination conversation's independent key.
- The API's `/api/messages/:recipientId/forward` endpoint accepts only a source message ID and a newly encrypted payload. It verifies that the caller participated in the source conversation and is accepted friends with the destination.
- The API never receives plaintext or a chat passkey. Reusing source ciphertext across conversations is prohibited because it could leak key relationships or produce undecryptable content.
- The current Android UI does not yet implement this flow; the endpoint alone does not make sharing available in the app.

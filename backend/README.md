# NEWGEN CHAT API (working development backend)

Node.js 20+ REST API for username accounts, friend requests, ciphertext-only message relay and encrypted status payloads. SQLite is used for a zero-cost local development setup. It is a single-instance MVP database, not a horizontally-scalable production deployment.

## Run locally

```bash
cd backend
cp .env.example .env
# Set JWT_SECRET to a random string of 32+ characters
npm install
npm start
```

Health: `GET http://127.0.0.1:5000/api/health`

## API

- `POST /api/auth/register` `{username,password}` (password >= 10 chars)
- `POST /api/auth/login` `{username,password}`
- `GET /api/me` (Bearer token)
- `GET /api/users/search?q=...`
- `POST /api/friends/requests/:userId`
- `GET /api/friends/requests`
- `POST /api/friends/requests/:requestId/accept|reject`
- `GET /api/friends`
- `POST /api/messages/:recipientId` encrypted payload only; optional `expiresInSeconds`
- `GET /api/messages/:userId`
- `POST /api/messages/:recipientId/forward` accepts a newly encrypted destination payload
- `POST /api/groups` and `/api/groups/:groupId/messages` for group ciphertext relay and expiry
- `POST /api/media`, `GET /api/media/:mediaId`, `DELETE /api/media/:mediaId` for opaque encrypted blobs with direct-recipient or group-member access checks
- `POST /api/status` and `GET /api/status` for encrypted text status payloads
- `/api/blocks`, `/api/users/:userId/block`, plus presence, typing, read receipts and push-token endpoints

Messages, group messages, statuses and media are stored as opaque ciphertext + nonce + salt. The API has no decrypt endpoint and never receives the chat passkey. Client-side encryption must be used before calling these routes. The Android development MVP connects the primary login, friend, direct/group chat, text status, expiry, block, forwarding and encrypted attachment flows; media UX and cryptographic protocol limitations are documented in the root README.

## Important security limits

This backend is a development MVP. Use HTTPS and a reverse proxy before remote use. Configure strict CORS, backups, monitoring, account deletion, abuse controls and retention policy before public deployment. SQLite file is sensitive metadata and must be backed up securely. Username search and relationship metadata are visible to the server. This API does not implement Matrix/Olm/Megolm device-to-device E2EE, device verification or cryptographic key backup. Do not describe it as independently audited or production-ready.


## Privacy-preserving push notifications

FCM delivery is optional until configured. Set `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` to the base64-encoded Firebase service-account JSON in the server secret store (never commit the JSON file). The Android app must be registered in the same Firebase project and its `google-services.json` placed at `app/google-services.json`; this file contains project identifiers, not a service-account private key. The Gradle Google Services plugin is applied only when that file exists.

The API sends data-only FCM events with `kind=new_message` and a random event ID. It never sends message text, sender, room ID, media URL, or ciphertext. Android renders a generic lock-screen-private notification. Users must grant Android 13+ notification permission. Device tokens are authenticated, stored per account, can be removed through `DELETE /api/push/token`, and invalid tokens are pruned after FCM responses. Token refresh is synced on the next successful login.

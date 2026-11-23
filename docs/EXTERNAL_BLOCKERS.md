# NEWGEN CHAT — External blockers and remaining work

Updated: 2026-11-23
Source baseline: `cf19c0cb72391bab82dbe9c8bfdab8ad40238ab4`

| Area | Status | Required next action |
|---|---|---|
| Supabase membership RLS hardening | Implemented in source; hosted DB not verified | Apply `web/database/migrations/004_membership_rls_hardening.sql` in Supabase SQL Editor and test anon/authenticated/service_role behavior |
| Browser device-key creation | Code fix + source regression test | Run in real supported browsers; verify IndexedDB CryptoKey persistence and reload |
| Group ownership transfer | Backend endpoint + static contract test | Add Android/Web admin UI and run live authorization tests |
| Matrix/Olm/Megolm E2EE | Not implemented | Provision stable HTTPS homeserver + PostgreSQL; integrate pinned SDK on Android/Web; migrate identity/messages safely |
| Web encrypted attachments | Not implemented | Design private storage, authenticated ACL, client encryption/decryption and cleanup |
| Web stories (image/video/GIF) | Partial/text-first UI | Implement media pipeline, privacy/audience controls, views, expiry and moderation |
| Audio/video calls | Not implemented | Implement WebRTC signaling and configure STUN/TURN; verify on real networks |
| FCM live delivery | Source integration present; not live-verified | Configure Firebase service account and Android app config; test token rotation and locked-screen privacy |
| Web production sessions | Needs hardening | Replace JS-readable bearer token with HttpOnly Secure SameSite session/BFF and CSRF defense |
| PostgreSQL / production storage | Not implemented for custom Node API | Design and test database repository migration and private object storage |
| Full security verification | Not complete | Run Supabase integration/RLS tests, two-account/two-device tests, MASVS/MASTG checks and independent crypto review |

Never treat a committed migration as applied, a passing build as a runtime test, or a ciphertext envelope as proof of a reviewed E2EE protocol.

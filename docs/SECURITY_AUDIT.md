# NEWGEN CHAT — Security audit snapshot

Date: 2026-11-23
Audited revision: `cf19c0cb72391bab82dbe9c8bfdab8ad40238ab4`
Audit branch: `fix/web-device-key-persistence`

## Findings addressed in this change set

- **Web device identity could fail during first creation.** The ECDH pair was generated non-extractable, then the client attempted to export its private key. WebCrypto rejects that operation. The key is now exported only in memory and immediately re-imported as non-extractable; the temporary byte buffer is wiped before IndexedDB persistence.
- **Web private-key import was extractable.** The PKCS#8 import helper now requests a non-extractable key and wipes its decoded input bytes.
- **Supabase direct conversation/message writes bypassed server validation.** Direct client INSERT policies were removed; conversation creation, member changes and message writes now use authenticated server APIs. The message SELECT policy remains membership-scoped.
- **Supabase membership self-join / self-promotion and recursive visibility policy.** The prior RLS policies allowed an authenticated client to insert itself into a known conversation and update its own membership row, including its role. The bootstrap schema and migration `004_membership_rls_hardening.sql` now make membership writes server-only and let a browser read only its own membership row. This also removes a self-referential RLS policy that could trigger recursive evaluation. Membership details are returned by authenticated server APIs.
- **PIN success response was accidentally inside a comment.** Literal escaped-newline text had commented out the success response and reset. The handler now returns a real JSON response after a successful reset.
- **PIN throttling was vulnerable to concurrent requests.** The previous count-then-insert pattern was not atomic. A transaction-scoped PostgreSQL advisory lock now serializes attempts account-wide across IPs/devices, so forwarded-IP spoofing cannot bypass the limit. PIN-change security-answer checks share the same limit.
- **Group owner could be removed by another admin.** Ownership is now checked against `groups_chat.owner_id`; an owner-only transfer endpoint was added, and removal of the current owner or another admin by a non-owner is rejected.

## Existing security controls observed

- Node API uses Helmet, disables `x-powered-by`, validates request bodies with Zod, parameterizes SQL and uses JWT issuer/algorithm checks plus token-version revocation.
- Backend uses bcrypt password hashes, auth rate limiting, HTTPS-only Android networking configuration and encrypted-at-rest chat/media payload envelopes.
- Push messages are generic event hints; message bodies and room content are not included.
- Browser auth token was moved to tab-scoped `sessionStorage`; this is still readable by same-origin JavaScript and is not an XSS boundary.
- Supabase server APIs use a service-role key. It must remain only in server-side environment variables.

## Release-critical limitations that remain

- The custom AES-GCM/PBKDF2 passphrase envelope is an MVP scheme, not audited Signal/Matrix-grade end-to-end encryption. Matrix SDK/homeserver integration is not present.
- Web device-key primitives are not yet a complete, integrated device-verification and key-recovery lifecycle. Existing web identity creation must not be marketed as multi-device E2EE.
- Web stories are not a complete image/video/GIF lifecycle; web attachments are not implemented.
- WebRTC audio/video calling, TURN and production signaling are not implemented.
- Web session tokens remain JS-readable; a production HttpOnly-cookie/BFF plus CSRF design is still recommended.
- Android has no complete owner/admin management UI, rich story media UX, or complete two-device verification/recovery.
- The repository tests are largely source-contract tests. They do not replace live HTTP/API integration, Supabase RLS integration tests, two-account/device tests, penetration tests or independent crypto review.
- Supabase schema/migration changes require owner execution in the hosted Supabase project; committing SQL does not apply it to production.

No production-ready security claim is made by this audit.

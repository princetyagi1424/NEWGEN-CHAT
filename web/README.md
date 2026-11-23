# NEWGEN CHAT — Web

React + TypeScript + Vite + Tailwind. The browser app is deployed from `web/` on Vercel. Account and chat APIs run as Vercel Functions and use Supabase through the server-only service-role client.

## Vercel deployment

1. Set the Vercel project's Root Directory to `web`.
2. Connect the Supabase project used by the app.
3. Configure the environment variables below for the appropriate Vercel environments.
4. Apply the database schema and migrations in the order shown below.
5. Deploy the web project.

### Environment variables

**Server-only Vercel variables — never expose with a `VITE_` prefix:**

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role/secret key. Keep this only in Vercel server-side environment settings.
- `JWT_SECRET`: random secret with at least 32 characters, used to sign application session tokens.

**Browser-visible variables:**

- `VITE_SUPABASE_URL`: Supabase project URL used by the browser Realtime presence client.
- `VITE_SUPABASE_ANON_KEY`: Supabase publishable/anon key. This key is public by design; table access must remain protected by RLS.

Never put `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` in `.env.local` variables prefixed with `VITE_`, source code, or browser bundles.

## Database setup and migrations

For a new project, run `web/database/schema.sql` in the Supabase SQL Editor. It creates the custom username/password `app_users` tables and supporting recovery/PIN-attempt tables. Do not confuse this custom account system with Supabase Auth.

For an existing project, apply only the migrations that have not already been applied. In particular:

1. `web/database/migrations/2026-11-23-chat-unlock-pin.sql` — adds the PIN hash and attempt table when not already present.
2. `web/database/migrations/004_membership_rls_hardening.sql` — prevents browser self-joining and self-promoting in conversations and removes recursive membership visibility.
3. `web/database/migrations/005_atomic_chat_pin_rate_limit.sql` — installs the atomic, account-wide 8-attempt / 15-minute PIN and security-answer limiter. Apply after the PIN-attempt table exists.
4. `web/database/migrations/006_server_only_conversation_writes.sql` — makes conversation and message writes go through authenticated server APIs rather than direct browser table writes.

The migrations are committed source files; they are **not** applied to a hosted Supabase project automatically. After applying them, verify that the service-role API can perform expected writes and anon/authenticated browser roles cannot bypass the API.

The separate `web/supabase/migrations/001_initial_schema.sql` describes the companion Supabase Auth/profile/conversation schema. Do not assume it is the backing schema for the custom `app_users` username/password API.

## Local development

Install dependencies and run the Vercel Functions alongside Vite:

```bash
npm install
npm run typecheck
npm run build
npm run dev:vercel
```

The Vercel CLI is required for `npm run dev:vercel`. Configure the server-only Supabase variables and `JWT_SECRET` in local environment settings; never commit local secrets. Plain `vite` does not execute Vercel Functions.

## Security and feature status

- Passwords and personal chat PINs are stored as bcrypt hashes; the personal PIN is an authentication gate, not the conversation encryption key.
- Browser bearer tokens are currently tab-scoped in `sessionStorage`. This reduces persistence but is still readable by same-origin JavaScript; it is not an XSS boundary. A production HttpOnly-cookie/BFF plus CSRF design remains a release hardening task.
- Browser device-key creation now exports private bytes only briefly in memory and re-imports the private key as non-extractable before IndexedDB persistence. The current web device-key primitives are not a complete device-verification or recovery protocol.
- The custom AES-GCM/passphrase encryption remains an MVP prototype, not Signal/Matrix-grade E2EE.
- Stories publishing, web encrypted attachments, and audio/video calling are not implemented. Those controls are explicitly disabled or marked unavailable rather than pretending to work.
- Hosted RLS, two-account flows, and live Supabase behavior must still be tested after the migrations are applied.

See `docs/SECURITY_AUDIT.md`, `docs/EXTERNAL_BLOCKERS.md`, `docs/IMPLEMENTATION-STATUS.md`, and `docs/RELEASE-GATE-2026-11-23.md` before any production release.

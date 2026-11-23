# NEWGEN CHAT — Web

React + TypeScript + Vite + Tailwind. Username/password authentication is handled by the NEWGEN CHAT Node.js API; Supabase Auth is not used for signup or login.

## Run the web app

1. Deploy the `backend` service first (Node.js 20+). Set `JWT_SECRET` to a cryptographically random secret of at least 32 characters, `HOST=0.0.0.0`, and `CORS_ORIGIN` to the exact web-app origin(s).
2. Ensure the backend uses persistent storage for `DB_PATH`; SQLite data on ephemeral hosting filesystems can be lost on restart/redeploy.
3. Copy `.env.example` to `.env.local` and set `VITE_API_URL` to the deployed backend base URL (without a trailing slash).
4. Run `npm install && npm run dev`.

## Account login

Users register and sign in using only a unique username and password. The backend stores usernames and bcrypt password hashes in SQLite. Passwords are never stored in frontend source files. Usernames are 3–24 letters, numbers, or underscores. Backend password policy is at least 10 characters and at most 72 UTF-8 bytes.

## Deploy (Vercel)

- Root Directory: `web`
- Framework: Vite
- Environment variable: `VITE_API_URL` for Production and Preview.
- Deploy the Node.js API separately and configure its persistent database volume and CORS allowlist.

## Current migration status

The login/register flow uses the custom API. Other web chat data features still contain Supabase database/realtime calls and are not yet migrated to the custom backend. Do not remove the Supabase client dependency until those remaining calls have been migrated.

## Security note

Client-side AES-GCM + ECDH. **Not** Signal Protocol. No independent audit.

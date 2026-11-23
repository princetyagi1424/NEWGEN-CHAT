# NEWGEN CHAT — Web

React + TypeScript + Vite + Tailwind. The username/password account API runs as Vercel Functions in this same project; no separate backend deployment is needed for account authentication.

## Vercel setup

1. Keep the Vercel project Root Directory set to `web`.
2. In Vercel Marketplace, create/connect a Neon PostgreSQL database to this Vercel project.
3. In Vercel Project Settings → Environment Variables, add `JWT_SECRET` with a cryptographically random value of at least 32 characters. Neon integration supplies `DATABASE_URL`; ensure it is available to the Production deployment.
4. Redeploy. The account table `app_users` is created automatically on first API request. Its schema is also in `database/schema.sql`.
5. The web app calls `/api/auth/register`, `/api/auth/login`, and `/api/me` on the same domain. No `VITE_API_URL` is required.

## Local development

Use `npm install` then `npm run dev:vercel` (requires Vercel CLI login and local `DATABASE_URL` + `JWT_SECRET`) so the `/api` functions run alongside Vite. Plain `vite` does not execute Vercel Functions.

## Account login

Users register and sign in with only a username and password. Usernames are 3–24 lowercase letters, numbers, or underscores. Passwords must be at least 10 characters and at most 72 UTF-8 bytes. The server hashes passwords with bcrypt (12 rounds); raw passwords are never stored. Sessions are signed JWTs.

## Current migration status

The register/login/session endpoints are Vercel serverless functions using Neon PostgreSQL. The existing chat UI still contains Supabase database and Realtime calls; friends, conversations, messages, presence, groups, and media have not yet been migrated to the Vercel API/database. Do not remove the Supabase client dependency until those chat features have been migrated.

## Security note

Client-side AES-GCM + ECDH. **Not** Signal Protocol. No independent audit. Configure `JWT_SECRET` only as a server-side environment variable, never as a `VITE_` variable.

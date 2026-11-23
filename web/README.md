# NEWGEN CHAT — Web

React + TypeScript + Vite + Tailwind + Supabase.

## Setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_initial_schema.sql` in the SQL Editor.
3. Enable Realtime for `messages`, `conversation_members`, `profiles`.
4. Copy `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. `npm install && npm run dev`

## Deploy (Vercel)

- Root Directory: `web`
- Framework: Vite
- Env vars: same `VITE_*` keys for Production and Preview

## Security note

Client-side AES-GCM + ECDH. **Not** Signal Protocol. No independent audit.

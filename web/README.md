# NEWGEN CHAT — Web

React + TypeScript + Vite + Tailwind + Supabase.

## Setup

1. Create a Supabase project.
2. In Supabase Dashboard, open **Authentication → Providers → Email** and disable **Confirm email**. The app uses username/password only and needs immediate sessions after signup.
3. Run `supabase/migrations/001_initial_schema.sql` in the SQL Editor.
4. Enable Realtime for `messages`, `conversation_members`, `profiles`.
5. Copy `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. `npm install && npm run dev`

## Account login

Users create accounts and sign in with a unique username and password. No email address or phone number is requested or displayed. Supabase Auth internally requires an email-shaped identifier, so the client derives a reserved non-deliverable identifier from the username. It is not a contact address and cannot receive mail.

Usernames are 3–24 characters and may contain lowercase/uppercase letters, numbers, and underscores. They are stored lowercase.

## Deploy (Vercel)

- Root Directory: `web`
- Framework: Vite
- Env vars: same `VITE_*` keys for Production and Preview

## Security note

Client-side AES-GCM + ECDH. **Not** Signal Protocol. No independent audit.

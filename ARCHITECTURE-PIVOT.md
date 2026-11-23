# Architecture pivot — 2026-11-23

NEWGEN CHAT is now **browser-first**.

## Primary product

- Path: `/web`
- Stack: React + TypeScript + Vite + Tailwind + Supabase
- Deploy target: Vercel (root directory = `web`)

## Next actions

1. Create Supabase project and run `web/supabase/migrations/001_initial_schema.sql`
2. Enable Realtime on messages, conversation_members, profiles
3. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
4. Deploy /web to Vercel

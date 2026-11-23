-- Run this once in the existing Supabase project's SQL Editor.
-- The table stores app-specific username/password accounts. Supabase Auth is not used.
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY,
  username VARCHAR(24) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT app_users_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$')
);

-- Only the Vercel server API (using SUPABASE_SERVICE_ROLE_KEY) should access this table.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;

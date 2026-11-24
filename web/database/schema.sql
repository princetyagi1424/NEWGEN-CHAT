-- Run this once in the existing Supabase project's SQL Editor.
-- The table stores app-specific username/password accounts. Supabase Auth is not used.
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY,
  username VARCHAR(24) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  security_question TEXT,
  security_answer_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT app_users_username_format CHECK (username ~ '^[a-z0-9_]{3,24}$')
);

-- Only the Vercel server API (using SUPABASE_SERVICE_ROLE_KEY) should access this table.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_users FROM anon, authenticated;

-- Forward migration for projects where app_users already exists.
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS security_question TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS security_answer_hash TEXT;

CREATE TABLE IF NOT EXISTS public.account_recovery_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_recovery_attempts_ip_created_idx ON public.account_recovery_attempts (ip_hash, created_at DESC);
ALTER TABLE public.account_recovery_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_recovery_attempts FROM anon, authenticated;


-- Per-account personal chat unlock PIN (separate from the shared message-encryption passphrase).
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS chat_unlock_pin_hash TEXT;

CREATE TABLE IF NOT EXISTS public.chat_pin_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_pin_attempts_user_ip_created_idx
  ON public.chat_pin_attempts (user_id, ip_hash, created_at DESC);
ALTER TABLE public.chat_pin_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_pin_attempts FROM anon, authenticated;


-- One-time JWT session revocation for the custom Vercel username/password API.
CREATE TABLE IF NOT EXISTS public.revoked_tokens (
  jti UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS revoked_tokens_expires_idx ON public.revoked_tokens (expires_at);
CREATE INDEX IF NOT EXISTS revoked_tokens_user_idx ON public.revoked_tokens (user_id);
ALTER TABLE public.revoked_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.revoked_tokens FROM anon, authenticated;

-- Atomic account and network rate limits for Vercel login, registration and recovery.
CREATE TABLE IF NOT EXISTS public.account_auth_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  account_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_auth_attempts_ip_created_idx
  ON public.account_auth_attempts (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS account_auth_attempts_account_created_idx
  ON public.account_auth_attempts (account_hash, created_at DESC);
ALTER TABLE public.account_auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_auth_attempts FROM anon, authenticated;

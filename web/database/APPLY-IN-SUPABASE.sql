-- NEWGEN CHAT: run this ONCE in Supabase > SQL Editor > New query > Run.
-- Safe to re-run (all statements are idempotent).

-- ===== 2026-11-23-chat-unlock-pin =====
-- Apply once in Supabase SQL Editor for existing deployments.
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

-- ===== 005_atomic_chat_pin_rate_limit =====
-- Atomic per-account PIN and security-answer attempt limiter.
-- Apply after 2026-11-23-chat-unlock-pin.sql using the Supabase SQL Editor.
-- The function uses a transaction-scoped account-level advisory lock so concurrent
-- requests from different IPs cannot race or bypass the configured attempt limit.
-- p_ip_hash is retained for audit/diagnostics, but it is NOT part of the quota key.
CREATE OR REPLACE FUNCTION public.consume_chat_pin_attempt(
  p_user_id UUID,
  p_ip_hash TEXT,
  p_limit INTEGER DEFAULT 8,
  p_window_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count INTEGER;
  v_cutoff TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL
     OR p_ip_hash IS NULL
     OR p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds < 60 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid PIN rate-limit arguments';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_user_id::TEXT, 0)
  );

  v_cutoff := NOW() - make_interval(secs => p_window_seconds);
  DELETE FROM public.chat_pin_attempts WHERE created_at < v_cutoff;

  SELECT COUNT(*)::INTEGER INTO v_count
  FROM public.chat_pin_attempts
  WHERE user_id = p_user_id
    AND created_at >= v_cutoff;

  IF v_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.chat_pin_attempts(user_id, ip_hash)
  VALUES (p_user_id, p_ip_hash);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chat_pin_attempt(UUID, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_chat_pin_attempt(UUID, TEXT, INTEGER, INTEGER)
  TO service_role;

-- ===== 007_web_session_revocation =====
-- Per-token revocation for the Vercel username/password API.
-- Apply after the custom public.app_users table exists.
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

-- ===== 008_atomic_web_auth_rate_limit =====
-- Atomic dual-key rate limiting for the custom Vercel authentication APIs.
-- Apply after web/database/schema.sql. Hashes are server-derived with JWT_SECRET;
-- raw IP addresses and usernames are never stored.
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

CREATE OR REPLACE FUNCTION public.consume_account_auth_attempt(
  p_ip_hash TEXT,
  p_account_hash TEXT,
  p_limit INTEGER DEFAULT 10,
  p_window_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_ip_lock BIGINT;
  v_account_lock BIGINT;
  v_ip_count INTEGER;
  v_account_count INTEGER;
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_account_hash IS NULL OR p_account_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_limit > 100
     OR p_window_seconds < 60 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'Invalid authentication rate-limit arguments';
  END IF;

  v_ip_lock := hashtextextended('ip:' || p_ip_hash, 0);
  v_account_lock := hashtextextended('account:' || p_account_hash, 0);

  -- Acquire both locks in deterministic order to avoid deadlocks between
  -- concurrent requests that share either a network or account identifier.
  IF v_ip_lock < v_account_lock THEN
    PERFORM pg_advisory_xact_lock(v_ip_lock);
    PERFORM pg_advisory_xact_lock(v_account_lock);
  ELSE
    PERFORM pg_advisory_xact_lock(v_account_lock);
    PERFORM pg_advisory_xact_lock(v_ip_lock);
  END IF;

  v_cutoff := NOW() - make_interval(secs => p_window_seconds);
  DELETE FROM public.account_auth_attempts WHERE created_at < v_cutoff;

  SELECT COUNT(*)::INTEGER INTO v_ip_count
  FROM public.account_auth_attempts
  WHERE ip_hash = p_ip_hash AND created_at >= v_cutoff;

  SELECT COUNT(*)::INTEGER INTO v_account_count
  FROM public.account_auth_attempts
  WHERE account_hash = p_account_hash AND created_at >= v_cutoff;

  IF v_ip_count >= p_limit OR v_account_count >= p_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.account_auth_attempts(ip_hash, account_hash)
  VALUES (p_ip_hash, p_account_hash);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_account_auth_attempt(TEXT, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_auth_attempt(TEXT, TEXT, INTEGER, INTEGER)
  TO service_role;

-- ===== 010_profile_stories =====
-- Editable Web profile images + friend-only 24-hour text/photo stories.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  story_type TEXT NOT NULL CHECK (story_type IN ('text', 'image')),
  caption TEXT NOT NULL DEFAULT '',
  media_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT stories_payload_shape CHECK (
    (story_type = 'text' AND media_path IS NULL AND length(caption) > 0)
    OR (story_type = 'image' AND media_path IS NOT NULL)
  ),
  CONSTRAINT stories_caption_length CHECK (length(caption) <= 280)
);
CREATE INDEX IF NOT EXISTS stories_user_created_idx ON public.stories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stories_expiry_idx ON public.stories (expires_at);
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stories FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('newgen-profile-media', 'newgen-profile-media', FALSE, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('newgen-story-media', 'newgen-story-media', FALSE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

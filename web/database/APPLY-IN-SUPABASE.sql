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
-- NEWGEN CHAT: editable browser profiles and friends-only 24-hour stories.
-- The custom-account schema already defines stories(kind, media, caption, bg)
-- and story_views. Keep those deployed column names stable.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  media TEXT,
  caption TEXT,
  bg TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS stories_user_created_idx ON public.stories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stories_expires_idx ON public.stories (expires_at);

CREATE TABLE IF NOT EXISTS public.story_views (
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, viewer_id)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.stories FROM anon, authenticated;
REVOKE ALL ON TABLE public.story_views FROM anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('newgen-profile-media', 'newgen-profile-media', FALSE, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('newgen-story-media', 'newgen-story-media', FALSE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Event triggers invoke this function. Browser roles must never call it via RPC.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- ===== 011_server_only_data_access_and_fk_indexes =====
-- Custom-JWT API is the sole web data plane. The browser app does not
-- query Supabase tables directly; it uses authenticated Vercel APIs and
-- Supabase Realtime Presence only. All table access is service-role mediated.

-- Remove legacy policies which belonged to the earlier direct-authenticated
-- Supabase browser model. Several older membership policies were recursive or
-- tautological and must not remain as an alternative access path.
DROP POLICY IF EXISTS "members_insert" ON public.conversation_members;
DROP POLICY IF EXISTS "members_update" ON public.conversation_members;
DROP POLICY IF EXISTS "members_select" ON public.conversation_members;
DROP POLICY IF EXISTS "conv_insert" ON public.conversations;
DROP POLICY IF EXISTS "conv_select" ON public.conversations;
DROP POLICY IF EXISTS "devices_own" ON public.devices;
DROP POLICY IF EXISTS "receipts_own" ON public.message_receipts;
DROP POLICY IF EXISTS "receipts_select_own" ON public.message_receipts;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "push_own" ON public.push_subscriptions;

-- No anon/authenticated direct table access. Vercel uses the server-only
-- service_role key after validating custom JWT, membership, friendship and ACL.
REVOKE ALL ON TABLE
  public.devices,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.message_receipts,
  public.push_subscriptions
FROM PUBLIC, anon, authenticated;

-- Preserve RLS as defense-in-depth even though browser roles have no grants.
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cover foreign keys used by joins, deletes and service-side membership checks.
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON public.conversation_members(user_id);
CREATE INDEX IF NOT EXISTS conversations_created_by_idx ON public.conversations(created_by);
CREATE INDEX IF NOT EXISTS devices_user_id_idx ON public.devices(user_id);
CREATE INDEX IF NOT EXISTS friend_requests_recipient_id_idx ON public.friend_requests(recipient_id);
CREATE INDEX IF NOT EXISTS friend_requests_requester_id_idx ON public.friend_requests(requester_id);
CREATE INDEX IF NOT EXISTS friendships_user_high_idx ON public.friendships(user_high);
CREATE INDEX IF NOT EXISTS message_receipts_user_id_idx ON public.message_receipts(user_id);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS story_views_viewer_id_idx ON public.story_views(viewer_id);

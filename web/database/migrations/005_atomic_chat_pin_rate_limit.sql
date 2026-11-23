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

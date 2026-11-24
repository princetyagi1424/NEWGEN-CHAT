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

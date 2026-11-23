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

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

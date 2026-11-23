-- NEWGEN CHAT web connection requests and accepted friendships.
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_one_pending_pair
ON public.friend_requests (LEAST(requester_id, recipient_id), GREATEST(requester_id, recipient_id))
WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS public.friendships (
  user_low UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  user_high UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);
ALTER TABLE public.friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.friend_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.friendships FROM anon, authenticated;

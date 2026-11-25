-- Editable display name + profile photo, and 24-hour stories.
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS avatar_data TEXT;

CREATE TABLE IF NOT EXISTS public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','text')),
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

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stories FROM anon, authenticated;
REVOKE ALL ON TABLE public.story_views FROM anon, authenticated;

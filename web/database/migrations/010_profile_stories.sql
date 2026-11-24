-- NEWGEN CHAT: editable browser profiles and friends-only 24-hour stories.
-- Apply after the existing custom-account schema and chat-auth bridge.

-- Profile fields already exist in the chat profile table in current installations;
-- keep these additions idempotent for older deployments.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Browser stories are readable only through the authenticated server API.
-- They are NOT end-to-end encrypted in this MVP; never describe them as E2EE.
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
CREATE INDEX IF NOT EXISTS stories_user_created_idx
  ON public.stories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stories_expiry_idx
  ON public.stories (expires_at);

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stories FROM anon, authenticated;

-- Keep media private. Only the server service-role API creates signed URLs or
-- uploads/removes objects after checking the active account/friendship.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('newgen-profile-media', 'newgen-profile-media', FALSE, 1048576, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('newgen-story-media', 'newgen-story-media', FALSE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Do not add browser-facing storage.objects policies. Uploads and signed reads
-- are deliberately mediated by authenticated Vercel API handlers.

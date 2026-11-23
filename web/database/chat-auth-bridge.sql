-- Connect custom app_users accounts to the existing chat profile foreign keys.
-- Run after web/database/schema.sql and web/supabase/migrations/001_initial_schema.sql.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey
  FOREIGN KEY (id) REFERENCES public.app_users(id) ON DELETE CASCADE;

INSERT INTO public.profiles (id, username, display_name)
SELECT id, username, username FROM public.app_users
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

-- Keep profile rows in sync for future custom-account registrations.

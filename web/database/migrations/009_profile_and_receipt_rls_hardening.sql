-- Prevent authenticated Supabase clients from enumerating private profile metadata
-- or forging read/delivery receipts. Profile and receipt writes are server-only.
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receipts_own" ON public.message_receipts;
DROP POLICY IF EXISTS "receipts_select_own" ON public.message_receipts;
CREATE POLICY "receipts_select_own" ON public.message_receipts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.message_receipts FROM anon, authenticated;
GRANT SELECT ON TABLE public.message_receipts TO authenticated;
ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;

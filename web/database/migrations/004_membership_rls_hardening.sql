-- Harden Supabase conversation membership against self-join and self-promotion.
-- Apply through the Supabase SQL Editor. Server-side service_role APIs retain their
-- privileged writes and must continue enforcing membership and role authorization.
DROP POLICY IF EXISTS "members_insert" ON public.conversation_members;
DROP POLICY IF EXISTS "members_update" ON public.conversation_members;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversation_members FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_members TO authenticated;

-- Assert RLS remains enabled even on an older project where the table was created
-- outside the current bootstrap migration.
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

-- Qualify the outer row explicitly. Unqualified conversation_id could bind to
-- the inner table alias and accidentally broaden which membership rows are visible.
DROP POLICY IF EXISTS "members_select" ON public.conversation_members;
CREATE POLICY "members_select" ON public.conversation_members FOR SELECT TO authenticated USING (
  conversation_members.user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.conversation_members m2
    WHERE m2.conversation_id = conversation_members.conversation_id
      AND m2.user_id = auth.uid()
  )
);

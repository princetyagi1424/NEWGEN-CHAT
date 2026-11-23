-- Route conversation and message mutations through authenticated server APIs.
-- The web client already sends these operations to the API, which checks the
-- JWT, membership, friendship and payload schema before using service_role.
DROP POLICY IF EXISTS "conv_insert" ON public.conversations;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversations FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversations TO authenticated;

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;

-- Keep row-level security enabled on the protected data tables.
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

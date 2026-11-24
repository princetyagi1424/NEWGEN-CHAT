-- Custom-JWT API is the sole web data plane. The browser app does not
-- query Supabase tables directly; it uses authenticated Vercel APIs and
-- Supabase Realtime Presence only. All table access is service-role mediated.

-- Remove legacy policies which belonged to the earlier direct-authenticated
-- Supabase browser model. Several older membership policies were recursive or
-- tautological and must not remain as an alternative access path.
DROP POLICY IF EXISTS "members_insert" ON public.conversation_members;
DROP POLICY IF EXISTS "members_update" ON public.conversation_members;
DROP POLICY IF EXISTS "members_select" ON public.conversation_members;
DROP POLICY IF EXISTS "conv_insert" ON public.conversations;
DROP POLICY IF EXISTS "conv_select" ON public.conversations;
DROP POLICY IF EXISTS "devices_own" ON public.devices;
DROP POLICY IF EXISTS "receipts_own" ON public.message_receipts;
DROP POLICY IF EXISTS "receipts_select_own" ON public.message_receipts;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "push_own" ON public.push_subscriptions;

-- No anon/authenticated direct table access. Vercel uses the server-only
-- service_role key after validating custom JWT, membership, friendship and ACL.
REVOKE ALL ON TABLE
  public.devices,
  public.conversations,
  public.conversation_members,
  public.messages,
  public.message_receipts,
  public.push_subscriptions
FROM PUBLIC, anon, authenticated;

-- Preserve RLS as defense-in-depth even though browser roles have no grants.
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Cover foreign keys used by joins, deletes and service-side membership checks.
CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx ON public.conversation_members(user_id);
CREATE INDEX IF NOT EXISTS conversations_created_by_idx ON public.conversations(created_by);
CREATE INDEX IF NOT EXISTS devices_user_id_idx ON public.devices(user_id);
CREATE INDEX IF NOT EXISTS friend_requests_recipient_id_idx ON public.friend_requests(recipient_id);
CREATE INDEX IF NOT EXISTS friend_requests_requester_id_idx ON public.friend_requests(requester_id);
CREATE INDEX IF NOT EXISTS friendships_user_high_idx ON public.friendships(user_high);
CREATE INDEX IF NOT EXISTS message_receipts_user_id_idx ON public.message_receipts(user_id);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS story_views_viewer_id_idx ON public.story_views(viewer_id);

-- Create each new chat profile within the account insert transaction.
CREATE OR REPLACE FUNCTION public.create_profile_for_new_app_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.profiles(id, username, display_name, updated_at)
  VALUES (NEW.id, NEW.username, NEW.username, NOW())
  ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.create_profile_for_new_app_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS app_user_profile_on_insert ON public.app_users;
CREATE TRIGGER app_user_profile_on_insert
AFTER INSERT ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_new_app_user();

-- Update conversation ordering as part of the message transaction and then
-- emit an invalidation event for every active member session.
CREATE OR REPLACE FUNCTION public.broadcast_message_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_conversation_id UUID;
  v_member RECORD;
BEGIN
  v_conversation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.conversations
    SET updated_at = GREATEST(updated_at, NEW.created_at)
    WHERE id = NEW.conversation_id;
  END IF;
  FOR v_member IN
    SELECT user_id FROM public.conversation_members WHERE conversation_id = v_conversation_id
  LOOP
    PERFORM public.notify_user_realtime(v_member.user_id, 'messages');
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_message_invalidation() FROM PUBLIC, anon, authenticated;

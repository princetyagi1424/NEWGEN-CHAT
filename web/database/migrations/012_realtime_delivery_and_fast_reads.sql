-- Fast, event-driven delivery for NEWGEN CHAT.
-- Private message content never leaves the authenticated HTTP API. Realtime only
-- emits small invalidation events on an unguessable, per-session public topic.

CREATE TABLE IF NOT EXISTS public.realtime_session_channels (
  session_jti UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  channel_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS realtime_session_channels_user_expiry_idx
  ON public.realtime_session_channels(user_id, expires_at);
ALTER TABLE public.realtime_session_channels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.realtime_session_channels FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS messages_conversation_created_live_idx
  ON public.messages(conversation_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- Build the chat list with one database round-trip instead of N+1 API queries.
CREATE OR REPLACE FUNCTION public.get_user_conversation_summaries(p_user_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(q.summary ORDER BY q.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      c.updated_at,
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'name', c.name,
        'created_by', c.created_by,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        'members', (
          SELECT COALESCE(
            jsonb_agg(jsonb_build_object('user_id', cm.user_id, 'role', cm.role) ORDER BY cm.joined_at),
            '[]'::jsonb
          )
          FROM public.conversation_members cm
          WHERE cm.conversation_id = c.id
        ),
        'otherProfile', (
          SELECT jsonb_build_object(
            'id', p.id,
            'username', p.username,
            'display_name', COALESCE(p.display_name, p.username),
            'avatar_url', p.avatar_url,
            'bio', p.bio,
            'created_at', p.created_at,
            'updated_at', p.updated_at,
            'last_seen_at', p.last_seen_at
          )
          FROM public.conversation_members other_member
          JOIN public.profiles p ON p.id = other_member.user_id
          WHERE other_member.conversation_id = c.id
            AND other_member.user_id <> p_user_id
          ORDER BY other_member.joined_at
          LIMIT 1
        ),
        'lastMessage', latest.message
      ) AS summary
    FROM public.conversation_members mine
    JOIN public.conversations c ON c.id = mine.conversation_id
    JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', msg.id,
        'conversation_id', msg.conversation_id,
        'sender_id', msg.sender_id,
        'ciphertext', msg.ciphertext,
        'iv', msg.iv,
        'content_type', msg.content_type,
        'created_at', msg.created_at,
        'expires_at', msg.expires_at,
        'deleted_at', msg.deleted_at
      ) AS message
      FROM public.messages msg
      WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
      ORDER BY msg.created_at DESC, msg.id DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE mine.user_id = p_user_id
  ) q;
$$;
REVOKE ALL ON FUNCTION public.get_user_conversation_summaries(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_conversation_summaries(UUID) TO service_role;

-- Fetch the requests and both usernames in one indexed query.
CREATE OR REPLACE FUNCTION public.get_user_friend_requests(p_user_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'requester_id', r.requester_id,
        'recipient_id', r.recipient_id,
        'status', r.status,
        'created_at', r.created_at,
        'other_user_id', CASE WHEN r.requester_id = p_user_id THEN r.recipient_id ELSE r.requester_id END,
        'other_username', CASE WHEN r.requester_id = p_user_id THEN recipient.username ELSE requester.username END,
        'direction', CASE WHEN r.recipient_id = p_user_id THEN 'incoming' ELSE 'outgoing' END
      )
      ORDER BY r.created_at DESC
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT *
    FROM public.friend_requests
    WHERE requester_id = p_user_id OR recipient_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 100
  ) r
  JOIN public.app_users requester ON requester.id = r.requester_id
  JOIN public.app_users recipient ON recipient.id = r.recipient_id;
$$;
REVOKE ALL ON FUNCTION public.get_user_friend_requests(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_friend_requests(UUID) TO service_role;

-- Atomic acceptance/decline/cancel: no partially-updated friendship state.
CREATE OR REPLACE FUNCTION public.respond_friend_request(
  p_actor_id UUID,
  p_request_id UUID,
  p_action TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.friend_requests%ROWTYPE;
  v_status TEXT;
  v_low UUID;
  v_high UUID;
BEGIN
  IF p_action NOT IN ('accept', 'decline', 'cancel') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_request_action';
  END IF;

  SELECT * INTO v_request
  FROM public.friend_requests
  WHERE id = p_request_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'pending_request_not_found';
  END IF;

  IF p_action IN ('accept', 'decline') AND v_request.recipient_id <> p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'request_response_forbidden';
  ELSIF p_action = 'cancel' AND v_request.requester_id <> p_actor_id THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'request_cancel_forbidden';
  END IF;

  v_status := CASE p_action
    WHEN 'accept' THEN 'accepted'
    WHEN 'decline' THEN 'declined'
    ELSE 'cancelled'
  END;

  UPDATE public.friend_requests
  SET status = v_status, updated_at = NOW()
  WHERE id = p_request_id;

  IF p_action = 'accept' THEN
    v_low := LEAST(v_request.requester_id, v_request.recipient_id);
    v_high := GREATEST(v_request.requester_id, v_request.recipient_id);
    INSERT INTO public.friendships(user_low, user_high)
    VALUES (v_low, v_high)
    ON CONFLICT (user_low, user_high) DO NOTHING;
  END IF;

  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_friend_request(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(UUID, UUID, TEXT) TO service_role;

-- Per-session random topics prevent guessing a user's realtime channel. The
-- payload is intentionally only an invalidation hint, never message contents.
CREATE OR REPLACE FUNCTION public.notify_user_realtime(p_user_id UUID, p_resource TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, realtime
AS $$
DECLARE
  v_session RECORD;
BEGIN
  IF p_resource NOT IN ('messages', 'friend_requests', 'conversations') THEN
    RAISE EXCEPTION 'Unsupported realtime resource';
  END IF;

  FOR v_session IN
    SELECT channel_token
    FROM public.realtime_session_channels
    WHERE user_id = p_user_id AND expires_at > NOW()
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('resource', p_resource),
      'refresh',
      'user:' || v_session.channel_token,
      FALSE
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_user_realtime(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.broadcast_friend_request_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.notify_user_realtime(NEW.requester_id, 'friend_requests');
  IF NEW.recipient_id <> NEW.requester_id THEN
    PERFORM public.notify_user_realtime(NEW.recipient_id, 'friend_requests');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_friend_request_invalidation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS friend_request_realtime_invalidation ON public.friend_requests;
CREATE TRIGGER friend_request_realtime_invalidation
AFTER INSERT OR UPDATE OF status ON public.friend_requests
FOR EACH ROW EXECUTE FUNCTION public.broadcast_friend_request_invalidation();

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
  FOR v_member IN
    SELECT user_id FROM public.conversation_members WHERE conversation_id = v_conversation_id
  LOOP
    PERFORM public.notify_user_realtime(v_member.user_id, 'messages');
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_message_invalidation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS message_realtime_invalidation ON public.messages;
CREATE TRIGGER message_realtime_invalidation
AFTER INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.broadcast_message_invalidation();

CREATE OR REPLACE FUNCTION public.broadcast_membership_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_conversation_id UUID;
  v_member RECORD;
  v_affected_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conversation_id := OLD.conversation_id;
    v_affected_user := OLD.user_id;
  ELSE
    v_conversation_id := NEW.conversation_id;
    v_affected_user := NEW.user_id;
  END IF;

  PERFORM public.notify_user_realtime(v_affected_user, 'conversations');
  FOR v_member IN
    SELECT user_id FROM public.conversation_members
    WHERE conversation_id = v_conversation_id AND user_id <> v_affected_user
  LOOP
    PERFORM public.notify_user_realtime(v_member.user_id, 'conversations');
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.broadcast_membership_invalidation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS membership_realtime_invalidation ON public.conversation_members;
CREATE TRIGGER membership_realtime_invalidation
AFTER INSERT OR DELETE ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION public.broadcast_membership_invalidation();

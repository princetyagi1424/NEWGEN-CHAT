-- Keep new conversations visible even before the first message is sent.
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
    LEFT JOIN LATERAL (
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

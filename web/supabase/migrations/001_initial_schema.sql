-- NEWGEN CHAT schema + RLS. Run in Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists profiles_username_idx on public.profiles (username);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text not null,
  public_key text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  name text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  encrypted_conversation_key text,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  ciphertext text not null,
  iv text not null,
  content_type text not null default 'text',
  media_path text,
  media_mime text,
  media_size bigint,
  reply_to uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  deleted_at timestamptz
);
create index if not exists messages_conv_created_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('delivered', 'read')),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_receipts enable row level security;
alter table public.push_subscriptions enable row level security;

-- Profiles contain privacy-sensitive metadata (including last_seen_at).
-- The custom-account Vercel APIs use service_role; browser clients must not
-- enumerate profiles or bypass those APIs.
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;

create policy "devices_own" on public.devices for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "conv_select" on public.conversations for select to authenticated using (
  exists (select 1 from public.conversation_members m where m.conversation_id = id and m.user_id = auth.uid())
);
-- Conversation creation and message writes are performed by authenticated server APIs.
-- Do not permit direct browser writes that bypass API validation and authorization.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversations FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversations TO authenticated;

-- The browser may read only its own membership row. Authorized server APIs
-- return group member lists using the server-only service role.
create policy "members_select" on public.conversation_members for select to authenticated using (
  user_id = auth.uid()
);
-- Membership writes are intentionally server-only. The API authenticates the caller
-- and checks friendship/group-role rules before changing membership. A client must
-- not be able to self-join a known conversation or promote its own role.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversation_members FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_members TO authenticated;

create policy "messages_select" on public.messages for select to authenticated using (
  exists (select 1 from public.conversation_members m where m.conversation_id = messages.conversation_id and m.user_id = auth.uid())
);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.messages FROM anon, authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;

-- Receipts are written only by an authenticated server API after verifying
-- message recipient and conversation membership. Browser clients may read only
-- receipt rows assigned to their own user ID; direct writes could forge read state.
DROP POLICY IF EXISTS "receipts_own" ON public.message_receipts;
CREATE POLICY "receipts_select_own" ON public.message_receipts FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON TABLE public.message_receipts FROM anon, authenticated;
GRANT SELECT ON TABLE public.message_receipts TO authenticated;
create policy "push_own" on public.push_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- After tables exist, enable Realtime in Dashboard or:
-- alter publication supabase_realtime add table public.messages;
-- alter publication supabase_realtime add table public.conversation_members;
-- alter publication supabase_realtime add table public.profiles;

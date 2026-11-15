-- Chat (Jaxongirman.app 2.0, §5.4).
--
-- One-to-one conversations between accounts: text, pictures, voice messages
-- up to two minutes, square video messages up to a minute, and things made in
-- the app (a deck, a game, a scientific work) shared into the conversation.
--
-- A message is written only through chat_send, which checks that the sender
-- is in the conversation, that a file was uploaded to the conversation's own
-- folder by them, and that a shared thing is theirs. Members read messages by
-- row-level security, which is also what lets Realtime deliver a new message
-- to the other phone and to no one else.
--
-- Contacts are each account's own: the name it saved someone under and
-- whether it muted them. Muted conversations do not count towards the badge.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  -- Two accounts have one direct conversation: their ids, smaller first.
  direct_key text unique,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('text', 'image', 'voice', 'video', 'share')),
  body text not null default '' check (char_length(body) <= 4000),
  media_path text check (media_path is null or char_length(media_path) <= 300),
  media jsonb not null default '{}'::jsonb check (jsonb_typeof(media) = 'object'),
  share jsonb check (share is null or jsonb_typeof(share) = 'object'),
  client_id text check (client_id is null or char_length(client_id) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at desc);
create unique index if not exists chat_messages_client_idx on public.chat_messages (conversation_id, sender_id, client_id) where client_id is not null;

create table if not exists public.chat_contacts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_id),
  check (owner_id <> contact_id)
);
drop trigger if exists chat_contacts_updated_at on public.chat_contacts;
create trigger chat_contacts_updated_at before update on public.chat_contacts for each row execute function public.set_updated_at();

/** Is the caller in this conversation? Used by the policies; never the client's word. */
create or replace function public.chat_is_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_members m where m.conversation_id = p_conversation_id and m.user_id = auth.uid());
$$;
revoke all on function public.chat_is_member(uuid) from public, anon;
grant execute on function public.chat_is_member(uuid) to authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_contacts enable row level security;

drop policy if exists chat_conversations_member on public.chat_conversations;
create policy chat_conversations_member on public.chat_conversations for select to authenticated
  using ((select public.chat_is_member(id)));
drop policy if exists chat_members_member on public.chat_members;
create policy chat_members_member on public.chat_members for select to authenticated
  using ((select public.chat_is_member(conversation_id)));
drop policy if exists chat_messages_member on public.chat_messages;
create policy chat_messages_member on public.chat_messages for select to authenticated
  using ((select public.chat_is_member(conversation_id)));
drop policy if exists chat_contacts_owner on public.chat_contacts;
create policy chat_contacts_owner on public.chat_contacts for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on public.chat_conversations, public.chat_members, public.chat_messages from anon, authenticated;
grant select on public.chat_conversations, public.chat_members, public.chat_messages to authenticated;
grant select, insert, update, delete on public.chat_contacts to authenticated;

-- The other phone hears of a new message, and of its own being read.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_members') then
    alter publication supabase_realtime add table public.chat_members;
  end if;
end $$;

-- Files: chat-media/<conversation>/<sender>/<file>. Uploaded by a member into
-- their own folder of the conversation; read by its members.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 26214400,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
         and (select public.chat_is_member(((storage.foldername(name))[1])::uuid)));
drop policy if exists chat_media_write on storage.objects;
create policy chat_media_write on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and (select public.chat_is_member(((storage.foldername(name))[1])::uuid)));

/** Another account as a chat shows it: name, handle, picture, a line about them, what they have made. Nothing private. */
create or replace function public.chat_profile(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', coalesce(p.full_name, ''), 'username', p.username,
    'avatar_url', p.avatar_url, 'bio', coalesce(p.bio, ''),
    'study', concat_ws(' · ', nullif(btrim(coalesce(p.organization, '')), ''), nullif(btrim(coalesce(p.field_of_study, '')), '')),
    -- What their card counts, as one's own does; the balance is theirs alone.
    'decks', (select count(*) from public.presentations d where d.owner_id = p.id and d.status = 'ready'),
    'games', (select count(*) from public.games g where g.owner_id = p.id and g.status = 'ready'),
    'contact_name', c.display_name, 'muted', coalesce(c.muted, false), 'saved', c.contact_id is not null
  )
  from public.profiles p
  left join public.chat_contacts c on c.owner_id = auth.uid() and c.contact_id = p.id
  where p.id = p_user and auth.uid() is not null and p.status = 'active';
$$;
revoke all on function public.chat_profile(uuid) from public, anon;
grant execute on function public.chat_profile(uuid) to authenticated;

/** The direct conversation with another account, made the first time. */
create or replace function public.chat_open_direct(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_user is null or p_user = v_me then raise exception 'O‘zingiz bilan suhbat ochib bo‘lmaydi.' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.status = 'active') then
    raise exception 'Foydalanuvchi topilmadi.' using errcode = 'P0002';
  end if;
  v_key := least(v_me::text, p_user::text) || ':' || greatest(v_me::text, p_user::text);
  select id into v_id from public.chat_conversations where direct_key = v_key;
  if v_id is null then
    insert into public.chat_conversations (direct_key) values (v_key)
      on conflict (direct_key) do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.chat_conversations where direct_key = v_key;
    end if;
    insert into public.chat_members (conversation_id, user_id) values (v_id, v_me), (v_id, p_user)
      on conflict do nothing;
  end if;
  return v_id;
end;
$$;
revoke all on function public.chat_open_direct(uuid) from public, anon;
grant execute on function public.chat_open_direct(uuid) to authenticated;

/**
 * One message into a conversation. `p_client_id` is the phone's own id for
 * it, so a send repeated after a dropped connection is the same message.
 */
create or replace function public.chat_send(
  p_conversation_id uuid,
  p_kind text,
  p_body text default '',
  p_media_path text default null,
  p_media jsonb default '{}'::jsonb,
  p_share jsonb default null,
  p_client_id text default null
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_media jsonb := coalesce(p_media, '{}'::jsonb);
  v_share jsonb;
  v_kind text;
  v_id uuid;
  v_title text;
  v_row public.chat_messages%rowtype;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_members where conversation_id = p_conversation_id and user_id = v_me) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if p_client_id is not null then
    select * into v_row from public.chat_messages
      where conversation_id = p_conversation_id and sender_id = v_me and client_id = p_client_id;
    if found then return v_row; end if;
  end if;

  if p_kind = 'text' then
    if char_length(v_body) not between 1 and 4000 then raise exception 'Xabar bo‘sh.' using errcode = '22023'; end if;
  elsif p_kind in ('image', 'voice', 'video') then
    if p_media_path is null or p_media_path not like p_conversation_id::text || '/' || v_me::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = p_media_path) then
      raise exception 'Fayl topilmadi.' using errcode = '22023';
    end if;
    if p_kind = 'voice' and coalesce((v_media ->> 'duration_ms')::numeric, 0) > 121000 then
      raise exception 'Ovozli xabar 2 daqiqadan oshmasin.' using errcode = '22023';
    end if;
    if p_kind = 'video' and coalesce((v_media ->> 'duration_ms')::numeric, 0) > 61000 then
      raise exception 'Video xabar 1 daqiqadan oshmasin.' using errcode = '22023';
    end if;
    v_body := left(v_body, 1000);
  elsif p_kind = 'share' then
    v_kind := p_share ->> 'kind';
    begin
      v_id := (p_share ->> 'id')::uuid;
    exception when others then
      raise exception 'Ulashilgan narsa topilmadi.' using errcode = '22023';
    end;
    -- Only what is one's own can be shared; the title is the database's, not the phone's.
    if v_kind = 'presentation' then
      select title into v_title from public.presentations where id = v_id and owner_id = v_me and status = 'ready';
    elsif v_kind = 'game' then
      select title into v_title from public.games where id = v_id and owner_id = v_me and status = 'ready';
    elsif v_kind = 'academic' then
      select topic into v_title from public.academic_works where id = v_id and owner_id = v_me;
    end if;
    if v_title is null then raise exception 'Ulashilgan narsa topilmadi.' using errcode = '22023'; end if;
    v_share := jsonb_build_object('kind', v_kind, 'id', v_id, 'title', v_title);
    v_body := left(v_body, 1000);
  else
    raise exception 'unknown message kind' using errcode = '22023';
  end if;

  insert into public.chat_messages (conversation_id, sender_id, kind, body, media_path, media, share, client_id)
  values (p_conversation_id, v_me, p_kind, v_body,
          case when p_kind in ('image', 'voice', 'video') then p_media_path end,
          case when p_kind in ('image', 'voice', 'video') then v_media - 'path' else '{}'::jsonb end,
          v_share, p_client_id)
  returning * into v_row;
  update public.chat_conversations set last_message_at = v_row.created_at where id = p_conversation_id;
  -- Sending is reading: one's own messages are never unread.
  update public.chat_members set last_read_at = v_row.created_at where conversation_id = p_conversation_id and user_id = v_me;
  return v_row;
end;
$$;
revoke all on function public.chat_send(uuid, text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.chat_send(uuid, text, text, text, jsonb, jsonb, text) to authenticated;

create or replace function public.chat_mark_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.chat_members set last_read_at = now()
   where conversation_id = p_conversation_id and user_id = auth.uid();
$$;
revoke all on function public.chat_mark_read(uuid) from public, anon;
grant execute on function public.chat_mark_read(uuid) to authenticated;

/** The caller's conversations, newest first: who, the last message, how many unread. */
create or replace function public.chat_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row order by (row ->> 'sort') desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', c.id,
      'sort', coalesce(c.last_message_at, c.created_at),
      'peer', public.chat_profile(peer.user_id),
      'peer_read_at', peer.last_read_at,
      'last', (
        select jsonb_build_object('kind', m.kind, 'body', left(m.body, 140), 'sender_id', m.sender_id,
                                  'created_at', m.created_at, 'share_title', m.share ->> 'title')
          from public.chat_messages m where m.conversation_id = c.id order by m.created_at desc limit 1
      ),
      'unread', (
        select count(*) from public.chat_messages m
         where m.conversation_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from me.user_id
      )
    ) as row
    from public.chat_members me
    join public.chat_conversations c on c.id = me.conversation_id
    join public.chat_members peer on peer.conversation_id = c.id and peer.user_id <> me.user_id
    where me.user_id = auth.uid()
      and (c.last_message_at is not null)
  ) listed;
$$;
revoke all on function public.chat_list() from public, anon;
grant execute on function public.chat_list() to authenticated;

/** Unread messages, muted conversations aside: the number on the tab. */
create or replace function public.chat_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.chat_members me
    join public.chat_messages m on m.conversation_id = me.conversation_id
   where me.user_id = auth.uid()
     and m.created_at > me.last_read_at
     and m.sender_id is distinct from me.user_id
     and not exists (
       select 1 from public.chat_contacts c
        where c.owner_id = me.user_id and c.contact_id = m.sender_id and c.muted
     );
$$;
revoke all on function public.chat_unread_total() from public, anon;
grant execute on function public.chat_unread_total() to authenticated;

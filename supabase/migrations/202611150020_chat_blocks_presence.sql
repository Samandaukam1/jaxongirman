-- Chat, finished (Jaxongirman.app 2.0, §5.4): blocking, and whether someone is here.
--
-- Blocking is one person's decision about another. Once A blocks B, neither
-- can send the other a message in their conversation — B is told only that
-- the message cannot be delivered, never that they were blocked — and neither
-- sees whether the other is online or when they were last seen. The history
-- stays; unblocking resumes the conversation where it was.
--
-- "Online" is not Realtime presence: a presence channel every user joins
-- would send every user every other user's comings and goings. Instead a
-- phone that is open says so every half minute (`chat_touch`), and says so
-- once more, with `online` false, when it goes to the background; someone is
-- online when they said so less than 75 seconds ago — a phone that dies
-- without saying goodbye drops off by itself. "Typing…" is a Realtime
-- broadcast between the two open conversations and never touches the
-- database.

create table if not exists public.chat_blocks (
  owner_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, blocked_id),
  constraint chat_blocks_not_self check (owner_id <> blocked_id)
);
alter table public.chat_blocks enable row level security;
revoke all on public.chat_blocks from public, anon, authenticated;
grant select on public.chat_blocks to authenticated;
drop policy if exists chat_blocks_own on public.chat_blocks;
create policy chat_blocks_own on public.chat_blocks for select to authenticated using (owner_id = (select auth.uid()));

create table if not exists public.chat_presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  online boolean not null default false,
  last_seen_at timestamptz not null default now()
);
alter table public.chat_presence enable row level security;
revoke all on public.chat_presence from public, anon, authenticated;

/** Whether either of two people has blocked the other. */
create or replace function public.chat_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_blocks
                  where (owner_id = p_a and blocked_id = p_b) or (owner_id = p_b and blocked_id = p_a));
$$;
revoke all on function public.chat_blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.chat_block(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_user is null or p_user = auth.uid() then raise exception 'O‘zingizni bloklab bo‘lmaydi.' using errcode = '22023'; end if;
  insert into public.chat_blocks (owner_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
end;
$$;

create or replace function public.chat_unblock(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.chat_blocks where owner_id = auth.uid() and blocked_id = p_user;
$$;

/**
 * The open app saying it is here (or, with `p_online` false, that it is going
 * to the background). At most once every 15 seconds is written; more often
 * changes nothing anyone could see.
 */
create or replace function public.chat_touch(p_online boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.chat_presence (user_id, online, last_seen_at) values (auth.uid(), coalesce(p_online, true), now())
  on conflict (user_id) do update set online = excluded.online, last_seen_at = excluded.last_seen_at
   where chat_presence.online is distinct from excluded.online
      or chat_presence.last_seen_at < now() - interval '15 seconds';
end;
$$;

/**
 * Whether someone is here and when they last were — as the caller may see it:
 * nothing at all between two people one of whom blocked the other.
 */
create or replace function public.chat_peer_status(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or public.chat_blocked_between(auth.uid(), p_user) then jsonb_build_object('online', false, 'last_seen_at', null)
    else jsonb_build_object(
      'online', coalesce((select pr.online and pr.last_seen_at > now() - interval '75 seconds' from public.chat_presence pr where pr.user_id = p_user), false),
      'last_seen_at', (select pr.last_seen_at from public.chat_presence pr where pr.user_id = p_user))
  end;
$$;

revoke all on function public.chat_block(uuid) from public, anon;
revoke all on function public.chat_unblock(uuid) from public, anon;
revoke all on function public.chat_touch(boolean) from public, anon;
revoke all on function public.chat_peer_status(uuid) from public, anon;
grant execute on function public.chat_block(uuid) to authenticated;
grant execute on function public.chat_unblock(uuid) to authenticated;
grant execute on function public.chat_touch(boolean) to authenticated;
grant execute on function public.chat_peer_status(uuid) to authenticated;

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
    'games', (select count(*) from public.games g where g.owner_id = p.id and g.status = 'ready' and g.kind <> 'mafia'),
    -- Blocking: whether the caller blocked them; and their presence, unless either blocked the other.
    'blocked', exists (select 1 from public.chat_blocks b where b.owner_id = auth.uid() and b.blocked_id = p.id),
    'online', case when public.chat_blocked_between(auth.uid(), p.id) then false
                   else coalesce((select pr.online and pr.last_seen_at > now() - interval '75 seconds' from public.chat_presence pr where pr.user_id = p.id), false) end,
    'last_seen_at', case when public.chat_blocked_between(auth.uid(), p.id) then null
                         else (select pr.last_seen_at from public.chat_presence pr where pr.user_id = p.id) end,
    'contact_name', c.display_name, 'muted', coalesce(c.muted, false), 'saved', c.contact_id is not null
  )
  from public.profiles p
  left join public.chat_contacts c on c.owner_id = auth.uid() and c.contact_id = p.id
  where p.id = p_user and auth.uid() is not null and p.status = 'active';
$$;


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
  -- Between two people one of whom blocked the other, nothing is delivered. The sender is not told which.
  if exists (select 1 from public.chat_members peer
              where peer.conversation_id = p_conversation_id and peer.user_id <> v_me
                and public.chat_blocked_between(v_me, peer.user_id)) then
    raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
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

/* -------------------------------------------------------------- editing */

-- A message its sender corrected says so: when, so the bubble can say "edited".
alter table public.chat_messages add column if not exists edited_at timestamptz;

/**
 * The sender corrects what they wrote: a text, or the words under a picture.
 * Within 48 hours, as Telegram allows, and not between people one of whom
 * blocked the other. The change reaches the other side as an UPDATE on the
 * row, which the open conversation already follows.
 */
create or replace function public.chat_edit(p_message_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.chat_messages%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_row from public.chat_messages where id = p_message_id for update;
  if not found or v_row.sender_id is distinct from v_me then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;
  if v_row.kind = 'share' then raise exception 'Bu xabarni tahrirlab bo‘lmaydi.' using errcode = '22023'; end if;
  if v_row.created_at < now() - interval '48 hours' then
    raise exception 'Xabarni faqat 48 soat ichida tahrirlash mumkin.' using errcode = '22023';
  end if;
  if v_row.kind = 'text' and char_length(v_body) not between 1 and 4000 then
    raise exception 'Xabar bo‘sh.' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then raise exception 'Xabar juda uzun.' using errcode = '22023'; end if;
  if exists (select 1 from public.chat_members peer
              where peer.conversation_id = v_row.conversation_id and peer.user_id <> v_me
                and public.chat_blocked_between(v_me, peer.user_id)) then
    raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
  end if;
  if v_row.body = v_body then return v_row; end if;
  update public.chat_messages set body = v_body, edited_at = now() where id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.chat_edit(uuid, text) from public, anon;
grant execute on function public.chat_edit(uuid, text) to authenticated;

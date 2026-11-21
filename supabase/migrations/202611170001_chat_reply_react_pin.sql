-- Chat, as Telegram does it (2.1): answering a message, reacting to it,
-- pinning it, passing it on, taking it back, clearing a conversation, an album
-- of up to ten pictures, and telling us about someone.
--
-- * A reply names the message it answers (`reply_to_id`); the answer shows a
--   quote of it, and a tap on the quote finds it.
-- * Reactions live on the message itself (`reactions`: who -> which emoji, one
--   each), so the other phone hears of them the way it hears of an edit.
-- * A pin is a time on the message (`pinned_at`); the bar under the header
--   shows the newest.
-- * Forwarding copies messages into another of the caller's conversations,
--   naming whom they first came from. Files are not copied: whoever can see a
--   message that names a file may read the file.
-- * Deleting: one's own message for both (it stays as a tombstone, emptied,
--   which the phones drop), or any message for oneself only. Clearing a
--   conversation hides everything before now — for oneself, or for both,
--   unless the other person keeps their history ("protect_history").
-- * A video message recorded in parts (the camera turned round while it
--   recorded) keeps its parts in `items`; the phones play them one after
--   another as one message.
-- * Reports land in a table the admins read and close.

-- --------------------------------------------------------------- columns --
alter table public.chat_messages drop constraint if exists chat_messages_kind_check;
alter table public.chat_messages add constraint chat_messages_kind_check
  check (kind in ('text', 'image', 'voice', 'video', 'share', 'album'));

alter table public.chat_messages
  add column if not exists reply_to_id uuid references public.chat_messages(id) on delete set null,
  add column if not exists forward_from_id uuid references auth.users(id) on delete set null,
  add column if not exists forward_from_name text check (forward_from_name is null or char_length(forward_from_name) <= 120),
  add column if not exists reactions jsonb not null default '{}'::jsonb check (jsonb_typeof(reactions) = 'object'),
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references auth.users(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists items jsonb check (items is null or (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 10));

create index if not exists chat_messages_pinned_idx on public.chat_messages (conversation_id, pinned_at desc) where pinned_at is not null;
create index if not exists chat_messages_media_path_idx on public.chat_messages (media_path) where media_path is not null;
create index if not exists chat_messages_items_idx on public.chat_messages using gin (items jsonb_path_ops) where items is not null;
create index if not exists chat_messages_reply_idx on public.chat_messages (reply_to_id) where reply_to_id is not null;

alter table public.chat_members
  add column if not exists cleared_at timestamptz,
  add column if not exists protect_history boolean not null default false;

comment on column public.chat_members.cleared_at is 'Messages up to this time are hidden from this member (cleared history).';
comment on column public.chat_members.protect_history is 'This member does not let the other clear the conversation for both.';

-- ---------------------------------------------------- hidden for one only --
create table if not exists public.chat_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists chat_hidden_message_idx on public.chat_hidden (message_id);
alter table public.chat_hidden enable row level security;
revoke all on public.chat_hidden from public, anon, authenticated;
grant select on public.chat_hidden to authenticated;
drop policy if exists chat_hidden_own on public.chat_hidden;
create policy chat_hidden_own on public.chat_hidden for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- reports --
create table if not exists public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  reported_id uuid references auth.users(id) on delete set null,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  reason text not null check (reason in ('spam', 'abuse', 'sexual', 'violence', 'fraud', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  excerpt text check (excerpt is null or char_length(excerpt) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create index if not exists chat_reports_status_idx on public.chat_reports (status, created_at desc);
create index if not exists chat_reports_reporter_idx on public.chat_reports (reporter_id, created_at desc);
alter table public.chat_reports enable row level security;
revoke all on public.chat_reports from public, anon, authenticated;

-- ------------------------------------------------------------- visibility --
/** Whether the caller sees a message: a member, after their own clearing, and not hidden by them. */
create or replace function public.chat_message_visible(p_conversation_id uuid, p_message_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.chat_members m
            where m.conversation_id = p_conversation_id and m.user_id = auth.uid()
              and (m.cleared_at is null or p_created_at > m.cleared_at))
     and not exists (select 1 from public.chat_hidden h where h.user_id = auth.uid() and h.message_id = p_message_id);
$$;
revoke all on function public.chat_message_visible(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.chat_message_visible(uuid, uuid, timestamptz) to authenticated;

drop policy if exists chat_messages_member on public.chat_messages;
create policy chat_messages_member on public.chat_messages for select to authenticated
  using (public.chat_message_visible(conversation_id, id, created_at));

/** Whether a message the caller can see names this file — so a forwarded picture opens in its new conversation. */
create or replace function public.chat_media_visible(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_messages m
      join public.chat_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
     where m.deleted_at is null
       and (m.media_path = p_path
            or (m.items is not null and m.items @> jsonb_build_array(jsonb_build_object('path', p_path)))));
$$;
revoke all on function public.chat_media_visible(text) from public, anon;
grant execute on function public.chat_media_visible(text) to authenticated;

drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and (
    ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' and (select public.chat_is_member(((storage.foldername(name))[1])::uuid)))
    or public.chat_media_visible(name)));

-- ------------------------------------------------------------------- send --
drop function if exists public.chat_send(uuid, text, text, text, jsonb, jsonb, text);

create or replace function public.chat_send(
  p_conversation_id uuid,
  p_kind text,
  p_body text default '',
  p_media_path text default null,
  p_media jsonb default '{}'::jsonb,
  p_share jsonb default null,
  p_client_id text default null,
  p_reply_to uuid default null,
  p_items jsonb default null
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
  v_items jsonb;
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
  if p_reply_to is not null and not exists (
       select 1 from public.chat_messages r
        where r.id = p_reply_to and r.conversation_id = p_conversation_id and r.deleted_at is null) then
    raise exception 'Javob berilayotgan xabar topilmadi.' using errcode = '22023';
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
    -- A video message recorded in parts (the camera turned round mid-message): every part in order, the first being the file itself.
    if p_kind = 'video' and p_items is not null then
      if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 2 and 10 then
        raise exception 'Video xabar 2 tadan 10 tagacha bo‘lakdan iborat bo‘lsin.' using errcode = '22023';
      end if;
      select jsonb_agg(jsonb_build_object(
               'path', e ->> 'path',
               'duration_ms', case when (e ->> 'duration_ms') ~ '^\d{1,6}$' then (e ->> 'duration_ms')::integer end) order by ord)
        into v_items
        from jsonb_array_elements(p_items) with ordinality as listed(e, ord);
      if (v_items -> 0 ->> 'path') is distinct from p_media_path
         or exists (select 1 from jsonb_array_elements(v_items) e
                     where (e ->> 'path') is null
                        or (e ->> 'path') not like p_conversation_id::text || '/' || v_me::text || '/%'
                        or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = e ->> 'path')) then
        raise exception 'Fayl topilmadi.' using errcode = '22023';
      end if;
    end if;
    v_body := left(v_body, 1000);
  elsif p_kind = 'album' then
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 2 and 10 then
      raise exception 'Albomda 2 tadan 10 tagacha rasm bo‘lsin.' using errcode = '22023';
    end if;
    -- Only path and size are kept, in the order sent; every file must be the sender's own in this conversation.
    select jsonb_agg(jsonb_build_object(
             'path', e ->> 'path',
             'width', case when (e ->> 'width') ~ '^\d{1,5}$' then (e ->> 'width')::integer end,
             'height', case when (e ->> 'height') ~ '^\d{1,5}$' then (e ->> 'height')::integer end) order by ord)
      into v_items
      from jsonb_array_elements(p_items) with ordinality as listed(e, ord);
    if exists (select 1 from jsonb_array_elements(v_items) e
                where (e ->> 'path') is null
                   or (e ->> 'path') not like p_conversation_id::text || '/' || v_me::text || '/%'
                   or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = e ->> 'path')) then
      raise exception 'Fayl topilmadi.' using errcode = '22023';
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

  insert into public.chat_messages (conversation_id, sender_id, kind, body, media_path, media, share, items, client_id, reply_to_id)
  values (p_conversation_id, v_me, p_kind, v_body,
          case when p_kind in ('image', 'voice', 'video') then p_media_path end,
          case when p_kind in ('image', 'voice', 'video') then v_media - 'path' else '{}'::jsonb end,
          v_share, v_items, p_client_id, p_reply_to)
  returning * into v_row;
  update public.chat_conversations set last_message_at = v_row.created_at where id = p_conversation_id;
  -- Sending is reading: one's own messages are never unread.
  update public.chat_members set last_read_at = v_row.created_at where conversation_id = p_conversation_id and user_id = v_me;
  return v_row;
end;
$$;
revoke all on function public.chat_send(uuid, text, text, text, jsonb, jsonb, text, uuid, jsonb) from public, anon;
grant execute on function public.chat_send(uuid, text, text, text, jsonb, jsonb, text, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------- edit --
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
  if not found or v_row.sender_id is distinct from v_me or v_row.deleted_at is not null then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;
  if v_row.kind = 'share' or v_row.forward_from_id is not null then
    raise exception 'Bu xabarni tahrirlab bo‘lmaydi.' using errcode = '22023';
  end if;
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

-- -------------------------------------------------------------- reactions --
/** One reaction per person per message: the same emoji again takes it back, another replaces it, none clears it. */
create or replace function public.chat_react(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.chat_messages%rowtype;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_row from public.chat_messages where id = p_message_id for update;
  if not found or v_row.deleted_at is not null
     or not public.chat_message_visible(v_row.conversation_id, v_row.id, v_row.created_at) then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;
  if v_emoji is not null and (char_length(v_emoji) > 16 or v_emoji ~ '[[:alnum:][:space:]<>"''\\]') then
    raise exception 'Bu reaksiya emas.' using errcode = '22023';
  end if;
  if exists (select 1 from public.chat_members peer
              where peer.conversation_id = v_row.conversation_id and peer.user_id <> v_me
                and public.chat_blocked_between(v_me, peer.user_id)) then
    raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
  end if;
  if v_emoji is null or v_row.reactions ->> v_me::text = v_emoji then
    update public.chat_messages set reactions = reactions - v_me::text where id = v_row.id returning * into v_row;
  else
    update public.chat_messages set reactions = reactions || jsonb_build_object(v_me::text, v_emoji) where id = v_row.id returning * into v_row;
  end if;
  return v_row.reactions;
end;
$$;
revoke all on function public.chat_react(uuid, text) from public, anon;
grant execute on function public.chat_react(uuid, text) to authenticated;

-- ------------------------------------------------------------------- pins --
create or replace function public.chat_pin(p_message_id uuid, p_pinned boolean default true)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_row public.chat_messages%rowtype;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_row from public.chat_messages where id = p_message_id for update;
  if not found or v_row.deleted_at is not null
     or not public.chat_message_visible(v_row.conversation_id, v_row.id, v_row.created_at) then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;
  update public.chat_messages
     set pinned_at = case when coalesce(p_pinned, true) then now() end,
         pinned_by = case when coalesce(p_pinned, true) then v_me end
   where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.chat_pin(uuid, boolean) from public, anon;
grant execute on function public.chat_pin(uuid, boolean) to authenticated;

-- ------------------------------------------------------------- forwarding --
/**
 * Copies messages (up to 50, in the order they were written) into the
 * caller's conversations (up to 10). Each copy names whom it first came from;
 * a file is shared by name, not copied.
 */
create or replace function public.chat_forward(p_message_ids uuid[], p_conversation_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid;
  v_count integer := 0;
  v_added integer;
  v_last timestamptz;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) not between 1 and 50 then
    raise exception 'Uzatish uchun 1 tadan 50 tagacha xabar tanlang.' using errcode = '22023';
  end if;
  if coalesce(array_length(p_conversation_ids, 1), 0) not between 1 and 10 then
    raise exception 'Uzatish uchun 1 tadan 10 tagacha suhbat tanlang.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_message_ids) as wanted(id)
              where not exists (select 1 from public.chat_messages m
                                 where m.id = wanted.id and m.deleted_at is null
                                   and public.chat_message_visible(m.conversation_id, m.id, m.created_at))) then
    raise exception 'Xabar topilmadi.' using errcode = 'P0002';
  end if;

  foreach v_target in array (select array_agg(distinct t) from unnest(p_conversation_ids) as t) loop
    if not exists (select 1 from public.chat_members where conversation_id = v_target and user_id = v_me) then
      raise exception 'conversation not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.chat_members peer
                where peer.conversation_id = v_target and peer.user_id <> v_me
                  and public.chat_blocked_between(v_me, peer.user_id)) then
      raise exception 'Bu foydalanuvchiga xabar yuborib bo‘lmaydi.' using errcode = '42501', detail = 'blocked';
    end if;
    -- A millisecond apart, so the copies keep the order the originals had.
    with picked as (
      select m.*, row_number() over (order by m.created_at, m.id) as ord
        from public.chat_messages m
       where m.id = any(p_message_ids)
    ), inserted as (
      insert into public.chat_messages
        (conversation_id, sender_id, kind, body, media_path, media, share, items, forward_from_id, forward_from_name, created_at)
      select v_target, v_me, s.kind, s.body, s.media_path, s.media, s.share, s.items,
             coalesce(s.forward_from_id, s.sender_id),
             coalesce(s.forward_from_name,
                      (select coalesce(nullif(btrim(p.full_name), ''), '@' || p.username) from public.profiles p where p.id = s.sender_id)),
             now() + (s.ord * interval '1 millisecond')
        from picked s
      returning created_at
    )
    select count(*), max(created_at) into v_added, v_last from inserted;
    v_count := v_count + v_added;
    update public.chat_conversations set last_message_at = v_last where id = v_target;
    update public.chat_members set last_read_at = v_last where conversation_id = v_target and user_id = v_me;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.chat_forward(uuid[], uuid[]) from public, anon;
grant execute on function public.chat_forward(uuid[], uuid[]) to authenticated;

-- --------------------------------------------------------------- deleting --
/**
 * For both: only one's own messages, emptied and stamped `deleted_at` (the
 * phones drop them as the change arrives). For oneself: any message one can
 * see, hidden from oneself alone.
 */
create or replace function public.chat_delete(p_message_ids uuid[], p_for_everyone boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_count integer;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if coalesce(array_length(p_message_ids, 1), 0) not between 1 and 100 then
    raise exception 'Xabarlarni tanlang.' using errcode = '22023';
  end if;
  if coalesce(p_for_everyone, false) then
    if exists (select 1 from unnest(p_message_ids) as wanted(id)
                where not exists (select 1 from public.chat_messages m where m.id = wanted.id and m.sender_id = v_me)) then
      raise exception 'Faqat o‘z xabaringizni ikkala tomon uchun o‘chirish mumkin.' using errcode = '42501';
    end if;
    update public.chat_messages
       set deleted_at = now(), body = '', media_path = null, media = '{}'::jsonb, share = null, items = null,
           reactions = '{}'::jsonb, pinned_at = null, pinned_by = null
     where id = any(p_message_ids) and sender_id = v_me and deleted_at is null;
    get diagnostics v_count = row_count;
  else
    insert into public.chat_hidden (user_id, message_id)
    select v_me, m.id from public.chat_messages m
     where m.id = any(p_message_ids) and public.chat_message_visible(m.conversation_id, m.id, m.created_at)
    on conflict do nothing;
    get diagnostics v_count = row_count;
  end if;
  return v_count;
end;
$$;
revoke all on function public.chat_delete(uuid[], boolean) from public, anon;
grant execute on function public.chat_delete(uuid[], boolean) to authenticated;

-- --------------------------------------------------------------- clearing --
/** Hides the whole history so far — for oneself, or for both unless the other keeps theirs. */
create or replace function public.chat_clear(p_conversation_id uuid, p_for_everyone boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_members where conversation_id = p_conversation_id and user_id = v_me) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if coalesce(p_for_everyone, false) then
    if exists (select 1 from public.chat_members
                where conversation_id = p_conversation_id and user_id <> v_me and protect_history) then
      raise exception 'Suhbatdosh yozishmani ikki tomonlama tozalashni cheklagan.' using errcode = '42501', detail = 'protected';
    end if;
    update public.chat_members set cleared_at = now() where conversation_id = p_conversation_id;
    update public.chat_messages set pinned_at = null, pinned_by = null
     where conversation_id = p_conversation_id and pinned_at is not null;
  else
    update public.chat_members set cleared_at = now() where conversation_id = p_conversation_id and user_id = v_me;
  end if;
end;
$$;
revoke all on function public.chat_clear(uuid, boolean) from public, anon;
grant execute on function public.chat_clear(uuid, boolean) to authenticated;

/** Whether the other person may clear this conversation for both. */
create or replace function public.chat_protect_history(p_conversation_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  update public.chat_members set protect_history = coalesce(p_on, false)
   where conversation_id = p_conversation_id and user_id = v_me;
  if not found then raise exception 'conversation not found' using errcode = 'P0002'; end if;
  return coalesce(p_on, false);
end;
$$;
revoke all on function public.chat_protect_history(uuid, boolean) from public, anon;
grant execute on function public.chat_protect_history(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- reports --
/** Tells the admins about the other person of a conversation, or about one of their messages. */
create or replace function public.chat_report(p_conversation_id uuid, p_reason text, p_message_id uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_peer uuid;
  v_excerpt text;
  v_id uuid;
begin
  if v_me is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (select 1 from public.chat_members where conversation_id = p_conversation_id and user_id = v_me) then
    raise exception 'conversation not found' using errcode = 'P0002';
  end if;
  if p_reason is null or p_reason not in ('spam', 'abuse', 'sexual', 'violence', 'fraud', 'other') then
    raise exception 'Sababni tanlang.' using errcode = '22023';
  end if;
  if (select count(*) from public.chat_reports where reporter_id = v_me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Bugun juda ko‘p shikoyat yuborildi. Ertaga urinib ko‘ring.' using errcode = '54000';
  end if;
  select user_id into v_peer from public.chat_members where conversation_id = p_conversation_id and user_id <> v_me limit 1;
  if p_message_id is not null then
    select case when m.kind = 'text' then left(m.body, 1000) else '[' || m.kind || '] ' || left(m.body, 900) end
      into v_excerpt
      from public.chat_messages m
     where m.id = p_message_id and m.conversation_id = p_conversation_id;
    if not found then raise exception 'Xabar topilmadi.' using errcode = 'P0002'; end if;
  end if;
  insert into public.chat_reports (reporter_id, reported_id, conversation_id, message_id, reason, note, excerpt)
  values (v_me, v_peer, p_conversation_id, p_message_id, p_reason, nullif(left(btrim(coalesce(p_note, '')), 1000), ''), v_excerpt)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.chat_report(uuid, text, uuid, text) from public, anon;
grant execute on function public.chat_report(uuid, text, uuid, text) to authenticated;

/** The admins' list of reports, newest first, with who and what. */
create or replace function public.admin_chat_reports(p_status text default 'open', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'reason', r.reason, 'note', r.note, 'excerpt', r.excerpt, 'status', r.status,
             'created_at', r.created_at, 'resolved_at', r.resolved_at, 'message_id', r.message_id,
             'reporter', jsonb_build_object('id', a.id, 'full_name', a.full_name, 'username', a.username),
             'reported', jsonb_build_object('id', b.id, 'full_name', b.full_name, 'username', b.username),
             'reports_against', (select count(*) from public.chat_reports x where x.reported_id = r.reported_id))
           order by r.created_at desc)
      from (select * from public.chat_reports
             where p_status is null or status = p_status
             order by created_at desc
             limit greatest(1, least(coalesce(p_limit, 100), 500))) r
      left join public.profiles a on a.id = r.reporter_id
      left join public.profiles b on b.id = r.reported_id), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_chat_reports(text, integer) from public, anon;
grant execute on function public.admin_chat_reports(text, integer) to authenticated;

create or replace function public.admin_chat_report_close(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_status not in ('resolved', 'dismissed', 'open') then raise exception 'status' using errcode = '22023'; end if;
  update public.chat_reports
     set status = p_status,
         resolved_at = case when p_status = 'open' then null else now() end,
         resolved_by = case when p_status = 'open' then null else auth.uid() end
   where id = p_id;
  if not found then raise exception 'Shikoyat topilmadi.' using errcode = 'P0002'; end if;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (auth.uid(), 'chat_report_' || p_status, 'chat_report', p_id::text, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.admin_chat_report_close(uuid, text) from public, anon;
grant execute on function public.admin_chat_report_close(uuid, text) to authenticated;

-- --------------------------------------------------------- list and badge --
/** The caller's conversations, newest first: who, the last message they still see, how many unread. */
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
                                  'created_at', m.created_at, 'share_title', m.share ->> 'title',
                                  'count', coalesce(jsonb_array_length(m.items), 0),
                                  'forwarded', m.forward_from_id is not null)
          from public.chat_messages m
         where m.conversation_id = c.id and m.deleted_at is null
           and (me.cleared_at is null or m.created_at > me.cleared_at)
           and not exists (select 1 from public.chat_hidden h where h.user_id = me.user_id and h.message_id = m.id)
         order by m.created_at desc limit 1
      ),
      'unread', (
        select count(*) from public.chat_messages m
         where m.conversation_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from me.user_id
           and m.deleted_at is null
           and (me.cleared_at is null or m.created_at > me.cleared_at)
           and not exists (select 1 from public.chat_hidden h where h.user_id = me.user_id and h.message_id = m.id)
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
     and m.deleted_at is null
     and (me.cleared_at is null or m.created_at > me.cleared_at)
     and not exists (select 1 from public.chat_hidden h where h.user_id = me.user_id and h.message_id = m.id)
     and not exists (
       select 1 from public.chat_contacts c
        where c.owner_id = me.user_id and c.contact_id = m.sender_id and c.muted
     );
$$;
revoke all on function public.chat_unread_total() from public, anon;
grant execute on function public.chat_unread_total() to authenticated;

-- ------------------------------------------------------------------- push --
create or replace function public.push_chat_preview(p_kind text, p_body text, p_share jsonb, p_language text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'text' then left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 180)
    when 'image' then case p_language when 'ru' then 'Фото' when 'en' then 'Photo' when 'tr' then 'Fotoğraf' else 'Rasm' end
    when 'album' then case p_language when 'ru' then 'Фотографии' when 'en' then 'Photos' when 'tr' then 'Fotoğraflar' else 'Rasmlar' end
    when 'voice' then case p_language when 'ru' then 'Голосовое сообщение' when 'en' then 'Voice message' when 'tr' then 'Sesli mesaj' else 'Ovozli xabar' end
    when 'video' then case p_language when 'ru' then 'Видеосообщение' when 'en' then 'Video message' when 'tr' then 'Görüntülü mesaj' else 'Video xabar' end
    when 'share' then case p_language when 'ru' then 'Отправлено: ' when 'en' then 'Shared: ' when 'tr' then 'Paylaşıldı: ' else 'Ulaşildi: ' end
                      || coalesce(p_share ->> 'title', '')
    else ''
  end;
$$;

-- ------------------------------------------------------ library from a card --
create or replace function public.chat_library_copy(p_message_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.chat_messages%rowtype;
  v_kind text;
  v_source uuid;
  v_owner uuid;
  v_new uuid := gen_random_uuid();
  v_from text;
  v_to text;
  v_files jsonb := '[]'::jsonb;
  v_slides jsonb;
  v_existing uuid;
  v_now timestamptz := now();
begin
  select * into v_message from public.chat_messages where id = p_message_id;
  if not found or v_message.kind <> 'share' or v_message.share is null
     or not exists (select 1 from public.chat_members m where m.conversation_id = v_message.conversation_id and m.user_id = p_user) then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  v_kind := v_message.share ->> 'kind';
  v_source := (v_message.share ->> 'id')::uuid;
  -- A forwarded card still belongs to whoever first sent it.
  v_owner := coalesce(v_message.forward_from_id, v_message.sender_id);
  if v_owner = p_user then
    return jsonb_build_object('kind', v_kind, 'id', v_source, 'files', '[]'::jsonb);
  end if;

  select c.item_id into v_existing from public.chat_library_copies c where c.message_id = p_message_id and c.user_id = p_user;
  if v_existing is not null and (
    (v_kind = 'presentation' and exists (select 1 from public.presentations where id = v_existing))
    or (v_kind = 'game' and exists (select 1 from public.games where id = v_existing))
    or (v_kind = 'academic' and exists (select 1 from public.academic_works where id = v_existing))
  ) then
    return jsonb_build_object('kind', v_kind, 'id', v_existing, 'files', '[]'::jsonb);
  end if;

  v_from := v_owner::text || '/' || v_source::text || '/';
  v_to := p_user::text || '/' || v_new::text || '/';

  if v_kind = 'game' then
    perform set_config('jaxongirman.copying', 'on', true);
    insert into public.games
      select * from jsonb_populate_record(null::public.games, (
        select to_jsonb(g) || jsonb_build_object(
          'id', v_new, 'owner_id', p_user, 'cover_path', null, 'is_free', false, 'featured_at', null,
          'question_count', 0, 'sessions_count', 0, 'store_autopublish', 'off', 'store_autopublish_at', null,
          'source_presentation_id', null, 'created_at', v_now, 'updated_at', v_now)
          from public.games g where g.id = v_source and g.owner_id = v_owner));
    if not exists (select 1 from public.games where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;
    perform set_config('jaxongirman.copying', 'off', true);
    insert into public.game_questions
      select (jsonb_populate_record(null::public.game_questions, to_jsonb(q) || jsonb_build_object(
        'id', gen_random_uuid(), 'game_id', v_new, 'owner_id', p_user,
        'media_path', public.chat_library_path(q.media_path, v_from, v_to), 'created_at', v_now, 'updated_at', v_now))).*
        from public.game_questions q where q.game_id = v_source order by q.position;
    select coalesce(jsonb_agg(jsonb_build_object('bucket', 'game-assets', 'from', q.media_path,
             'to', public.chat_library_path(q.media_path, v_from, v_to))), '[]'::jsonb)
      into v_files from public.game_questions q where q.game_id = v_source and q.media_path like v_from || '%';

  elsif v_kind = 'academic' then
    insert into public.academic_works
      select * from jsonb_populate_record(null::public.academic_works, (
        select to_jsonb(w) || jsonb_build_object('id', v_new, 'owner_id', p_user, 'spent_credits', 0, 'estimated_credits', 0,
          'created_at', v_now, 'updated_at', v_now)
          from public.academic_works w where w.id = v_source and w.owner_id = v_owner));
    if not exists (select 1 from public.academic_works where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;
    insert into public.academic_sections
      select (jsonb_populate_record(null::public.academic_sections, to_jsonb(s) || jsonb_build_object(
        'id', gen_random_uuid(), 'work_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.academic_sections s where s.work_id = v_source;

  elsif v_kind = 'presentation' then
    insert into public.presentations
      select * from jsonb_populate_record(null::public.presentations, (
        select to_jsonb(p) || jsonb_build_object(
          'id', v_new, 'owner_id', p_user, 'thumbnail_path', null,
          'estimated_credits', 0, 'reserved_credits', 0, 'actual_credits', 0, 'generation_cost_usd', 0,
          'created_at', v_now, 'updated_at', v_now)
          from public.presentations p where p.id = v_source and p.owner_id = v_owner and p.status = 'ready'));
    if not exists (select 1 from public.presentations where id = v_new) then
      raise exception 'Muallif bu ishni o‘chirgan.' using errcode = 'P0002';
    end if;

    select coalesce(jsonb_object_agg(s.id::text, gen_random_uuid()), '{}'::jsonb) into v_slides
      from public.slides s where s.presentation_id = v_source;
    insert into public.slides
      select (jsonb_populate_record(null::public.slides, to_jsonb(s) || jsonb_build_object(
        'id', v_slides ->> s.id::text, 'presentation_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.slides s where s.presentation_id = v_source;
    insert into public.slide_elements
      select (jsonb_populate_record(null::public.slide_elements, to_jsonb(e) || jsonb_build_object(
        'id', gen_random_uuid(), 'slide_id', v_slides ->> e.slide_id::text, 'presentation_id', v_new, 'owner_id', p_user,
        'content', case when jsonb_typeof(e.content) = 'object' and (e.content ->> 'storagePath') like v_from || '%'
                        then e.content || jsonb_build_object('storagePath', public.chat_library_path(e.content ->> 'storagePath', v_from, v_to))
                        else e.content end,
        'created_at', v_now, 'updated_at', v_now))).*
        from public.slide_elements e where e.presentation_id = v_source;

    insert into public.presentation_assets
      select (jsonb_populate_record(null::public.presentation_assets, to_jsonb(a) || jsonb_build_object(
        'id', gen_random_uuid(), 'presentation_id', v_new, 'owner_id', p_user,
        'storage_path', public.chat_library_path(a.storage_path, v_from, v_to), 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_assets a where a.presentation_id = v_source;
    insert into public.presentation_sources
      select (jsonb_populate_record(null::public.presentation_sources, to_jsonb(s) || jsonb_build_object(
        'id', gen_random_uuid(), 'presentation_id', v_new, 'owner_id', p_user, 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_sources s where s.presentation_id = v_source;
    -- The defence script goes with the deck; its PDF is drawn again for the new owner.
    insert into public.presentation_defenses
      select (jsonb_populate_record(null::public.presentation_defenses, to_jsonb(d) || jsonb_build_object(
        'presentation_id', v_new, 'owner_id', p_user, 'pdf_path', null, 'pdf_rendered_at', null, 'created_at', v_now, 'updated_at', v_now))).*
        from public.presentation_defenses d where d.presentation_id = v_source;

    select coalesce(jsonb_agg(distinct jsonb_build_object('bucket', f.bucket, 'from', f.path, 'to', public.chat_library_path(f.path, v_from, v_to))), '[]'::jsonb)
      into v_files
      from (
        select e.content ->> 'storageBucket' as bucket, e.content ->> 'storagePath' as path
          from public.slide_elements e
         where e.presentation_id = v_source and jsonb_typeof(e.content) = 'object' and (e.content ->> 'storagePath') like v_from || '%'
        union
        select a.storage_bucket, a.storage_path from public.presentation_assets a
         where a.presentation_id = v_source and a.storage_path like v_from || '%'
      ) f
     where f.bucket in ('user-uploads', 'presentation-assets', 'generated-images', 'stock-images');
  else
    raise exception 'unknown share' using errcode = '22023';
  end if;

  insert into public.chat_library_copies (message_id, user_id, kind, item_id) values (p_message_id, p_user, v_kind, v_new)
    on conflict (message_id, user_id) do update set item_id = excluded.item_id, created_at = now();
  return jsonb_build_object('kind', v_kind, 'id', v_new, 'files', v_files);
end;
$$;

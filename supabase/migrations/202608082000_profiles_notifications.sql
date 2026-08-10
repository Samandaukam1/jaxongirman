-- Richer profiles, an in-app notification inbox, and an admin gift flow that
-- writes both in one transaction so a granted coin and the message announcing
-- it can never disagree.

-- ---------------------------------------------------------------- profiles --
alter table public.profiles
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists username text,
  add column if not exists bio text not null default '';

alter table public.profiles
  drop constraint if exists profiles_username_shape,
  drop constraint if exists profiles_bio_length,
  drop constraint if exists profiles_name_parts_length;

alter table public.profiles
  add constraint profiles_username_shape check (username is null or username ~ '^[a-z0-9_]{3,24}$'),
  add constraint profiles_bio_length check (char_length(bio) <= 280),
  add constraint profiles_name_parts_length check (char_length(first_name) <= 60 and char_length(last_name) <= 60);

-- Case-insensitive uniqueness: @Jaxongir and @jaxongir are the same handle.
create unique index if not exists profiles_username_key on public.profiles (lower(username)) where username is not null;

-- Existing rows only carry full_name; split it once so nothing looks empty.
update public.profiles
set first_name = split_part(btrim(full_name), ' ', 1),
    last_name = btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1))
where full_name <> '' and first_name = '' and last_name = '';

/** full_name stays the single display string the rest of the system reads. */
create or replace function public.sync_profile_full_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.first_name <> '' or new.last_name <> '' then
    new.full_name := btrim(new.first_name || ' ' || new.last_name);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_full_name on public.profiles;
create trigger profiles_sync_full_name
  before insert or update of first_name, last_name on public.profiles
  for each row execute function public.sync_profile_full_name();

grant update (full_name, avatar_url, last_seen_at, first_name, last_name, username, bio) on public.profiles to authenticated;

-- ----------------------------------------------------------- notifications --
create type public.notification_kind as enum ('credit_gift', 'system', 'presentation');

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.notification_kind not null default 'system',
  title text not null,
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_title_length check (char_length(title) between 1 and 160),
  constraint notifications_body_length check (char_length(body) <= 500)
);

-- The inbox is always read newest-first for one person, and the badge counts
-- that person's unread rows; both are this index.
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
-- A person may mark their own messages read; nothing else about a row is
-- theirs to change, and only the server ever creates one.
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- This schema hands out table privileges explicitly rather than relying on
-- defaults, so RLS policies alone would still leave the inbox unreadable.
-- Reading is allowed; the only column a person may write is the read receipt.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;

/** Marks one message, or the whole inbox, as read. Returns rows affected. */
create or replace function public.mark_notifications_read(p_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  update public.notifications
    set read_at = now()
    where user_id = v_user and read_at is null and (p_id is null or id = p_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- --------------------------------------------------------------- gifting --
/**
 * Grants credits and announces them together. Built on the same wallet, ledger
 * and audit writes as admin_adjust_credits — a gift is an admin adjustment that
 * the recipient gets told about.
 */
create or replace function public.admin_gift_credits(
  p_user_id uuid,
  p_amount integer,
  p_message text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_key text;
  v_before public.credit_wallets%rowtype;
  v_after public.credit_wallets%rowtype;
  v_notification uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'gift amount must be greater than zero' using errcode = '22023';
  end if;

  v_key := 'gift:' || coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  select * into v_before from public.credit_wallets where user_id = p_user_id for update;
  if not found then raise exception 'credit wallet not found' using errcode = 'P0002'; end if;

  -- Only the presence of the ledger row matters, never its contents.
  if exists (
    select 1 from public.credit_transactions
    where user_id = p_user_id and idempotency_key = v_key
  ) then
    return jsonb_build_object('applied', false, 'balance', v_before.balance, 'message', 'already granted');
  end if;

  update public.credit_wallets
    set balance = balance + p_amount,
        lifetime_granted = lifetime_granted + p_amount,
        version = version + 1
    where user_id = p_user_id
    returning * into v_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description, created_by, metadata
  ) values (
    p_user_id, 'admin_adjustment', p_amount, v_after.balance, v_after.reserved, v_key,
    left(btrim(coalesce(nullif(p_message, ''), 'Sovg‘a tangalar')), 500), v_admin,
    jsonb_build_object('gift', true, 'previous_balance', v_before.balance)
  );

  insert into public.notifications (user_id, kind, title, body, payload)
  values (
    p_user_id, 'credit_gift',
    p_amount || ' tanga sovg‘a qilindi!',
    left(btrim(coalesce(nullif(p_message, ''), 'Jaxongirman jamoasidan sizga sovg‘a. Yangi taqdimot yaratishda foydalaning.')), 500),
    jsonb_build_object('amount', p_amount, 'balance', v_after.balance)
  )
  returning id into v_notification;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin, 'credits.gift', 'user', p_user_id::text, to_jsonb(v_before), to_jsonb(v_after),
          left(btrim(coalesce(p_message, 'Sovg‘a')), 500));

  return jsonb_build_object(
    'applied', true, 'amount', p_amount,
    'previous_balance', v_before.balance, 'balance', v_after.balance,
    'notification_id', v_notification
  );
end;
$$;

-- --------------------------------------------------------------- avatars --
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Public read so an avatar renders without a signed URL round trip; writes stay
-- scoped to the folder named after the owner's id.
create policy avatars_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

revoke all on function public.mark_notifications_read(uuid) from public;
revoke all on function public.mark_notifications_read(uuid) from anon;
grant execute on function public.mark_notifications_read(uuid) to authenticated;

revoke all on function public.admin_gift_credits(uuid, integer, text, text) from public;
revoke all on function public.admin_gift_credits(uuid, integer, text, text) from anon;
grant execute on function public.admin_gift_credits(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_gift_credits(uuid, integer, text, text) to service_role;

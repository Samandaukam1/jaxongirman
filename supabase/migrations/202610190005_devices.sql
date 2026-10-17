-- The devices an account is signed in on, and taking them out.
--
-- Every signed-in phone or browser is one row of `auth.sessions`; its JWT
-- carries that row's id as `session_id`. Each client names itself once per
-- session (`device_register`: platform, model or browser, app version), and
-- the account sees the list on the phone (Profil → Qurilmalar) and on the
-- website. Taking a device out deletes its session — its refresh token goes
-- with it — and the device signs itself out the next time it checks in.
--
-- The rule is the one a stolen phone must not be able to use against its
-- owner: a device may take out a device that signed in *after* it at any time,
-- but one that signed in *before* it only once it has itself been signed in
-- for two hours. A device that just appeared cannot lock the owner out; the
-- owner's older device can remove it at once.
--
-- A new device announces itself: the account's other devices get a
-- notification "Yangi qurilmadan kirildi — bu sizmisiz?" and a card on the
-- home screen, answered with "Ha, bu men" or by taking it out.

alter type public.notification_kind add value if not exists 'new_device';

create table if not exists public.user_devices (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  name text,
  app_version text,
  signed_in_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  confirmed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_devices_user on public.user_devices (user_id, signed_in_at desc);

alter table public.user_devices enable row level security;
revoke all on public.user_devices from public, anon, authenticated;
grant select on public.user_devices to authenticated;
drop policy if exists user_devices_owner_select on public.user_devices;
create policy user_devices_owner_select on public.user_devices
  for select to authenticated using (user_id = (select auth.uid()));

comment on table public.user_devices is
  'What each signed-in session says it is; the session itself is auth.sessions. Written only by the device_* functions.';

/** How long a device must have been signed in before it may take out an older one. */
create or replace function public.device_seniority()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 hours'; $$;

/** The session this request is made with. */
create or replace function public.current_session_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(auth.jwt() ->> 'session_id', '')::uuid; $$;

/**
 * This device, named. Answers `active: false` when its session is gone — it was
 * taken out from another device — so the client signs itself out.
 */
create or replace function public.device_register(p_platform text, p_name text default null, p_app_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.current_session_id();
  v_signed timestamptz;
  v_inserted boolean;
  v_others integer;
  v_fresh boolean;
  v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 80);
  v_platform text := lower(btrim(coalesce(p_platform, '')));
begin
  if v_user is null or v_session is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if v_platform not in ('ios', 'android', 'web') then
    raise exception 'unknown platform' using errcode = '22023';
  end if;

  select s.created_at into v_signed from auth.sessions s where s.id = v_session and s.user_id = v_user;
  if not found then
    return jsonb_build_object('active', false);
  end if;

  -- Only a sign-in that just happened is news. A session that has existed for
  -- a while and names itself for the first time is a phone that installed the
  -- build that names devices — not a new device, and nobody should be asked
  -- "is this you?" about their own phone after an update.
  v_fresh := v_signed > now() - interval '30 minutes';

  select count(*) into v_others
    from auth.sessions s
    left join public.user_devices d on d.session_id = s.id
   where s.user_id = v_user and s.id <> v_session and d.revoked_at is null;

  insert into public.user_devices (session_id, user_id, platform, name, app_version, signed_in_at, confirmed_at)
  values (v_session, v_user, v_platform, v_name, left(nullif(btrim(coalesce(p_app_version, '')), ''), 40), v_signed,
          -- The account's only device, or one that is not new, has nobody to ask.
          case when v_others = 0 or not v_fresh then now() end)
  on conflict (session_id) do update set
    last_seen_at = now(),
    platform = excluded.platform,
    name = coalesce(excluded.name, public.user_devices.name),
    app_version = coalesce(excluded.app_version, public.user_devices.app_version)
  returning (xmax = 0) into v_inserted;

  if v_inserted and v_fresh and v_others > 0 then
    insert into public.notifications (user_id, kind, title, body, payload, deep_link, entity_id)
    values (
      v_user,
      'new_device'::public.notification_kind,
      'Yangi qurilmadan kirildi',
      coalesce(v_name, case v_platform when 'web' then 'Brauzer' when 'ios' then 'iPhone' else 'Android' end)
        || ' — bu sizmisiz? Siz bo‘lmasangiz, uni darhol chiqarib yuboring.',
      jsonb_build_object('session_id', v_session, 'platform', v_platform, 'name', v_name),
      '/(app)/devices',
      v_session
    );
  end if;

  return jsonb_build_object('active', true, 'session_id', v_session, 'new', v_inserted);
end;
$$;

/**
 * Every device signed in to this account, newest first — including sessions
 * from builds that never named themselves (their user agent stands in) — with
 * whether this device may take each one out, and from when if not yet.
 */
create or replace function public.device_list()
returns table (
  session_id uuid, platform text, name text, user_agent text, app_version text,
  signed_in_at timestamptz, last_seen_at timestamptz, confirmed boolean, is_current boolean,
  can_revoke boolean, revoke_from timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.current_session_id();
  v_mine timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select s.created_at into v_mine from auth.sessions s where s.id = v_session and s.user_id = v_user;

  return query
    select s.id, d.platform, d.name, s.user_agent, d.app_version,
           coalesce(d.signed_in_at, s.created_at), coalesce(d.last_seen_at, s.refreshed_at, s.updated_at, s.created_at),
           d.confirmed_at is not null, s.id = v_session,
           s.id <> v_session and v_mine is not null
             and (s.created_at > v_mine or now() - v_mine >= public.device_seniority()),
           case when s.id <> v_session and v_mine is not null and s.created_at <= v_mine
                 and now() - v_mine < public.device_seniority()
                then v_mine + public.device_seniority() end
      from auth.sessions s
      left join public.user_devices d on d.session_id = s.id
     where s.user_id = v_user and d.revoked_at is null
     order by s.id = v_session desc, coalesce(d.signed_in_at, s.created_at) desc;
end;
$$;

/** Takes one device out, under the two-hour rule. */
create or replace function public.device_revoke(p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.current_session_id();
  v_mine timestamptz;
  v_target timestamptz;
begin
  if v_user is null or v_session is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_session_id = v_session then
    raise exception 'Bu qurilmadan chiqish uchun “Chiqish” tugmasini bosing.' using errcode = '22023', detail = 'device_is_current';
  end if;
  select s.created_at into v_mine from auth.sessions s where s.id = v_session and s.user_id = v_user;
  select s.created_at into v_target from auth.sessions s where s.id = p_session_id and s.user_id = v_user;
  if v_mine is null or v_target is null then
    raise exception 'Qurilma topilmadi yoki allaqachon chiqarilgan.' using errcode = 'P0002', detail = 'device_missing';
  end if;
  if v_target <= v_mine and now() - v_mine < public.device_seniority() then
    raise exception 'Avval kirilgan qurilmani chiqarish uchun bu qurilmada kirganingizga 2 soat bo‘lishi kerak.'
      using errcode = '42501', detail = 'device_too_new';
  end if;

  delete from auth.sessions where id = p_session_id and user_id = v_user;
  update public.user_devices set revoked_at = now() where session_id = p_session_id;
  update public.notifications set read_at = coalesce(read_at, now())
   where user_id = v_user and kind = 'new_device'::public.notification_kind and entity_id = p_session_id;
  return jsonb_build_object('ok', true);
end;
$$;

/** Every other device this one may take out; says how many had to stay. */
create or replace function public.device_revoke_others()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session uuid := public.current_session_id();
  v_mine timestamptz;
  v_gone uuid[];
  v_kept integer;
begin
  if v_user is null or v_session is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select s.created_at into v_mine from auth.sessions s where s.id = v_session and s.user_id = v_user;
  if v_mine is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  with gone as (
    delete from auth.sessions s
     where s.user_id = v_user and s.id <> v_session
       and (s.created_at > v_mine or now() - v_mine >= public.device_seniority())
    returning s.id
  )
  select coalesce(array_agg(id), '{}') into v_gone from gone;

  update public.user_devices set revoked_at = now() where session_id = any(v_gone);
  update public.notifications set read_at = coalesce(read_at, now())
   where user_id = v_user and kind = 'new_device'::public.notification_kind and entity_id = any(v_gone);
  select count(*) into v_kept from auth.sessions where user_id = v_user and id <> v_session;

  return jsonb_build_object('revoked', coalesce(array_length(v_gone, 1), 0), 'kept', v_kept,
    'revoke_from', case when v_kept > 0 then v_mine + public.device_seniority() end);
end;
$$;

/** "Ha, bu men": the new device is known, its card goes away. */
create or replace function public.device_confirm(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  update public.user_devices set confirmed_at = coalesce(confirmed_at, now())
   where session_id = p_session_id and user_id = auth.uid();
  update public.notifications set read_at = coalesce(read_at, now())
   where user_id = auth.uid() and kind = 'new_device'::public.notification_kind and entity_id = p_session_id;
end;
$$;

/** New devices nobody has answered for yet, for the card on the home screen of every other device. */
create or replace function public.device_alerts()
returns table (session_id uuid, platform text, name text, signed_in_at timestamptz, can_revoke boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select d.session_id, d.platform, d.name, d.signed_in_at,
         d.signed_in_at > me.created_at or now() - me.created_at >= public.device_seniority()
    from public.user_devices d
    join auth.sessions s on s.id = d.session_id
    join auth.sessions me on me.id = public.current_session_id() and me.user_id = auth.uid()
   where d.user_id = auth.uid()
     and d.session_id <> public.current_session_id()
     and d.confirmed_at is null and d.revoked_at is null
     and d.signed_in_at > now() - interval '14 days'
   order by d.signed_in_at desc;
$$;

revoke all on function public.device_seniority() from public;
revoke all on function public.current_session_id() from public;
revoke all on function public.device_register(text, text, text) from public, anon;
revoke all on function public.device_list() from public, anon;
revoke all on function public.device_revoke(uuid) from public, anon;
revoke all on function public.device_revoke_others() from public, anon;
revoke all on function public.device_confirm(uuid) from public, anon;
revoke all on function public.device_alerts() from public, anon;
grant execute on function public.device_seniority() to authenticated, service_role;
grant execute on function public.current_session_id() to authenticated, service_role;
grant execute on function public.device_register(text, text, text) to authenticated;
grant execute on function public.device_list() to authenticated;
grant execute on function public.device_revoke(uuid) to authenticated;
grant execute on function public.device_revoke_others() to authenticated;
grant execute on function public.device_confirm(uuid) to authenticated;
grant execute on function public.device_alerts() to authenticated;

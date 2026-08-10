-- Pairing a screen with a phone, and driving one from the other.
--
-- The shape of the problem: a browser on a projector has nobody signed in, and
-- a phone in someone's hand does. So the browser opens an unclaimed session and
-- shows a code; the phone scans it, and claiming the code is what binds the
-- session to a person. From that moment only that person can move a slide.
--
-- What is deliberately not here:
--   * The QR carries an opaque token, never a user id, a presentation id or a
--     secret that outlives it.
--   * A token is single-use and short-lived, and the screen rotates it, so a
--     photograph of the projector stops working within seconds.
--   * The session row holds a slide index and a zoom level and nothing else —
--     no title, no owner name — because the screen reads it while signed out.

create type public.presentation_session_status as enum ('pairing', 'active', 'ended', 'expired');

/**
 * One presenting session: the shared state a screen renders and a phone drives.
 *
 * `host_user_id` is null until a phone claims it. Every command checks it, so an
 * unclaimed session cannot be driven and a claimed one cannot be driven by
 * anybody else.
 */
create table public.presentation_sessions (
  id uuid primary key default gen_random_uuid(),
  status public.presentation_session_status not null default 'pairing',
  host_user_id uuid references auth.users(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete set null,
  /** What the screen should be showing. The whole point of the row. */
  current_slide integer not null default 0,
  slide_count integer not null default 0,
  zoom numeric(4,2) not null default 1,
  paired_at timestamptz,
  ended_at timestamptz,
  last_command_at timestamptz,
  expires_at timestamptz not null default now() + interval '4 hours',
  created_at timestamptz not null default now(),
  constraint presentation_sessions_slide check (current_slide >= 0 and slide_count >= 0),
  constraint presentation_sessions_zoom check (zoom between 0.5 and 4),
  constraint presentation_sessions_paired check (
    status <> 'active'::public.presentation_session_status or host_user_id is not null
  )
);

create index presentation_sessions_live_idx on public.presentation_sessions (expires_at)
  where status in ('pairing'::public.presentation_session_status, 'active'::public.presentation_session_status);
create index presentation_sessions_host_idx on public.presentation_sessions (host_user_id, created_at desc);

/**
 * The rotating pairing code.
 *
 * A row per code rather than a column on the session, so rotation leaves an
 * audit trail and a consumed code can never be replayed — `consumed_at` is set
 * inside the same statement that claims it.
 */
create table public.presentation_pairing_tokens (
  token text primary key,
  session_id uuid not null references public.presentation_sessions(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Opaque and long enough that guessing one inside its lifetime is hopeless.
  constraint presentation_pairing_tokens_shape check (token ~ '^[A-Za-z0-9_-]{32,64}$')
);

create index presentation_pairing_tokens_session_idx on public.presentation_pairing_tokens (session_id, created_at desc);
create index presentation_pairing_tokens_live_idx on public.presentation_pairing_tokens (expires_at) where consumed_at is null;

-- ---------------------------------------------------------------------- RLS --
alter table public.presentation_sessions enable row level security;
alter table public.presentation_pairing_tokens enable row level security;

/**
 * A screen reads its own session while signed out.
 *
 * RLS cannot say "only the row whose id you were handed", so this policy is
 * necessarily reachable by any signed-out caller who asks — a listing, not just
 * a lookup. That makes the policy the wrong place to keep a secret, so it keeps
 * none: the column grant below is what holds the line, and `host_user_id` and
 * `presentation_id` are simply not selectable as `anon`. What is left is a
 * slide number and a zoom level, which say nothing about who is presenting.
 */
create policy presentation_sessions_screen_select on public.presentation_sessions for select to anon
  using (
    status in ('pairing'::public.presentation_session_status, 'active'::public.presentation_session_status)
    and expires_at > now()
  );
-- Signing in earns no blanket read: the host sees their own sessions and
-- nobody else's, finished ones included.
create policy presentation_sessions_host_select on public.presentation_sessions for select to authenticated
  using (host_user_id = (select auth.uid()));

-- Tokens are never read by a client. Claiming one is an RPC that runs as the
-- definer; there is no policy here at all, on purpose.

-- The screen renders a slide number and a zoom level. It has no use for the
-- identity columns, so it is not given the privilege to ask for them.
grant select (id, status, current_slide, slide_count, zoom, expires_at)
  on public.presentation_sessions to anon;
grant select on public.presentation_sessions to authenticated;
grant select on public.presentation_sessions, public.presentation_pairing_tokens to service_role;

-- ---------------------------------------------------------------- functions --
/** A URL-safe opaque token. 32 bytes of randomness, base64url, no padding. */
create or replace function public.presentation_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
$$;

/**
 * Opens a session for a screen that has nobody signed in.
 *
 * Callable by `anon` on purpose: the browser on the projector is the one that
 * needs it, and what it gets back is a session that can do nothing until a
 * signed-in phone claims it.
 */
create or replace function public.presentation_session_open()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.presentation_sessions%rowtype;
  v_token text;
begin
  insert into public.presentation_sessions default values returning * into v_session;

  v_token := public.presentation_new_token();
  insert into public.presentation_pairing_tokens (token, session_id, expires_at)
  values (v_token, v_session.id, now() + interval '45 seconds');

  return jsonb_build_object(
    'session_id', v_session.id,
    'token', v_token,
    'token_expires_at', now() + interval '45 seconds',
    'expires_at', v_session.expires_at
  );
end;
$$;

/**
 * Replaces the pairing code with a fresh one.
 *
 * The screen calls this on a timer. Rotating invalidates the previous code, so
 * a photograph of the projector is useless within a rotation — which is the
 * only reason a static QR would have been unsafe.
 *
 * The caller has to hand back the code currently on screen. Rotation is
 * destructive and `anon` can reach it, so without that proof a stranger who
 * learned a session id could rotate its code in a loop and leave the projector
 * showing something no phone can ever finish scanning. Holding the live token
 * is the one thing that tells the screen apart from everyone else.
 */
create or replace function public.presentation_pairing_rotate(
  p_session_id uuid,
  p_current_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.presentation_sessions%rowtype;
  v_token text;
begin
  select * into v_session from public.presentation_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.status <> 'pairing'::public.presentation_session_status then
    raise exception 'session is no longer pairing' using errcode = '22023';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'session has expired' using errcode = '22023';
  end if;

  perform 1 from public.presentation_pairing_tokens
    where token = p_current_token and session_id = p_session_id
      and consumed_at is null and expires_at > now();
  if not found then
    raise exception 'the code being replaced is not the live one' using errcode = '42501';
  end if;

  -- The old code dies with the new one, not when it happens to expire.
  update public.presentation_pairing_tokens
    set expires_at = now()
    where session_id = p_session_id and consumed_at is null and expires_at > now();

  v_token := public.presentation_new_token();
  insert into public.presentation_pairing_tokens (token, session_id, expires_at)
  values (v_token, p_session_id, now() + interval '45 seconds');

  return jsonb_build_object('token', v_token, 'token_expires_at', now() + interval '45 seconds');
end;
$$;

/**
 * Claims a scanned code and takes the session over.
 *
 * The single-statement update is the replay guard: two phones scanning the same
 * projector at the same instant cannot both come back with a row, because only
 * one of them finds `consumed_at is null`.
 */
create or replace function public.presentation_pairing_claim(
  p_token text,
  p_presentation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_token public.presentation_pairing_tokens%rowtype;
  v_session public.presentation_sessions%rowtype;
  v_slides integer := 0;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;

  update public.presentation_pairing_tokens
    set consumed_at = now(), consumed_by = v_user
    where token = p_token and consumed_at is null and expires_at > now()
    returning * into v_token;
  if not found then
    raise exception 'QR kod eskirgan. Ekrandagi yangi kodni skaner qiling.' using errcode = '22023';
  end if;

  select * into v_session from public.presentation_sessions where id = v_token.session_id for update;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;

  -- A presentation may be chosen now or later, but only one the caller owns.
  if p_presentation_id is not null then
    select count(*) into v_slides from public.slides s
      join public.presentations p on p.id = s.presentation_id
      where s.presentation_id = p_presentation_id and p.owner_id = v_user;
    if v_slides = 0 then
      raise exception 'Taqdimot topilmadi yoki sizga tegishli emas.' using errcode = '42501';
    end if;
  end if;

  update public.presentation_sessions set
    status = 'active'::public.presentation_session_status,
    host_user_id = v_user,
    presentation_id = coalesce(p_presentation_id, presentation_id),
    slide_count = greatest(v_slides, slide_count),
    paired_at = now()
    where id = v_session.id
    returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'presentation_id', v_session.presentation_id,
    'slide_count', v_session.slide_count,
    'current_slide', v_session.current_slide
  );
end;
$$;

/**
 * Moves the presentation. The only way the shared state ever changes.
 *
 * Every call re-checks that the caller is the phone that claimed this session,
 * so knowing a session id is not enough to drive somebody else's screen.
 */
create or replace function public.presentation_command(
  p_session_id uuid,
  p_command text,
  p_value numeric default null
)
returns public.presentation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.presentation_sessions%rowtype;
  v_slide integer;
  v_zoom numeric;
begin
  select * into v_session from public.presentation_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.host_user_id is null or v_session.host_user_id <> v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;

  v_slide := v_session.current_slide;
  v_zoom := v_session.zoom;

  case p_command
    when 'next' then v_slide := least(v_slide + 1, greatest(v_session.slide_count - 1, 0));
    when 'previous' then v_slide := greatest(v_slide - 1, 0);
    when 'goto' then v_slide := greatest(least(coalesce(p_value, 0)::integer, greatest(v_session.slide_count - 1, 0)), 0);
    when 'zoom' then v_zoom := greatest(least(coalesce(p_value, 1), 4), 0.5);
    when 'zoom_in' then v_zoom := least(v_zoom + 0.25, 4);
    when 'zoom_out' then v_zoom := greatest(v_zoom - 0.25, 0.5);
    when 'reset_zoom' then v_zoom := 1;
    when 'start' then v_slide := 0;
    when 'end' then
      update public.presentation_sessions
        set status = 'ended'::public.presentation_session_status, ended_at = now(), last_command_at = now()
        where id = p_session_id returning * into v_session;
      return v_session;
    else
      raise exception 'unknown command %', p_command using errcode = '22023';
  end case;

  update public.presentation_sessions
    set current_slide = v_slide, zoom = v_zoom, last_command_at = now()
    where id = p_session_id
    returning * into v_session;

  return v_session;
end;
$$;

/** Chooses or changes the deck being shown. Host only. */
create or replace function public.presentation_session_set_deck(
  p_session_id uuid,
  p_presentation_id uuid
)
returns public.presentation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.presentation_sessions%rowtype;
  v_slides integer;
begin
  select * into v_session from public.presentation_sessions where id = p_session_id for update;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  if v_session.host_user_id is distinct from v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;

  select count(*) into v_slides from public.slides s
    join public.presentations p on p.id = s.presentation_id
    where s.presentation_id = p_presentation_id and p.owner_id = v_user;
  if v_slides = 0 then
    raise exception 'Taqdimot topilmadi yoki sizga tegishli emas.' using errcode = '42501';
  end if;

  update public.presentation_sessions
    set presentation_id = p_presentation_id, slide_count = v_slides, current_slide = 0, zoom = 1, last_command_at = now()
    where id = p_session_id
    returning * into v_session;

  return v_session;
end;
$$;

/** Sweeps sessions and codes past their window. Service role only. */
create or replace function public.purge_expired_presentation_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.presentation_pairing_tokens where expires_at < now() - interval '1 hour';
  update public.presentation_sessions
    set status = 'expired'::public.presentation_session_status
    where expires_at <= now()
      and status in ('pairing'::public.presentation_session_status, 'active'::public.presentation_session_status);
  get diagnostics v_count = row_count;
  delete from public.presentation_sessions where expires_at < now() - interval '24 hours';
  return v_count;
end;
$$;

-- --------------------------------------------------------------- realtime --
-- The screen follows its own row: one filtered subscription, no polling.
alter publication supabase_realtime add table public.presentation_sessions;

-- ----------------------------------------------------------------- grants --
do $$
declare v_signature text;
begin
  -- The screen is signed out, so these two are reachable by `anon`. Neither can
  -- do anything but create and refresh a code that is worthless until claimed.
  foreach v_signature in array array[
    'public.presentation_session_open()',
    'public.presentation_pairing_rotate(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('grant execute on function %s to anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  foreach v_signature in array array[
    'public.presentation_pairing_claim(text, uuid)',
    'public.presentation_command(uuid, text, numeric)',
    'public.presentation_session_set_deck(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public', v_signature);
    execute format('revoke all on function %s from anon', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;

  execute 'revoke all on function public.presentation_new_token() from public, anon, authenticated';
  execute 'revoke all on function public.purge_expired_presentation_sessions() from public, anon, authenticated';
  execute 'grant execute on function public.purge_expired_presentation_sessions() to service_role';
end
$$;

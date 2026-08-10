-- A projector is deliberately not signed in, but it still needs two powers once
-- paired: read the bound deck and move it with the keyboard. A separate bearer
-- capability grants those powers without making private presentation rows public.
--
-- The raw screen token is returned exactly once by presentation_session_open().
-- Only its SHA-256 digest is stored. The independent realtime token is a random
-- channel name shared with the paired host; it is never selectable by anon.

alter table public.presentation_sessions
  add column screen_token_hash text,
  add column realtime_token text,
  add column translate_x numeric(10,4) not null default 0,
  add column translate_y numeric(10,4) not null default 0,
  add column state_version bigint not null default 0,
  add column deck_revision bigint not null default 0;

-- Existing sessions cannot recover a raw screen capability, so give every row
-- an unknowable digest and a fresh realtime secret. Existing index/zoom clients
-- continue to work during a rolling deploy; newly opened sessions get both raw
-- values from the RPC below.
update public.presentation_sessions
set
  screen_token_hash = encode(extensions.digest(public.presentation_new_token(), 'sha256'), 'hex'),
  realtime_token = public.presentation_new_token()
where screen_token_hash is null or realtime_token is null;

alter table public.presentation_sessions
  alter column screen_token_hash set not null,
  alter column realtime_token set not null,
  add constraint presentation_sessions_screen_token_hash_shape
    check (screen_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint presentation_sessions_realtime_token_shape
    check (realtime_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  add constraint presentation_sessions_viewport_translation check (
    abs(translate_x) <= 500 * greatest(zoom - 1, 0)
    and abs(translate_y) <= 281.25 * greatest(zoom - 1, 0)
  ),
  add constraint presentation_sessions_versions check (state_version >= 0 and deck_revision >= 0);

-- Hosted projects may have inherited a table-wide anon SELECT. Withdraw it
-- before re-granting only the harmless state a projector may follow. Neither
-- capability, presentation identity nor host identity is exposed here.
revoke select on public.presentation_sessions from anon;
grant select (
  id, status, current_slide, slide_count, zoom, translate_x, translate_y,
  state_version, deck_revision, expires_at
) on public.presentation_sessions to anon;

create or replace function public.presentation_session_open()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.presentation_sessions%rowtype;
  v_token text := public.presentation_new_token();
  v_screen_token text := public.presentation_new_token();
  v_realtime_token text := public.presentation_new_token();
  v_token_expires_at timestamptz := now() + interval '45 seconds';
begin
  insert into public.presentation_sessions (screen_token_hash, realtime_token)
  values (
    encode(extensions.digest(v_screen_token, 'sha256'), 'hex'),
    v_realtime_token
  )
  returning * into v_session;

  insert into public.presentation_pairing_tokens (token, session_id, expires_at)
  values (v_token, v_session.id, v_token_expires_at);

  return jsonb_build_object(
    'session_id', v_session.id,
    'token', v_token,
    'screen_token', v_screen_token,
    'realtime_token', v_realtime_token,
    'token_expires_at', v_token_expires_at,
    'expires_at', v_session.expires_at
  );
end;
$$;

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
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  update public.presentation_pairing_tokens
  set consumed_at = now(), consumed_by = v_user
  where token = p_token and consumed_at is null and expires_at > now()
  returning * into v_token;
  if not found then
    raise exception 'QR kod eskirgan. Ekrandagi yangi kodni skaner qiling.' using errcode = '22023';
  end if;

  select * into v_session
  from public.presentation_sessions
  where id = v_token.session_id
  for update;
  if not found or v_session.status <> 'pairing'::public.presentation_session_status then
    raise exception 'Sessiya allaqachon ulangan yoki mavjud emas.' using errcode = '22023';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;

  if p_presentation_id is not null then
    select count(*) into v_slides
    from public.slides s
    join public.presentations p on p.id = s.presentation_id
    where s.presentation_id = p_presentation_id
      and p.owner_id = v_user
      and p.status = 'ready'::public.presentation_status;
    if v_slides = 0 then
      raise exception 'Taqdimot topilmadi yoki sizga tegishli emas.' using errcode = '42501';
    end if;
  end if;

  update public.presentation_sessions
  set
    status = 'active'::public.presentation_session_status,
    host_user_id = v_user,
    presentation_id = coalesce(p_presentation_id, presentation_id),
    slide_count = case when p_presentation_id is null then slide_count else v_slides end,
    current_slide = case when p_presentation_id is null then current_slide else 0 end,
    zoom = 1,
    translate_x = 0,
    translate_y = 0,
    deck_revision = deck_revision + case when p_presentation_id is null then 0 else 1 end,
    state_version = state_version + 1,
    paired_at = now()
  where id = v_session.id
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'presentation_id', v_session.presentation_id,
    'slide_count', v_session.slide_count,
    'current_slide', v_session.current_slide,
    'zoom', v_session.zoom,
    'translate_x', v_session.translate_x,
    'translate_y', v_session.translate_y,
    'state_version', v_session.state_version,
    'deck_revision', v_session.deck_revision,
    'realtime_token', v_session.realtime_token
  );
end;
$$;

-- The one state transition implementation used by both the authenticated phone
-- and the capability-authorized projector. Callers perform their own authority
-- check before reaching it; it is never executable directly by a client.
create or replace function public.presentation_apply_command(
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
  v_session public.presentation_sessions%rowtype;
  v_slide integer;
  v_zoom numeric;
  v_translate_x numeric;
  v_translate_y numeric;
  v_slide_changed boolean := false;
  v_max_x numeric;
  v_max_y numeric;
begin
  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;
  if p_value is not null and p_value::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'command value must be finite' using errcode = '22023';
  end if;

  v_slide := v_session.current_slide;
  v_zoom := v_session.zoom;
  v_translate_x := v_session.translate_x;
  v_translate_y := v_session.translate_y;

  case p_command
    when 'next' then
      v_slide := least(v_slide + 1, greatest(v_session.slide_count - 1, 0));
    when 'previous' then
      v_slide := greatest(v_slide - 1, 0);
    when 'goto' then
      v_slide := greatest(least(coalesce(p_value, 0), greatest(v_session.slide_count - 1, 0)), 0)::integer;
    when 'zoom' then
      v_zoom := greatest(least(coalesce(p_value, 1), 4), 0.5);
    when 'zoom_in' then
      v_zoom := least(v_zoom + 0.25, 4);
    when 'zoom_out' then
      v_zoom := greatest(v_zoom - 0.25, 0.5);
    when 'reset_zoom', 'reset_viewport' then
      v_zoom := 1;
      v_translate_x := 0;
      v_translate_y := 0;
    when 'start' then
      v_slide := 0;
      v_zoom := 1;
      v_translate_x := 0;
      v_translate_y := 0;
    when 'end' then
      update public.presentation_sessions
      set
        status = 'ended'::public.presentation_session_status,
        ended_at = now(),
        last_command_at = now(),
        state_version = state_version + 1
      where id = p_session_id
      returning * into v_session;
      return v_session;
    else
      raise exception 'unknown command %', p_command using errcode = '22023';
  end case;

  v_slide_changed := v_slide <> v_session.current_slide;
  if v_slide_changed then
    v_zoom := 1;
    v_translate_x := 0;
    v_translate_y := 0;
  elsif p_command in ('zoom', 'zoom_in', 'zoom_out') then
    v_max_x := 500 * greatest(v_zoom - 1, 0);
    v_max_y := 281.25 * greatest(v_zoom - 1, 0);
    v_translate_x := greatest(least(v_translate_x, v_max_x), -v_max_x);
    v_translate_y := greatest(least(v_translate_y, v_max_y), -v_max_y);
  end if;

  update public.presentation_sessions
  set
    current_slide = v_slide,
    zoom = v_zoom,
    translate_x = v_translate_x,
    translate_y = v_translate_y,
    last_command_at = now(),
    state_version = state_version + 1
  where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

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
begin
  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_user is null or v_session.host_user_id is distinct from v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;
  return public.presentation_apply_command(p_session_id, p_command, p_value);
end;
$$;

create or replace function public.presentation_screen_snapshot(
  p_session_id uuid,
  p_screen_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.presentation_sessions%rowtype;
begin
  if p_screen_token is null or p_screen_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'screen capability is invalid' using errcode = '42501';
  end if;

  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
    and screen_token_hash = encode(extensions.digest(p_screen_token, 'sha256'), 'hex');
  if not found then
    raise exception 'screen capability is invalid' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'presentation_id', v_session.presentation_id,
    'current_slide', v_session.current_slide,
    'slide_count', v_session.slide_count,
    'zoom', v_session.zoom,
    'translate_x', v_session.translate_x,
    'translate_y', v_session.translate_y,
    'state_version', v_session.state_version,
    'deck_revision', v_session.deck_revision,
    'realtime_token', v_session.realtime_token,
    'expires_at', v_session.expires_at
  );
end;
$$;

create or replace function public.presentation_screen_command(
  p_session_id uuid,
  p_screen_token text,
  p_command text,
  p_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.presentation_sessions%rowtype;
begin
  if p_screen_token is null or p_screen_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'screen capability is invalid' using errcode = '42501';
  end if;
  if p_command not in ('next', 'previous', 'goto', 'start', 'reset_viewport', 'reset_zoom') then
    raise exception 'screen command is not allowed' using errcode = '42501';
  end if;

  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
    and screen_token_hash = encode(extensions.digest(p_screen_token, 'sha256'), 'hex');
  if not found then
    raise exception 'screen capability is invalid' using errcode = '42501';
  end if;

  v_session := public.presentation_apply_command(p_session_id, p_command, p_value);
  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'presentation_id', v_session.presentation_id,
    'current_slide', v_session.current_slide,
    'slide_count', v_session.slide_count,
    'zoom', v_session.zoom,
    'translate_x', v_session.translate_x,
    'translate_y', v_session.translate_y,
    'state_version', v_session.state_version,
    'deck_revision', v_session.deck_revision,
    'realtime_token', v_session.realtime_token,
    'expires_at', v_session.expires_at
  );
end;
$$;

create or replace function public.presentation_viewport_commit(
  p_session_id uuid,
  p_scale numeric,
  p_translate_x numeric,
  p_translate_y numeric,
  p_slide integer default null
)
returns public.presentation_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_session public.presentation_sessions%rowtype;
  v_scale numeric;
  v_x numeric;
  v_y numeric;
  v_max_x numeric;
  v_max_y numeric;
begin
  if p_scale is null or p_translate_x is null or p_translate_y is null
    or p_scale::text in ('NaN', 'Infinity', '-Infinity')
    or p_translate_x::text in ('NaN', 'Infinity', '-Infinity')
    or p_translate_y::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'viewport values must be finite' using errcode = '22023';
  end if;

  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_user is null or v_session.host_user_id is distinct from v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;
  if p_slide is not null and p_slide <> v_session.current_slide then
    raise exception 'slide changed while viewport was moving' using errcode = '40001';
  end if;

  v_scale := greatest(least(p_scale, 4), 1);
  v_max_x := 500 * (v_scale - 1);
  v_max_y := 281.25 * (v_scale - 1);
  v_x := greatest(least(p_translate_x, v_max_x), -v_max_x);
  v_y := greatest(least(p_translate_y, v_max_y), -v_max_y);

  update public.presentation_sessions
  set
    zoom = v_scale,
    translate_x = v_x,
    translate_y = v_y,
    last_command_at = now(),
    state_version = state_version + 1
  where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

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
  select * into v_session
  from public.presentation_sessions
  where id = p_session_id
  for update;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_user is null or v_session.host_user_id is distinct from v_user then
    raise exception 'only the paired device may control this session' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.presentation_session_status or v_session.expires_at <= now() then
    raise exception 'session is not active' using errcode = '22023';
  end if;

  select count(*) into v_slides
  from public.slides s
  join public.presentations p on p.id = s.presentation_id
  where s.presentation_id = p_presentation_id
    and p.owner_id = v_user
    and p.status = 'ready'::public.presentation_status;
  if v_slides = 0 then
    raise exception 'Taqdimot topilmadi yoki sizga tegishli emas.' using errcode = '42501';
  end if;

  update public.presentation_sessions
  set
    presentation_id = p_presentation_id,
    slide_count = v_slides,
    current_slide = 0,
    zoom = 1,
    translate_x = 0,
    translate_y = 0,
    deck_revision = deck_revision + 1,
    state_version = state_version + 1,
    last_command_at = now()
  where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

-- New functions start life executable by PUBLIC in PostgreSQL. Pin every entry
-- point explicitly; the helper is never callable outside another definer RPC.
revoke all on function public.presentation_apply_command(uuid, text, numeric) from public, anon, authenticated, service_role;

revoke all on function public.presentation_screen_snapshot(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.presentation_screen_snapshot(uuid, text) to anon, authenticated, service_role;

revoke all on function public.presentation_screen_command(uuid, text, text, numeric) from public, anon, authenticated, service_role;
grant execute on function public.presentation_screen_command(uuid, text, text, numeric) to anon, authenticated, service_role;

revoke all on function public.presentation_viewport_commit(uuid, numeric, numeric, numeric, integer) from public, anon, authenticated, service_role;
grant execute on function public.presentation_viewport_commit(uuid, numeric, numeric, numeric, integer) to authenticated, service_role;

-- QR Video Experience: a cinematic pairing screen the admin owns.
--
-- Two videos play on the projector — an intro once, then a loop forever — and
-- the site paints a live QR over them at the spot the video was designed
-- around. The QR is not in the footage: it is generated per session, so every
-- screen shows a code that belongs to that screen and to nobody else.
--
-- One row per surface. "Taqdimot qilish" and "O'yingohni ochish" are separate
-- experiences with separate footage and separate live sessions, which is why
-- the surface is the key rather than a single settings row.
--
-- Nothing here replaces the pairing that already works. When a surface is
-- disabled — the state everything starts in — the existing screens render
-- exactly as they do today.

create type public.qr_video_surface as enum ('taqdimot', 'oyingoh');

create table public.qr_video_experiences (
  surface public.qr_video_surface primary key,
  is_enabled boolean not null default false,

  -- Object keys inside the `qr-video` bucket. Never URLs: the bucket may be
  -- renamed or fronted by a CDN without touching a row.
  intro_path text,
  loop_path text,

  -- Where the QR belongs, in the *video's* own frame — not the browser
  -- window's. The player works out what part of the footage is on screen after
  -- `object-fit: cover` and places the code inside that, so the code lands on
  -- the designed spot whatever shape the window is.
  qr_appear_ms integer not null default 5060,
  qr_x numeric(6,3) not null default 46.8,
  qr_y numeric(6,3) not null default 66,
  qr_size numeric(6,3) not null default 18.3,

  gradient_from text not null default '#A855F7',
  gradient_via text not null default '#7C3AED',
  gradient_to text not null default '#4F46E5',
  qr_background text not null default '#FFFFFF',
  /** 0 is no glow at all; the default is the "minimal" the design asks for. */
  glow numeric(4,3) not null default 0.35,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  constraint qr_video_appear_sane check (qr_appear_ms between 0 and 600000),
  -- A code may sit partly off the frame while an admin is nudging it, but it
  -- may not be placed somewhere it could never be scanned.
  constraint qr_video_position check (qr_x between -50 and 150 and qr_y between -50 and 150),
  constraint qr_video_size check (qr_size between 2 and 100),
  constraint qr_video_glow check (glow between 0 and 3),
  constraint qr_video_colors check (
    gradient_from ~ '^#[0-9A-Fa-f]{6}$'
    and gradient_via ~ '^#[0-9A-Fa-f]{6}$'
    and gradient_to ~ '^#[0-9A-Fa-f]{6}$'
    and qr_background ~ '^#[0-9A-Fa-f]{6}$'
  ),
  -- Enabling a surface with nothing to play would black out the projector.
  constraint qr_video_enabled_has_footage check (
    not is_enabled or (intro_path is not null and loop_path is not null)
  )
);

insert into public.qr_video_experiences (surface) values ('taqdimot'), ('oyingoh');

/* --------------------------------------------------------------------- RLS */

alter table public.qr_video_experiences enable row level security;

-- The projector is signed out, so `anon` has to be able to read this or the
-- feature cannot exist. Only the enabled surfaces are visible: work in progress
-- stays in the console until an admin turns it on.
--
-- The two roles get separate policies on purpose. `anon` holds no EXECUTE on
-- `public.is_admin`, and a policy that calls it is evaluated eagerly for every
-- role it names — which is how a "harmless" `or is_admin()` once turned every
-- signed-out read into `permission denied for function is_admin`.
create policy qr_video_public_read on public.qr_video_experiences
  for select to anon
  using (is_enabled);

create policy qr_video_read on public.qr_video_experiences
  for select to authenticated
  using (is_enabled or (select public.is_admin()));

-- No write policy: every change goes through the definer RPC below, so the
-- validation and the audit entry cannot be walked around.
grant select on public.qr_video_experiences to anon, authenticated;

-- An admin flipping a surface on should reach the projector already running in
-- the hall, without anybody refreshing it.
alter publication supabase_realtime add table public.qr_video_experiences;

/* ----------------------------------------------------------------- storage */

-- Public read, because the projector is signed out and a `<video>` element
-- cannot follow an expiring signed URL mid-playback. Write is what needs
-- protecting, and it is.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'qr-video', 'qr-video', true, 314572800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy qr_video_assets_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'qr-video');

create policy qr_video_assets_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'qr-video' and (select public.is_admin()));

create policy qr_video_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'qr-video' and (select public.is_admin()))
  with check (bucket_id = 'qr-video' and (select public.is_admin()));

create policy qr_video_assets_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'qr-video' and (select public.is_admin()));

/* -------------------------------------------------------------------- RPCs */

create or replace function public.admin_save_qr_video_experience(
  p_surface public.qr_video_surface,
  p_is_enabled boolean,
  p_intro_path text default null,
  p_loop_path text default null,
  p_qr_appear_ms integer default 5060,
  p_qr_x numeric default 46.8,
  p_qr_y numeric default 66,
  p_qr_size numeric default 18.3,
  p_gradient_from text default '#A855F7',
  p_gradient_via text default '#7C3AED',
  p_gradient_to text default '#4F46E5',
  p_qr_background text default '#FFFFFF',
  p_glow numeric default 0.35
)
returns public.qr_video_experiences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_row public.qr_video_experiences;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- An object key, never a path that climbs out of the bucket or a URL that
  -- points somewhere else entirely (§82).
  if p_intro_path is not null and (p_intro_path ~ '\.\.' or p_intro_path ~ '^/' or p_intro_path ~ '://') then
    raise exception 'unsafe_asset' using errcode = '22023';
  end if;
  if p_loop_path is not null and (p_loop_path ~ '\.\.' or p_loop_path ~ '^/' or p_loop_path ~ '://') then
    raise exception 'unsafe_asset' using errcode = '22023';
  end if;

  select to_jsonb(row) into v_before
    from public.qr_video_experiences row where row.surface = p_surface;

  update public.qr_video_experiences set
    is_enabled = coalesce(p_is_enabled, false),
    intro_path = p_intro_path,
    loop_path = p_loop_path,
    qr_appear_ms = p_qr_appear_ms,
    qr_x = p_qr_x,
    qr_y = p_qr_y,
    qr_size = p_qr_size,
    gradient_from = upper(p_gradient_from),
    gradient_via = upper(p_gradient_via),
    gradient_to = upper(p_gradient_to),
    qr_background = upper(p_qr_background),
    glow = p_glow,
    updated_at = now(),
    updated_by = v_admin
  where surface = p_surface
  returning * into v_row;

  if not found then
    raise exception 'unknown_surface' using errcode = '02000';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, 'qr_video.saved', 'qr_video_experience', p_surface::text, v_before, to_jsonb(v_row));

  return v_row;
end;
$$;

-- What the landing page behind a scanned presentation QR may say.
--
-- A phone camera reads a string and opens a browser; the custom scheme the
-- in-app scanner uses means nothing to it. So the code carries an https link,
-- and this is all that link is allowed to learn: whether the code is still
-- good. Not who opened the session, not what is being presented, not the
-- screen or realtime capability — those stay with the screen that opened it.
create or replace function public.presentation_pair_info(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live boolean;
begin
  select exists (
    select 1
    from public.presentation_pairing_tokens token
    join public.presentation_sessions session on session.id = token.session_id
    where token.token = p_token
      and token.consumed_at is null
      and token.expires_at > now()
      and session.expires_at > now()
      and session.status = 'pairing'::public.presentation_session_status
  ) into v_live;

  return jsonb_build_object('live', v_live);
end;
$$;

revoke all on function public.admin_save_qr_video_experience(
  public.qr_video_surface, boolean, text, text, integer, numeric, numeric, numeric,
  text, text, text, text, numeric) from public, anon;
grant execute on function public.admin_save_qr_video_experience(
  public.qr_video_surface, boolean, text, text, integer, numeric, numeric, numeric,
  text, text, text, text, numeric) to authenticated;

revoke all on function public.presentation_pair_info(text) from public;
grant execute on function public.presentation_pair_info(text) to anon, authenticated;

-- The same, for a match. O'yingoh's projector carries its own code and its own
-- landing page, because a phone camera cannot open the app's private scheme any
-- more for a game than it can for a talk.
create or replace function public.game_pair_info(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live boolean;
begin
  select exists (
    select 1
    from public.game_pairing_tokens token
    join public.game_sessions session on session.id = token.session_id
    where token.token = p_token
      and token.consumed_at is null
      and token.expires_at > now()
      and session.expires_at > now()
      and session.status not in (
        'finished'::public.game_session_status,
        'cancelled'::public.game_session_status,
        'expired'::public.game_session_status
      )
  ) into v_live;

  return jsonb_build_object('live', v_live);
end;
$$;

revoke all on function public.game_pair_info(text) from public;
grant execute on function public.game_pair_info(text) to anon, authenticated;

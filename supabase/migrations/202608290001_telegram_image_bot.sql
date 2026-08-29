-- Telegram chooses a picture for one already-existing JSLAYD image slot.
--
-- The raw deep-link token never reaches this schema. The Edge Function hashes
-- it before insert/lookup, and the digest is the only durable capability.

create table public.telegram_image_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  presentation_id uuid not null,
  slide_id uuid not null,
  slide_index integer not null,
  image_element_id uuid not null references public.slide_elements(id) on delete cascade,
  image_slot text not null,
  initial_query text,
  latest_query text,
  intent text,
  telegram_user_id bigint,
  telegram_chat_id bigint,
  status text not null default 'active',
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, user_id)
    references public.presentations(id, owner_id) on delete cascade,
  foreign key (slide_id, presentation_id, user_id)
    references public.slides(id, presentation_id, owner_id) on delete cascade,
  constraint telegram_image_sessions_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint telegram_image_sessions_slot_length
    check (char_length(image_slot) between 1 and 160),
  constraint telegram_image_sessions_query_length
    check (initial_query is null or char_length(initial_query) between 1 and 200),
  constraint telegram_image_sessions_latest_query_length
    check (latest_query is null or char_length(latest_query) between 1 and 200),
  constraint telegram_image_sessions_status
    check (status in ('active', 'consumed', 'expired', 'cancelled')),
  constraint telegram_image_sessions_expiration
    check (expires_at <= created_at + interval '15 minutes 5 seconds'),
  constraint telegram_image_sessions_terminal_time check (
    (status = 'consumed' and consumed_at is not null)
    or (status = 'cancelled' and cancelled_at is not null)
    or status in ('active', 'expired')
  )
);

create index telegram_image_sessions_active_expiry_idx
  on public.telegram_image_sessions (expires_at)
  where status = 'active';
create index telegram_image_sessions_telegram_user_idx
  on public.telegram_image_sessions (telegram_user_id, created_at desc)
  where status = 'active';
create index telegram_image_sessions_owner_presentation_idx
  on public.telegram_image_sessions (user_id, presentation_id, created_at desc);

create table public.telegram_image_candidates (
  opaque_id text primary key,
  session_id uuid not null references public.telegram_image_sessions(id) on delete cascade,
  provider text not null,
  download_url text,
  original_url text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  width integer not null default 0,
  height integer not null default 0,
  confidence numeric(5,4) not null default 0,
  attribution jsonb not null default '{}'::jsonb,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint telegram_image_candidates_opaque_shape
    check (opaque_id ~ '^[A-Za-z0-9_-]{16,32}$'),
  constraint telegram_image_candidates_location
    check (
      (download_url is not null and storage_path is null and storage_bucket is null)
      or (download_url is null and storage_path is not null and storage_bucket is not null)
    ),
  constraint telegram_image_candidates_dimensions
    check (width >= 0 and height >= 0),
  constraint telegram_image_candidates_confidence
    check (confidence between 0 and 1)
);

create index telegram_image_candidates_session_idx
  on public.telegram_image_candidates (session_id, created_at);

create table public.telegram_image_updates (
  update_id bigint primary key,
  status text not null default 'processing',
  error_code text,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint telegram_image_updates_status
    check (status in ('processing', 'completed', 'failed'))
);

alter table public.telegram_image_sessions enable row level security;
alter table public.telegram_image_candidates enable row level security;
alter table public.telegram_image_updates enable row level security;

revoke all on public.telegram_image_sessions from public, anon, authenticated;
revoke all on public.telegram_image_candidates from public, anon, authenticated;
revoke all on public.telegram_image_updates from public, anon, authenticated;

-- One Telegram update is claimed once before work is scheduled. A retry gets
-- false and returns 200 without repeating a message or mutation.
create or replace function public.claim_telegram_image_update(p_update_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer := 0;
begin
  insert into public.telegram_image_updates (update_id)
  values (p_update_id)
  on conflict (update_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- Bind a one-time app capability to the Telegram account that presented it.
-- A second account never gets the row back, even while the token is active.
create or replace function public.bind_telegram_image_session(
  p_token_hash text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
)
returns public.telegram_image_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.telegram_image_sessions%rowtype;
begin
  update public.telegram_image_sessions
  set status = 'expired', updated_at = now()
  where token_hash = p_token_hash and status = 'active' and expires_at <= now();

  select * into v_session
  from public.telegram_image_sessions
  where token_hash = p_token_hash
  for update;

  if not found or v_session.status <> 'active' or v_session.expires_at <= now() then
    raise exception 'image session is invalid or expired' using errcode = '22023';
  end if;
  if v_session.telegram_user_id is not null
    and v_session.telegram_user_id <> p_telegram_user_id then
    raise exception 'image session belongs to another Telegram account' using errcode = '42501';
  end if;

  update public.telegram_image_sessions
  set telegram_user_id = p_telegram_user_id,
      telegram_chat_id = p_telegram_chat_id,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$$;

-- Asset metadata, session consumption, exact element replacement, editor
-- history and live-projector invalidation commit together. Storage is uploaded
-- first by the function and is compensatingly deleted if this transaction
-- refuses anything.
create or replace function public.commit_telegram_image_selection(
  p_session_id uuid,
  p_candidate_id text,
  p_telegram_user_id bigint,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_byte_size bigint,
  p_width integer,
  p_height integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.telegram_image_sessions%rowtype;
  v_candidate public.telegram_image_candidates%rowtype;
  v_element public.slide_elements%rowtype;
  v_asset_id uuid := gen_random_uuid();
  v_version integer;
  v_old_content jsonb;
  v_new_content jsonb;
  v_source_url text;
  v_creator text;
  v_creator_url text;
  v_license text;
  v_license_url text;
  v_duplicate boolean;
begin
  if p_storage_bucket <> 'presentation-assets' then
    raise exception 'invalid presentation asset bucket' using errcode = '22023';
  end if;

  select * into v_session
  from public.telegram_image_sessions
  where id = p_session_id
  for update;
  if not found then raise exception 'image session not found' using errcode = 'P0002'; end if;
  if v_session.status <> 'active' then raise exception 'image session is already used' using errcode = '22023'; end if;
  if v_session.expires_at <= now() then
    update public.telegram_image_sessions set status = 'expired', updated_at = now() where id = v_session.id;
    raise exception 'image session expired' using errcode = '22023';
  end if;
  if v_session.telegram_user_id is null or v_session.telegram_user_id <> p_telegram_user_id then
    raise exception 'Telegram account does not own this image session' using errcode = '42501';
  end if;

  select * into v_candidate
  from public.telegram_image_candidates
  where opaque_id = p_candidate_id and session_id = v_session.id
  for update;
  if not found or v_candidate.selected_at is not null then
    raise exception 'image candidate is invalid or already selected' using errcode = '22023';
  end if;

  select * into v_element
  from public.slide_elements
  where id = v_session.image_element_id
    and slide_id = v_session.slide_id
    and presentation_id = v_session.presentation_id
    and owner_id = v_session.user_id
  for update;
  if not found or v_element.type <> 'image'::public.element_type then
    raise exception 'image slot no longer exists' using errcode = 'P0002';
  end if;
  if coalesce(nullif(v_element.content ->> 'slot', ''), v_element.id::text) <> v_session.image_slot then
    raise exception 'image slot changed' using errcode = '22023';
  end if;
  if coalesce(v_element.content ->> 'kind', 'image') = 'video' then
    raise exception 'video slots do not accept Telegram images' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.presentations
    where id = v_session.presentation_id and owner_id = v_session.user_id
  ) then
    raise exception 'presentation ownership changed' using errcode = '42501';
  end if;

  v_source_url := nullif(v_candidate.attribution ->> 'sourceUrl', '');
  v_creator := nullif(v_candidate.attribution ->> 'creator', '');
  v_creator_url := nullif(v_candidate.attribution ->> 'creatorUrl', '');
  v_license := nullif(v_candidate.attribution ->> 'license', '');
  v_license_url := nullif(v_candidate.attribution ->> 'licenseUrl', '');
  select exists (
    select 1 from public.presentation_assets
    where presentation_id = v_session.presentation_id
      and source_url is not distinct from v_source_url
      and v_source_url is not null
  ) into v_duplicate;

  insert into public.presentation_assets (
    id, presentation_id, owner_id, kind, storage_bucket, storage_path,
    source_url, mime_type, byte_size, width, height, alt_text, provider,
    provider_asset_id, license_name, license_url, attribution, metadata
  ) values (
    v_asset_id, v_session.presentation_id, v_session.user_id, 'stock'::public.asset_kind,
    p_storage_bucket, p_storage_path, v_source_url, p_mime_type, p_byte_size,
    p_width, p_height, nullif(v_candidate.attribution ->> 'title', ''),
    v_candidate.provider, p_candidate_id, v_license, v_license_url, v_creator,
    jsonb_build_object(
      'source', 'telegram',
      'telegram_session_id', v_session.id,
      'candidate_id', p_candidate_id,
      'slide_id', v_session.slide_id,
      'slide_index', v_session.slide_index,
      'image_slot', v_session.image_slot,
      'query', coalesce(v_session.latest_query, v_session.initial_query),
      'intent', v_session.intent,
      'confidence', v_candidate.confidence,
      'creator_url', v_creator_url,
      'original_url', v_candidate.original_url,
      'duplicate_explicit_selection', v_duplicate,
      'attribution', v_candidate.attribution
    )
  );

  v_old_content := v_element.content;
  v_new_content := (v_element.content - 'signedUrl' - 'url' - 'uri' - 'empty') || jsonb_build_object(
    'kind', 'image',
    'storageBucket', p_storage_bucket,
    'storagePath', p_storage_path,
    'assetId', v_asset_id,
    'telegramSessionId', v_session.id
  );

  update public.slide_elements
  set content = v_new_content, updated_at = now()
  where id = v_element.id;
  if not found then raise exception 'image slot update failed' using errcode = 'P0002'; end if;

  update public.presentations
  set current_version = current_version + 1, updated_at = now()
  where id = v_session.presentation_id and owner_id = v_session.user_id
  returning current_version into v_version;
  if not found then raise exception 'presentation update failed' using errcode = 'P0002'; end if;

  insert into public.presentation_edit_history (
    presentation_id, owner_id, slide_id, actor_id,
    operation, inverse_operation, version
  ) values (
    v_session.presentation_id, v_session.user_id, v_session.slide_id, v_session.user_id,
    jsonb_build_object(
      'action', 'telegram_image', 'elementId', v_element.id,
      'imageSlot', v_session.image_slot, 'assetId', v_asset_id,
      'content', v_new_content
    ),
    jsonb_build_object(
      'action', 'update', 'elementId', v_element.id,
      'patch', jsonb_build_object('content', v_old_content)
    ),
    v_version
  );

  update public.telegram_image_candidates
  set selected_at = now()
  where opaque_id = v_candidate.opaque_id;
  update public.telegram_image_sessions
  set status = 'consumed', consumed_at = now(), updated_at = now()
  where id = v_session.id;

  -- A paired projector watches this revision and refetches the signed deck.
  update public.presentation_sessions
  set deck_revision = deck_revision + 1,
      state_version = state_version + 1
  where presentation_id = v_session.presentation_id
    and status = 'active'::public.presentation_session_status
    and expires_at > now();

  return jsonb_build_object(
    'asset_id', v_asset_id,
    'presentation_id', v_session.presentation_id,
    'slide_id', v_session.slide_id,
    'image_slot', v_session.image_slot,
    'storage_path', p_storage_path
  );
end;
$$;

create or replace function public.cleanup_telegram_image_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_sessions integer := 0;
  v_updates integer := 0;
  v_stuck integer := 0;
begin
  update public.telegram_image_sessions
  set status = 'expired', updated_at = now()
  where status = 'active' and expires_at <= now();
  get diagnostics v_expired = row_count;

  update public.telegram_image_updates
  set status = 'failed', error_code = 'stale_processing', completed_at = now()
  where status = 'processing' and received_at < now() - interval '5 minutes';
  get diagnostics v_stuck = row_count;

  delete from public.telegram_image_sessions
  where status <> 'active' and created_at < now() - interval '30 days';
  get diagnostics v_sessions = row_count;

  delete from public.telegram_image_updates
  where received_at < now() - interval '7 days';
  get diagnostics v_updates = row_count;

  return jsonb_build_object(
    'expired', v_expired,
    'failed_stuck_updates', v_stuck,
    'deleted_sessions', v_sessions,
    'deleted_updates', v_updates
  );
end;
$$;

revoke all on function public.claim_telegram_image_update(bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_image_update(bigint) to service_role;
revoke all on function public.bind_telegram_image_session(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.bind_telegram_image_session(text, bigint, bigint) to service_role;
revoke all on function public.commit_telegram_image_selection(uuid, text, bigint, text, text, text, bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.commit_telegram_image_selection(uuid, text, bigint, text, text, text, bigint, integer, integer) to service_role;
revoke all on function public.cleanup_telegram_image_sessions() from public, anon, authenticated;
grant execute on function public.cleanup_telegram_image_sessions() to service_role;

comment on table public.telegram_image_sessions is
  'One-use, 15-minute Telegram capabilities pinned to one owner, presentation, slide and JSLAYD image slot. Only token hashes are stored.';
comment on table public.telegram_image_candidates is
  'Opaque callback candidates produced only by ImageResolver and bound server-side to a Telegram image session.';

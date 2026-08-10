-- Jaxongirman initial production schema.
-- All privileged mutations are performed through checked RPCs or service-role Edge Functions.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('user', 'admin');
create type public.user_status as enum ('active', 'blocked');
create type public.presentation_style as enum ('simple', 'good', 'great', 'super_professional');
create type public.presentation_status as enum ('draft', 'queued', 'generating', 'ready', 'failed', 'archived');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.step_status as enum ('queued', 'running', 'succeeded', 'failed', 'skipped');
create type public.element_type as enum ('text', 'image', 'shape', 'icon', 'chart', 'table', 'line', 'group');
create type public.asset_kind as enum ('upload', 'web', 'generated', 'icon', 'thumbnail', 'export');
create type public.credit_transaction_type as enum ('grant', 'reservation', 'charge', 'release', 'refund', 'admin_adjustment', 'purchase');
create type public.export_format as enum ('pdf', 'png', 'pptx');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  status public.user_status not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120)
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'user',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  public_read boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_settings_key_format check (key ~ '^[a-z][a-z0-9_.-]{1,79}$')
);

create table public.style_configs (
  style public.presentation_style primary key,
  label text not null,
  description text not null default '',
  base_credits integer not null,
  credits_per_slide numeric(8,2) not null,
  expected_image_ratio numeric(5,4) not null default 0,
  credits_per_image integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint style_configs_nonnegative check (
    base_credits >= 0 and credits_per_slide >= 0 and
    expected_image_ratio between 0 and 1 and credits_per_image >= 0
  )
);

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  topic text not null,
  style public.presentation_style not null,
  status public.presentation_status not null default 'draft',
  requested_slide_count integer not null,
  generated_slide_count integer not null default 0,
  author_name text,
  teacher_name text,
  visual_dna jsonb not null default '{}'::jsonb,
  thumbnail_path text,
  estimated_credits integer not null default 0,
  reserved_credits integer not null default 0,
  actual_credits integer not null default 0,
  generation_cost_usd numeric(14,6) not null default 0,
  error_message text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint presentations_title_length check (char_length(title) between 1 and 180),
  constraint presentations_topic_length check (char_length(topic) between 3 and 2000),
  constraint presentations_slide_count check (requested_slide_count between 1 and 30),
  constraint presentations_generated_count check (generated_slide_count between 0 and 30),
  constraint presentations_credit_values check (estimated_credits >= 0 and reserved_credits >= 0 and actual_credits >= 0)
);

create index presentations_owner_created_idx on public.presentations(owner_id, created_at desc);
create index presentations_status_idx on public.presentations(status, created_at desc);

create table public.slides (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  position integer not null,
  title text,
  layout text not null default 'hero',
  background jsonb not null default '{}'::jsonb,
  speaker_notes text,
  quality_score numeric(5,2),
  quality_report jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  unique (presentation_id, position),
  unique (id, presentation_id, owner_id),
  constraint slides_position check (position between 0 and 29),
  constraint slides_quality_score check (quality_score is null or quality_score between 0 and 100)
);

create index slides_presentation_position_idx on public.slides(presentation_id, position);

create table public.slide_elements (
  id uuid primary key default gen_random_uuid(),
  slide_id uuid not null,
  presentation_id uuid not null,
  owner_id uuid not null,
  type public.element_type not null,
  x numeric(10,4) not null,
  y numeric(10,4) not null,
  width numeric(10,4) not null,
  height numeric(10,4) not null,
  rotation numeric(8,3) not null default 0,
  z_index integer not null default 0,
  opacity numeric(5,4) not null default 1,
  locked boolean not null default false,
  style jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (slide_id, presentation_id, owner_id)
    references public.slides(id, presentation_id, owner_id) on delete cascade,
  constraint slide_elements_geometry check (x >= 0 and y >= 0 and width > 0 and height > 0),
  constraint slide_elements_opacity check (opacity between 0 and 1)
);

create index slide_elements_slide_z_idx on public.slide_elements(slide_id, z_index);

create table public.presentation_assets (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  kind public.asset_kind not null,
  storage_bucket text,
  storage_path text,
  source_url text,
  mime_type text,
  byte_size bigint,
  width integer,
  height integer,
  alt_text text,
  provider text,
  provider_asset_id text,
  license_name text,
  license_url text,
  attribution text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  constraint presentation_assets_location check (storage_path is not null or source_url is not null),
  constraint presentation_assets_size check (byte_size is null or byte_size >= 0)
);

create index presentation_assets_presentation_idx on public.presentation_assets(presentation_id, created_at);

create table public.presentation_sources (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  label text not null,
  url text,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  constraint presentation_sources_label check (char_length(label) between 1 and 1000)
);

create index presentation_sources_presentation_idx on public.presentation_sources(presentation_id, position);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  idempotency_key text not null,
  status public.job_status not null default 'queued',
  stage text not null default 'preparing',
  progress integer not null default 0,
  reserved_credits integer not null default 0,
  actual_credits integer not null default 0,
  provider text,
  provider_job_id text,
  attempt_count integer not null default 0,
  error_code text,
  error_message text,
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  unique (owner_id, idempotency_key),
  unique (id, presentation_id, owner_id),
  constraint generation_jobs_progress check (progress between 0 and 100),
  constraint generation_jobs_credits check (reserved_credits >= 0 and actual_credits >= 0)
);

create index generation_jobs_owner_created_idx on public.generation_jobs(owner_id, created_at desc);
create index generation_jobs_status_idx on public.generation_jobs(status, created_at);

create table public.generation_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  presentation_id uuid not null,
  owner_id uuid not null,
  sequence integer not null,
  key text not null,
  label text not null,
  status public.step_status not null default 'queued',
  progress integer not null default 0,
  message text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, presentation_id, owner_id)
    references public.generation_jobs(id, presentation_id, owner_id) on delete cascade,
  unique (job_id, key),
  unique (job_id, sequence),
  constraint generation_steps_progress check (progress between 0 and 100)
);

create index generation_steps_job_sequence_idx on public.generation_steps(job_id, sequence);

create table public.credit_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0,
  reserved integer not null default 0,
  lifetime_granted integer not null default 0,
  lifetime_spent integer not null default 0,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_wallets_nonnegative check (balance >= 0 and reserved >= 0 and lifetime_granted >= 0 and lifetime_spent >= 0)
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.generation_jobs(id) on delete set null,
  type public.credit_transaction_type not null,
  amount integer not null default 0,
  reservation_delta integer not null default 0,
  balance_after integer not null,
  reserved_after integer not null,
  idempotency_key text not null,
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  constraint credit_transactions_result_nonnegative check (balance_after >= 0 and reserved_after >= 0),
  constraint credit_transactions_has_effect check (amount <> 0 or reservation_delta <> 0 or type = 'charge')
);

create index credit_transactions_user_created_idx on public.credit_transactions(user_id, created_at desc);
create index credit_transactions_job_idx on public.credit_transactions(job_id) where job_id is not null;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete set null,
  job_id uuid references public.generation_jobs(id) on delete set null,
  provider text not null,
  model text not null,
  operation text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  generated_images integer not null default 0,
  provider_cost_usd numeric(14,6) not null default 0,
  latency_ms integer,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_usage_nonnegative check (
    input_tokens >= 0 and output_tokens >= 0 and generated_images >= 0 and provider_cost_usd >= 0 and
    (latency_ms is null or latency_ms >= 0)
  )
);

create index ai_usage_created_idx on public.ai_usage(created_at desc);
create index ai_usage_presentation_idx on public.ai_usage(presentation_id) where presentation_id is not null;

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  format public.export_format not null,
  status public.job_status not null default 'queued',
  progress integer not null default 0,
  storage_path text,
  error_message text,
  options jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  constraint export_jobs_progress check (progress between 0 and 100)
);

create index export_jobs_owner_created_idx on public.export_jobs(owner_id, created_at desc);

create table public.presentation_edit_history (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null,
  owner_id uuid not null,
  slide_id uuid references public.slides(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation jsonb not null,
  inverse_operation jsonb not null,
  version integer not null,
  created_at timestamptz not null default now(),
  foreign key (presentation_id, owner_id) references public.presentations(id, owner_id) on delete cascade,
  foreign key (slide_id, presentation_id, owner_id)
    references public.slides(id, presentation_id, owner_id) on delete cascade,
  unique (presentation_id, version)
);

create index presentation_edit_history_presentation_idx on public.presentation_edit_history(presentation_id, version desc);

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  request_id text,
  created_at timestamptz not null default now()
);

create index admin_audit_logs_created_idx on public.admin_audit_logs(created_at desc);
create index admin_audit_logs_target_idx on public.admin_audit_logs(target_type, target_id, created_at desc);

create table public.api_rate_limits (
  key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint api_rate_limits_request_count check (request_count >= 0)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings for each row execute function public.set_updated_at();
create trigger style_configs_set_updated_at before update on public.style_configs for each row execute function public.set_updated_at();
create trigger presentations_set_updated_at before update on public.presentations for each row execute function public.set_updated_at();
create trigger slides_set_updated_at before update on public.slides for each row execute function public.set_updated_at();
create trigger slide_elements_set_updated_at before update on public.slide_elements for each row execute function public.set_updated_at();
create trigger presentation_assets_set_updated_at before update on public.presentation_assets for each row execute function public.set_updated_at();
create trigger presentation_sources_set_updated_at before update on public.presentation_sources for each row execute function public.set_updated_at();
create trigger generation_jobs_set_updated_at before update on public.generation_jobs for each row execute function public.set_updated_at();
create trigger generation_steps_set_updated_at before update on public.generation_steps for each row execute function public.set_updated_at();
create trigger credit_wallets_set_updated_at before update on public.credit_wallets for each row execute function public.set_updated_at();
create trigger export_jobs_set_updated_at before update on public.export_jobs for each row execute function public.set_updated_at();

create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'credit transactions are immutable' using errcode = '42501';
end;
$$;

create trigger credit_transactions_immutable
before update or delete on public.credit_transactions
for each row execute function public.reject_ledger_mutation();

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = 'admin'::public.app_role
  );
$$;

create or replace function public.estimate_presentation_credits(
  p_style public.presentation_style,
  p_slide_count integer
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.style_configs%rowtype;
  v_max_slides integer;
begin
  select coalesce((value #>> '{}')::integer, 30)
    into v_max_slides
    from public.app_settings
    where key = 'generation.max_slide_count';
  v_max_slides := coalesce(v_max_slides, 30);

  if p_slide_count < 1 or p_slide_count > v_max_slides then
    raise exception 'slide count must be between 1 and %', v_max_slides using errcode = '22023';
  end if;

  select * into v_config from public.style_configs where style = p_style and is_active;
  if not found then
    raise exception 'presentation style is unavailable' using errcode = '22023';
  end if;

  return ceil(
    v_config.base_credits +
    (p_slide_count * v_config.credits_per_slide) +
    (ceil(p_slide_count * v_config.expected_image_ratio) * v_config.credits_per_image)
  )::integer;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initial_credits integer;
begin
  select coalesce((value #>> '{}')::integer, 100)
    into v_initial_credits
    from public.app_settings
    where key = 'credits.initial_grant';
  v_initial_credits := coalesce(v_initial_credits, 100);

  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    new.raw_user_meta_data ->> 'avatar_url'
  ) on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user') on conflict do nothing;

  insert into public.credit_wallets (user_id, balance, lifetime_granted)
  values (new.id, v_initial_credits, v_initial_credits) on conflict (user_id) do nothing;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key, description
  ) values (
    new.id, 'grant', v_initial_credits, v_initial_credits, 0,
    'initial-grant:' || new.id::text, 'Welcome credits'
  ) on conflict (user_id, idempotency_key) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.start_generation(
  p_presentation_id uuid,
  p_topic text,
  p_title text,
  p_style public.presentation_style,
  p_slide_count integer,
  p_author_name text default null,
  p_teacher_name text default null,
  p_sources text[] default '{}'::text[],
  p_idempotency_key text default null
)
returns table (presentation_id uuid, job_id uuid, estimated_credits integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_estimate integer;
  v_wallet public.credit_wallets%rowtype;
  v_idempotency text := coalesce(nullif(btrim(p_idempotency_key), ''), p_presentation_id::text);
  v_existing public.generation_jobs%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_presentation_id is null or char_length(btrim(p_topic)) < 3 then
    raise exception 'valid presentation id and topic are required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = v_user_id and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;

  select * into v_existing
  from public.generation_jobs
  where owner_id = v_user_id and idempotency_key = v_idempotency;
  if found then
    return query select v_existing.presentation_id, v_existing.id, v_existing.reserved_credits;
    return;
  end if;

  v_estimate := public.estimate_presentation_credits(p_style, p_slide_count);
  select * into v_wallet from public.credit_wallets where user_id = v_user_id for update;
  if not found then
    raise exception 'credit wallet not found' using errcode = 'P0002';
  end if;
  if v_wallet.balance < v_estimate then
    raise exception 'insufficient credits' using errcode = 'P0001', detail = format('required=%s available=%s', v_estimate, v_wallet.balance);
  end if;

  insert into public.presentations (
    id, owner_id, title, topic, style, status, requested_slide_count,
    author_name, teacher_name, estimated_credits, reserved_credits
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_estimate, v_estimate
  );

  insert into public.presentation_sources (presentation_id, owner_id, label, position)
  select p_presentation_id, v_user_id, left(btrim(source), 1000), ordinality::integer - 1
  from unnest(p_sources) with ordinality as source_rows(source, ordinality)
  where nullif(btrim(source), '') is not null;

  insert into public.generation_jobs (
    presentation_id, owner_id, idempotency_key, status, stage, progress, reserved_credits
  ) values (
    p_presentation_id, v_user_id, v_idempotency, 'queued', 'preparing', 0, v_estimate
  ) returning id into v_job_id;

  insert into public.generation_steps (
    job_id, presentation_id, owner_id, sequence, key, label, status, progress
  ) values (
    v_job_id, p_presentation_id, v_user_id, 0, 'preparing', 'Tayyorlanmoqda', 'queued', 0
  );

  update public.credit_wallets
    set balance = balance - v_estimate,
        reserved = reserved + v_estimate,
        version = version + 1
    where user_id = v_user_id;

  insert into public.credit_transactions (
    user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
    idempotency_key, description, metadata
  ) values (
    v_user_id, v_job_id, 'reservation', -v_estimate, v_estimate,
    v_wallet.balance - v_estimate, v_wallet.reserved + v_estimate,
    'reserve:' || v_idempotency, 'Presentation generation reservation',
    jsonb_build_object('presentation_id', p_presentation_id, 'style', p_style, 'slide_count', p_slide_count)
  );

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;

create or replace function public.settle_generation(
  p_job_id uuid,
  p_actual_credits integer,
  p_provider_cost_usd numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
  v_charge integer;
  v_release integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_actual_credits < 0 or p_provider_cost_usd < 0 then
    raise exception 'usage values must be nonnegative' using errcode = '22023';
  end if;

  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'generation job not found' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' then return; end if;
  if v_job.status in ('failed', 'cancelled') then
    raise exception 'generation job is already closed' using errcode = '55000';
  end if;

  select * into v_wallet from public.credit_wallets where user_id = v_job.owner_id for update;
  v_charge := least(p_actual_credits, v_job.reserved_credits);
  v_release := v_job.reserved_credits - v_charge;

  update public.credit_wallets
    set balance = balance + v_release,
        reserved = reserved - v_job.reserved_credits,
        lifetime_spent = lifetime_spent + v_charge,
        version = version + 1
    where user_id = v_job.owner_id;

  if v_charge > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'charge', 0, -v_charge,
      v_wallet.balance, v_wallet.reserved - v_charge,
      'settle-charge:' || v_job.id::text, 'Generation credits charged',
      jsonb_build_object('actual_credits', v_charge)
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  if v_release > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'release', v_release, -v_release,
      v_wallet.balance + v_release, v_wallet.reserved - v_job.reserved_credits,
      'settle-release:' || v_job.id::text, 'Unused reserved credits released',
      jsonb_build_object('reserved_credits', v_job.reserved_credits, 'actual_credits', v_charge)
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  update public.generation_jobs
    set status = 'succeeded', stage = 'ready', progress = 100,
        actual_credits = v_charge, completed_at = now(), heartbeat_at = now()
    where id = v_job.id;
  update public.presentations
    set status = 'ready', actual_credits = v_charge, reserved_credits = 0,
        generation_cost_usd = p_provider_cost_usd, error_message = null
    where id = v_job.presentation_id;
end;
$$;

create or replace function public.fail_generation(
  p_job_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_wallet public.credit_wallets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'generation job not found' using errcode = 'P0002'; end if;
  if v_job.status in ('failed', 'cancelled', 'succeeded') then return; end if;
  select * into v_wallet from public.credit_wallets where user_id = v_job.owner_id for update;

  update public.credit_wallets
    set balance = balance + v_job.reserved_credits,
        reserved = reserved - v_job.reserved_credits,
        version = version + 1
    where user_id = v_job.owner_id;

  if v_job.reserved_credits > 0 then
    insert into public.credit_transactions (
      user_id, job_id, type, amount, reservation_delta, balance_after, reserved_after,
      idempotency_key, description, metadata
    ) values (
      v_job.owner_id, v_job.id, 'refund', v_job.reserved_credits, -v_job.reserved_credits,
      v_wallet.balance + v_job.reserved_credits, v_wallet.reserved - v_job.reserved_credits,
      'failure-refund:' || v_job.id::text, 'Generation failure refund',
      jsonb_build_object('error_code', left(coalesce(p_error_code, 'generation_failed'), 120))
    ) on conflict (user_id, idempotency_key) do nothing;
  end if;

  update public.generation_jobs
    set status = 'failed', stage = 'failed', reserved_credits = 0,
        error_code = left(coalesce(p_error_code, 'generation_failed'), 120),
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000),
        completed_at = now(), heartbeat_at = now()
    where id = v_job.id;
  update public.presentations
    set status = 'failed', reserved_credits = 0,
        error_message = left(coalesce(p_error_message, 'Generation failed'), 2000)
    where id = v_job.presentation_id;
end;
$$;

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_idempotency_key text
)
returns public.credit_wallets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_before public.credit_wallets%rowtype;
  v_after public.credit_wallets%rowtype;
begin
  if not public.is_admin(v_admin_id) then raise exception 'admin role required' using errcode = '42501'; end if;
  if p_amount = 0 or nullif(btrim(p_reason), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'amount, reason and idempotency key are required' using errcode = '22023';
  end if;
  select * into v_before from public.credit_wallets where user_id = p_user_id for update;
  if not found then raise exception 'credit wallet not found' using errcode = 'P0002'; end if;
  if v_before.balance + p_amount < 0 then raise exception 'adjustment would create negative balance' using errcode = '22003'; end if;

  update public.credit_wallets
    set balance = balance + p_amount,
        lifetime_granted = lifetime_granted + greatest(p_amount, 0),
        version = version + 1
    where user_id = p_user_id returning * into v_after;

  insert into public.credit_transactions (
    user_id, type, amount, balance_after, reserved_after, idempotency_key,
    description, created_by, metadata
  ) values (
    p_user_id, 'admin_adjustment', p_amount, v_after.balance, v_after.reserved,
    'admin:' || btrim(p_idempotency_key), left(btrim(p_reason), 500), v_admin_id,
    jsonb_build_object('previous_balance', v_before.balance)
  );

  insert into public.admin_audit_logs (
    admin_id, action, target_type, target_id, before_data, after_data, reason
  ) values (
    v_admin_id, 'credits.adjust', 'user', p_user_id::text,
    to_jsonb(v_before), to_jsonb(v_after), left(btrim(p_reason), 500)
  );
  return v_after;
end;
$$;

create or replace function public.admin_set_user_status(
  p_user_id uuid,
  p_status public.user_status,
  p_reason text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_before public.profiles%rowtype;
  v_after public.profiles%rowtype;
begin
  if not public.is_admin(v_admin_id) then raise exception 'admin role required' using errcode = '42501'; end if;
  if p_user_id = v_admin_id and p_status = 'blocked' then raise exception 'admins cannot block themselves' using errcode = '22023'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason is required' using errcode = '22023'; end if;
  select * into v_before from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;
  update public.profiles set status = p_status where id = p_user_id returning * into v_after;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin_id, 'user.status', 'user', p_user_id::text, to_jsonb(v_before), to_jsonb(v_after), left(btrim(p_reason), 500));
  return v_after;
end;
$$;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_admin(auth.uid()) then jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'active_users', (select count(*) from public.profiles where status = 'active' and coalesce(last_seen_at, created_at) >= now() - interval '30 days'),
    'presentations_created', (select count(*) from public.presentations),
    'slides_generated', (select count(*) from public.slides),
    'credits_spent', (select coalesce(sum(actual_credits), 0) from public.generation_jobs where status = 'succeeded'),
    'ai_cost_usd', (select coalesce(sum(provider_cost_usd), 0) from public.ai_usage),
    'failed_jobs', (select count(*) from public.generation_jobs where status = 'failed'),
    'success_rate', (
      select case when count(*) filter (where status in ('succeeded', 'failed')) = 0 then 0
      else round(100.0 * count(*) filter (where status = 'succeeded') / count(*) filter (where status in ('succeeded', 'failed')), 2) end
      from public.generation_jobs
    )
  ) else null end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  full_name text,
  status public.user_status,
  credits integer,
  reserved_credits integer,
  presentation_count bigint,
  created_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin role required' using errcode = '42501'; end if;
  return query
  select u.id, u.email::text, p.full_name, p.status, w.balance, w.reserved,
    count(pr.id), u.created_at, p.last_seen_at
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.credit_wallets w on w.user_id = u.id
  left join public.presentations pr on pr.owner_id = u.id
  where nullif(btrim(p_search), '') is null
     or u.email ilike '%' || btrim(p_search) || '%'
     or p.full_name ilike '%' || btrim(p_search) || '%'
  group by u.id, u.email, p.full_name, p.status, w.balance, w.reserved, u.created_at, p.last_seen_at
  order by u.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.admin_list_presentations(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  presentation_id uuid,
  owner_id uuid,
  owner_email text,
  title text,
  status public.presentation_status,
  style public.presentation_style,
  slide_count integer,
  credits_charged integer,
  cost_usd numeric,
  error_message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin role required' using errcode = '42501'; end if;
  return query
  select p.id, p.owner_id, u.email::text, p.title, p.status, p.style,
    p.generated_slide_count, p.actual_credits, p.generation_cost_usd, p.error_message, p.created_at
  from public.presentations p
  join auth.users u on u.id = p.owner_id
  order by p.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0);
end;
$$;

-- Explicit grants: new tables are not implicitly exposed by recent Supabase projects.
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant select on public.style_configs, public.app_settings to anon, authenticated;
grant select on public.profiles, public.user_roles, public.presentations, public.slides,
  public.slide_elements, public.presentation_assets, public.presentation_sources,
  public.generation_jobs, public.generation_steps, public.credit_wallets,
  public.credit_transactions, public.ai_usage, public.export_jobs,
  public.presentation_edit_history, public.admin_audit_logs to authenticated;
grant update (full_name, avatar_url, last_seen_at) on public.profiles to authenticated;
grant update (title, topic, author_name, teacher_name) on public.presentations to authenticated;
grant insert, update, delete on public.slides, public.slide_elements, public.presentation_assets,
  public.presentation_sources, public.presentation_edit_history to authenticated;
grant delete on public.presentations to authenticated;
grant execute on function public.is_admin(uuid) to authenticated, service_role;
grant execute on function public.estimate_presentation_credits(public.presentation_style, integer) to authenticated, service_role;
grant execute on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text) to authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text, text) to authenticated;
grant execute on function public.admin_set_user_status(uuid, public.user_status, text) to authenticated;
grant execute on function public.admin_dashboard_metrics() to authenticated;
grant execute on function public.admin_list_users(text, integer, integer) to authenticated;
grant execute on function public.admin_list_presentations(integer, integer) to authenticated;
revoke all on function public.settle_generation(uuid, integer, numeric) from public, anon, authenticated;
revoke all on function public.fail_generation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_generation(uuid, integer, numeric) to service_role;
grant execute on function public.fail_generation(uuid, text, text) to service_role;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.app_settings enable row level security;
alter table public.style_configs enable row level security;
alter table public.presentations enable row level security;
alter table public.slides enable row level security;
alter table public.slide_elements enable row level security;
alter table public.presentation_assets enable row level security;
alter table public.presentation_sources enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_steps enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.export_jobs enable row level security;
alter table public.presentation_edit_history enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.api_rate_limits enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy settings_public_select on public.app_settings for select to anon, authenticated
  using (public_read or (select public.is_admin()));
create policy style_configs_select on public.style_configs for select to anon, authenticated
  using (is_active or (select public.is_admin()));

create policy presentations_select on public.presentations for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy presentations_update on public.presentations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy presentations_delete on public.presentations for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy slides_select on public.slides for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy slides_insert on public.slides for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy slides_update on public.slides for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy slides_delete on public.slides for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy elements_select on public.slide_elements for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy elements_insert on public.slide_elements for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy elements_update on public.slide_elements for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy elements_delete on public.slide_elements for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy assets_select on public.presentation_assets for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy assets_insert on public.presentation_assets for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy assets_update on public.presentation_assets for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy assets_delete on public.presentation_assets for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy sources_select on public.presentation_sources for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy sources_insert on public.presentation_sources for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy sources_update on public.presentation_sources for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy sources_delete on public.presentation_sources for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy generation_jobs_select on public.generation_jobs for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy generation_steps_select on public.generation_steps for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy wallets_select on public.credit_wallets for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy transactions_select on public.credit_transactions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy export_jobs_select on public.export_jobs for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy edit_history_select on public.presentation_edit_history for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy edit_history_insert on public.presentation_edit_history for insert to authenticated
  with check (owner_id = (select auth.uid()) and actor_id = (select auth.uid()));
create policy admin_audit_select on public.admin_audit_logs for select to authenticated
  using ((select public.is_admin()));

-- Storage is private. The first path segment is always the owner's UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('user-uploads', 'user-uploads', false, 52428800, array[
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'image/jpeg', 'image/png', 'image/webp'
  ]),
  ('presentation-assets', 'presentation-assets', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('generated-images', 'generated-images', false, 52428800, array['image/jpeg', 'image/png', 'image/webp']),
  ('exports', 'exports', false, 104857600, array['application/pdf', 'image/png', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('thumbnails', 'thumbnails', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy storage_owner_select on storage.objects for select to authenticated
  using (
    bucket_id in ('user-uploads', 'presentation-assets', 'generated-images', 'exports', 'thumbnails')
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );
create policy storage_upload_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_upload_update on storage.objects for update to authenticated
  using (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy storage_upload_delete on storage.objects for delete to authenticated
  using (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter publication supabase_realtime add table public.presentations;
alter publication supabase_realtime add table public.slides;
alter publication supabase_realtime add table public.slide_elements;
alter publication supabase_realtime add table public.generation_jobs;
alter publication supabase_realtime add table public.generation_steps;

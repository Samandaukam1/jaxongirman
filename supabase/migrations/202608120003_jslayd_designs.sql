-- JSLAYD 1.0 — the remote design registry.
--
-- Designs stop being TypeScript that ships with the app and become rows an
-- admin publishes. A new design must not require a store release (§67), which
-- means the catalogue, the compiled document, the fonts and the preview all
-- have to live here.
--
-- Nothing in this migration touches `slide_templates` or `palette_families`.
-- The built-in designs keep working exactly as they do today, and stay the
-- fallback until every one of them has been migrated and visually compared
-- (§72). Two catalogues coexist on purpose for the length of that crossover.

create type public.jslayd_design_status as enum ('draft', 'published', 'archived');

create table if not exists public.presentation_designs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- The tier the design belongs to. The four presentation styles are unchanged
  -- (§3); a design is a look *inside* a tier, not a tier of its own.
  tier public.presentation_style not null,
  description text not null default '',
  status public.jslayd_design_status not null default 'draft',
  format_version text not null default '1.0',
  is_premium boolean not null default false,
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  -- Preview artwork for the style picker. This is the design's own thumbnail,
  -- never a slide of a generated deck (§28).
  thumbnail_path text,
  -- The prompt the admin wrote, kept so a design can be reopened and edited
  -- rather than only rebuilt from scratch (§58).
  source_prompt text not null default '',
  -- The compiled `.jslayd` document. The only thing a renderer ever reads.
  compiled_config jsonb,
  -- The rendered cover archetype on sample content, so the picker draws a real
  -- thumbnail without running the engine on the phone.
  preview jsonb not null default '{}'::jsonb,
  -- SHA-256 of the canonical compiled bytes: the cache key the apps invalidate
  -- on (§68) and the identity a version row records.
  content_hash text,
  health_score integer,
  published_version integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint presentation_designs_slug_format check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(slug) between 3 and 64),
  constraint presentation_designs_health check (health_score is null or health_score between 0 and 100),
  -- A row may only claim to be published once it carries a document that says
  -- it is JSLAYD. This is the last line of defence against a half-written
  -- design reaching a phone (§99).
  constraint presentation_designs_published_needs_document check (
    status <> 'published'
    or (compiled_config is not null and compiled_config->>'format' = 'JSLAYD' and content_hash is not null)
  )
);

create index presentation_designs_catalogue_idx
  on public.presentation_designs(tier, sort_order, created_at)
  where status = 'published';
create index presentation_designs_status_idx on public.presentation_designs(status, updated_at desc);

create trigger presentation_designs_set_updated_at
  before update on public.presentation_designs
  for each row execute function public.set_updated_at();

-- The font files a design ships with (§8). One to four, `font_1` first.
create table if not exists public.presentation_design_fonts (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.presentation_designs(id) on delete cascade,
  font_id text not null,
  name text not null default '',
  roles text[] not null default '{}',
  -- Object key inside the `design-fonts` bucket. Never a URL and never a path
  -- the document controls: the bucket prefix is built from the design's own id.
  asset_path text,
  format text,
  weight integer not null default 400,
  italic boolean not null default false,
  -- The bundled face drawn until the file loads, and the name PowerPoint gets.
  fallback text not null default 'Manrope',
  byte_size integer,
  checksum text,
  created_at timestamptz not null default now(),
  unique (design_id, font_id),
  constraint design_fonts_id_format check (font_id ~ '^font_[1-4]$'),
  constraint design_fonts_weight check (weight between 100 and 900),
  -- WOFF2 is absent on purpose: fontkit cannot embed it, so a PDF export would
  -- silently lose the face (§78).
  constraint design_fonts_format check (format is null or format in ('ttf', 'otf', 'woff')),
  constraint design_fonts_asset_safe check (asset_path is null or asset_path !~ '\.\.')
);

create index presentation_design_fonts_design_idx on public.presentation_design_fonts(design_id);

-- Every publish is kept (§59). A deck generated against v1 must keep opening
-- after v2 ships, which it can only do if v1 is still here to be read.
create table if not exists public.presentation_design_versions (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.presentation_designs(id) on delete cascade,
  version integer not null,
  source_prompt text not null default '',
  compiled_config jsonb not null,
  content_hash text not null,
  health_score integer,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (design_id, version),
  constraint design_versions_positive check (version > 0),
  constraint design_versions_is_jslayd check (compiled_config->>'format' = 'JSLAYD')
);

create index presentation_design_versions_design_idx
  on public.presentation_design_versions(design_id, version desc);

-- Which design a deck was built from, and at which version.
--
-- Nullable, because every presentation that exists today was built from a
-- `slide_templates` blueprint and must keep rendering from it untouched. Only
-- decks generated after a JSLAYD design is chosen carry these.
alter table public.presentations
  add column if not exists design_id uuid references public.presentation_designs(id) on delete set null,
  add column if not exists design_version integer;

create index if not exists presentations_design_idx on public.presentations(design_id) where design_id is not null;

/* --------------------------------------------------------------------- RLS */

alter table public.presentation_designs enable row level security;
alter table public.presentation_design_fonts enable row level security;
alter table public.presentation_design_versions enable row level security;

-- Readers see published designs and nothing else. A draft is invisible to
-- users by construction rather than by a filter the client is trusted to
-- apply (§60), and an archived design stays readable to nobody new while the
-- decks that already reference it read through their pinned version row.
--
-- Signed-out readers get their own policy rather than sharing one with a
-- `public.is_admin()` disjunct. `anon` has no EXECUTE on that function, so a
-- shared policy would only work while the planner happened to short-circuit
-- the OR — which is a permission resting on an evaluation order, not on a
-- grant. Two policies make the rule true by construction.
create policy presentation_designs_public_read on public.presentation_designs
  for select to anon
  using (status = 'published');

create policy presentation_designs_read on public.presentation_designs
  for select to authenticated
  using (status = 'published' or (select public.is_admin()));

-- There is deliberately no write policy on any of these three tables.
--
-- Every write goes through a `security definer` admin RPC below, and no client
-- role holds INSERT, UPDATE or DELETE. A permissive write policy with no
-- matching grant would say the opposite of what the code means — the exact
-- inversion 202608100012 took two privileges back for.

create policy presentation_design_fonts_public_read on public.presentation_design_fonts
  for select to anon
  using (
    exists (
      select 1 from public.presentation_designs design
      where design.id = design_id and design.status = 'published'
    )
  );

create policy presentation_design_fonts_read on public.presentation_design_fonts
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.presentation_designs design
      where design.id = design_id and design.status = 'published'
    )
  );

-- A version row is how an old deck still renders, so any reader who can reach
-- the deck must be able to reach the version it was pinned to.
create policy presentation_design_versions_read on public.presentation_design_versions
  for select to anon, authenticated
  using (true);

grant select on public.presentation_designs, public.presentation_design_fonts, public.presentation_design_versions
  to anon, authenticated;

/* ----------------------------------------------------------------- storage */

-- Both buckets are public-read and admin-write.
--
-- A font file and a design thumbnail are catalogue artwork, not user data:
-- every signed-out projector and every phone rendering a picker needs them,
-- and a web `@font-face` cannot chase an expiring signed URL. Write is what
-- has to be protected, and it is (§97).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('design-fonts', 'design-fonts', true, 8388608, array[
    'font/ttf', 'application/x-font-ttf', 'font/otf', 'application/x-font-otf',
    'font/sfnt', 'application/font-sfnt', 'font/woff', 'application/font-woff',
    'application/octet-stream'
  ]),
  ('design-previews', 'design-previews', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy design_assets_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('design-fonts', 'design-previews'));

create policy design_assets_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id in ('design-fonts', 'design-previews') and (select public.is_admin()));


create policy design_assets_admin_update on storage.objects
  for update to authenticated
  using (bucket_id in ('design-fonts', 'design-previews') and (select public.is_admin()))
  with check (bucket_id in ('design-fonts', 'design-previews') and (select public.is_admin()));

create policy design_assets_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id in ('design-fonts', 'design-previews') and (select public.is_admin()));

/* -------------------------------------------------------------------- RPCs */

-- Saves the authoring state of a design without publishing it.
--
-- Compilation happens in the admin console, which is where the JSLAYD compiler
-- lives; what arrives here is a document plus the prompt that produced it. The
-- server's job is to check that the payload is a JSLAYD document at all and
-- that the caller is allowed to write it — it does not re-run the compiler,
-- and it never treats any part of the payload as anything but data (§39).
create or replace function public.admin_save_design(
  p_slug text,
  p_name text,
  p_tier public.presentation_style,
  p_description text default '',
  p_is_premium boolean default false,
  p_source_prompt text default '',
  p_compiled_config jsonb default null,
  p_preview jsonb default '{}'::jsonb,
  p_content_hash text default null,
  p_health_score integer default null,
  p_thumbnail_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_id uuid;
  v_before jsonb;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_compiled_config is not null and p_compiled_config->>'format' is distinct from 'JSLAYD' then
    raise exception 'not_a_jslayd_document' using errcode = '22023';
  end if;
  -- 4 MB matches the document ceiling the compiler enforces; a payload past it
  -- is either a mistake or an attempt to fill the table (§82).
  if p_compiled_config is not null and pg_column_size(p_compiled_config) > 4194304 then
    raise exception 'document_too_large' using errcode = '22023';
  end if;

  select to_jsonb(design) into v_before from public.presentation_designs design where slug = p_slug;

  insert into public.presentation_designs as design (
    slug, name, tier, description, is_premium, source_prompt,
    compiled_config, preview, content_hash, health_score, thumbnail_path, created_by
  )
  values (
    p_slug, p_name, p_tier, coalesce(p_description, ''), coalesce(p_is_premium, false), coalesce(p_source_prompt, ''),
    p_compiled_config, coalesce(p_preview, '{}'::jsonb), p_content_hash, p_health_score, p_thumbnail_path, v_admin
  )
  on conflict (slug) do update set
    name = excluded.name,
    tier = excluded.tier,
    description = excluded.description,
    is_premium = excluded.is_premium,
    source_prompt = excluded.source_prompt,
    compiled_config = excluded.compiled_config,
    preview = excluded.preview,
    content_hash = excluded.content_hash,
    health_score = excluded.health_score,
    thumbnail_path = coalesce(excluded.thumbnail_path, design.thumbnail_path)
  returning design.id into v_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (
    v_admin,
    case when v_before is null then 'design.created' else 'design.edited' end,
    'presentation_design', v_id::text, v_before,
    jsonb_build_object('slug', p_slug, 'name', p_name, 'tier', p_tier, 'content_hash', p_content_hash)
  );

  return v_id;
end;
$$;

-- Attaches or replaces one of a design's fonts (§8).
--
-- The upload itself goes to the `design-fonts` bucket from the admin console;
-- this records what the design should look for. The object key is rebuilt from
-- the design's slug rather than taken from the caller, so no payload can point
-- a font at another design's prefix (§82).
create or replace function public.admin_save_design_font(
  p_design_id uuid,
  p_font_id text,
  p_name text,
  p_roles text[],
  p_file_name text,
  p_format text,
  p_weight integer default 400,
  p_italic boolean default false,
  p_fallback text default 'Manrope',
  p_byte_size integer default null,
  p_checksum text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_slug text;
  v_id uuid;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select slug into v_slug from public.presentation_designs where id = p_design_id;
  if v_slug is null then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;
  if p_file_name is not null and p_file_name ~ '[/\\]|\.\.' then
    raise exception 'unsafe_asset' using errcode = '22023';
  end if;

  insert into public.presentation_design_fonts as font (
    design_id, font_id, name, roles, asset_path, format, weight, italic, fallback, byte_size, checksum
  )
  values (
    p_design_id, p_font_id, coalesce(p_name, ''), coalesce(p_roles, '{}'),
    case when p_file_name is null then null else v_slug || '/' || p_file_name end,
    p_format, coalesce(p_weight, 400), coalesce(p_italic, false), coalesce(p_fallback, 'Manrope'),
    p_byte_size, p_checksum
  )
  on conflict (design_id, font_id) do update set
    name = excluded.name,
    roles = excluded.roles,
    asset_path = coalesce(excluded.asset_path, font.asset_path),
    format = coalesce(excluded.format, font.format),
    weight = excluded.weight,
    italic = excluded.italic,
    fallback = excluded.fallback,
    byte_size = excluded.byte_size,
    checksum = excluded.checksum
  returning font.id into v_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.font_saved', 'presentation_design', p_design_id::text,
    jsonb_build_object('font_id', p_font_id, 'format', p_format));

  return v_id;
end;
$$;

create or replace function public.admin_delete_design_font(p_design_id uuid, p_font_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.presentation_design_fonts where design_id = p_design_id and font_id = p_font_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.font_removed', 'presentation_design', p_design_id::text,
    jsonb_build_object('font_id', p_font_id));
end;
$$;

-- Publishes the current draft, snapshotting it as the next version.
create or replace function public.admin_publish_design(p_design_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_design public.presentation_designs;
  v_version integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_design from public.presentation_designs where id = p_design_id for update;
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;
  if v_design.compiled_config is null or v_design.content_hash is null then
    raise exception 'design_not_compiled' using errcode = '22023';
  end if;

  -- Republishing an unchanged design would spend a version number on nothing
  -- and make the history unreadable, so an identical hash is a no-op.
  select version into v_version
  from public.presentation_design_versions
  where design_id = p_design_id and content_hash = v_design.content_hash
  order by version desc limit 1;

  if v_version is null then
    v_version := v_design.published_version + 1;
    insert into public.presentation_design_versions (
      design_id, version, source_prompt, compiled_config, content_hash, health_score, published_by
    )
    values (
      p_design_id, v_version, v_design.source_prompt, v_design.compiled_config,
      v_design.content_hash, v_design.health_score, v_admin
    );
  end if;

  update public.presentation_designs
  set status = 'published', published_version = v_version, published_at = now()
  where id = p_design_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.published', 'presentation_design', p_design_id::text,
    jsonb_build_object('version', v_version, 'content_hash', v_design.content_hash));

  return v_version;
end;
$$;

-- Withdraws a design. Archiving, never deleting: decks already built from it
-- must keep opening, and a foreign key with history behind it is not something
-- to break for tidiness (§79).
create or replace function public.admin_archive_design(p_design_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.presentation_designs set status = 'archived' where id = p_design_id;
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason)
  values (v_admin, 'design.archived', 'presentation_design', p_design_id::text, p_reason);
end;
$$;

create or replace function public.admin_restore_design(p_design_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- A restored design returns to draft, not to published: whoever archived it
  -- had a reason, and the way back is a deliberate publish.
  update public.presentation_designs set status = 'draft' where id = p_design_id and status = 'archived';
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id)
  values (v_admin, 'design.restored', 'presentation_design', p_design_id::text);
end;
$$;

revoke all on function public.admin_save_design(text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text) from public, anon;
revoke all on function public.admin_save_design_font(uuid, text, text, text[], text, text, integer, boolean, text, integer, text) from public, anon;
revoke all on function public.admin_delete_design_font(uuid, text) from public, anon;
revoke all on function public.admin_publish_design(uuid) from public, anon;
revoke all on function public.admin_archive_design(uuid, text) from public, anon;
revoke all on function public.admin_restore_design(uuid) from public, anon;

grant execute on function public.admin_save_design(text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text) to authenticated;
grant execute on function public.admin_save_design_font(uuid, text, text, text[], text, text, integer, boolean, text, integer, text) to authenticated;
grant execute on function public.admin_delete_design_font(uuid, text) to authenticated;
grant execute on function public.admin_publish_design(uuid) to authenticated;
grant execute on function public.admin_archive_design(uuid, text) to authenticated;
grant execute on function public.admin_restore_design(uuid) to authenticated;

comment on table public.presentation_designs is
  'JSLAYD 1.0 design registry. `compiled_config` is the single source of truth every renderer reads; `source_prompt` is what the admin edits.';
comment on table public.presentation_design_versions is
  'One row per publish. Decks pin to a version so a design edit can never change a deck that already shipped.';

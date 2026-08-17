-- JElement 1.0 — the reusable visual object library.
--
-- JSLAYD says where a picture goes on a slide. JElement says what the picture
-- is. Two systems, one seam: a design declares a visual slot and an element
-- fills it. Nothing here touches `presentation_designs` — a published design
-- keeps working exactly as it does today.
--
-- The shape follows the design registry deliberately, because the problems are
-- the same ones: an admin publishes, a phone reads, and a deck that was
-- exported last month must still render after the library moves on. So the
-- conventions are the design registry's — a status enum, a versions table, a
-- pinned `published_version`, RLS split by role, and writes only through
-- definer RPCs.

create type public.jelement_status as enum ('draft', 'published', 'archived');

/**
 * A family: one visual language, many objects.
 *
 * The family carries HOW IT LOOKS — the material, the lighting, the colour
 * roles — and its elements carry WHAT THEY ARE. That split is the whole reason
 * the library is searchable: an excavator stays findable as "excavator" when
 * the same object exists in three different visual styles.
 */
create table public.jelement_families (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default '',
  subcategory text not null default '',
  style text not null default '',
  description text not null default '',
  status public.jelement_status not null default 'draft',
  format_version text not null default '1.0',

  -- The shared visual language. Never searched — searching it is what makes a
  -- library where "excavator" only works if you also say "graphite".
  visual_dna jsonb not null default '{}'::jsonb,

  /**
   * The colour roles every element binds to, resolved to concrete values.
   *
   * Changing one entry here recolours every child that bound to it. That is
   * only possible because no element is permitted to write a hex onto a shape
   * — the compiler refuses one — so this is the single place a family's colour
   * actually lives.
   */
  color_tokens jsonb not null default '{}'::jsonb,

  search_metadata jsonb not null default '{}'::jsonb,
  thumbnail_path text,
  source_prompt text not null default '',
  content_hash text,
  published_version integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,

  constraint jelement_families_slug_format
    check (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(slug) between 3 and 64),
  constraint jelement_families_name_length check (length(name) between 2 and 120),
  -- A family may only claim to be published once it carries the colours its
  -- elements bind to. Publishing without them ships objects that render as
  -- holes.
  constraint jelement_families_published_needs_tokens
    check (status <> 'published' or color_tokens <> '{}'::jsonb)
);

/**
 * One object.
 *
 * `canonical_name` is the identity and is unique inside its family: two
 * elements answering to one name make a query that matches both and resolves to
 * neither.
 */
create table public.jelements (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.jelement_families(id) on delete cascade,
  position integer not null default 0,
  canonical_name text not null,
  display_name text not null default '',
  object_class text not null default 'other',
  category text not null default '',
  subcategory text not null default '',
  status public.jelement_status not null default 'draft',

  -- What a search reads. No colours, no style words — see the family.
  semantic jsonb not null default '{}'::jsonb,

  /**
   * Geometry in normalised 0–1 space, with three kinds of bounds.
   *
   * `bounds` is what the maths says, `visualBounds` is where the mass reads and
   * `safeBounds` is what must not be cropped. A pickaxe on a diagonal has a
   * large rectangle and a small perceived centre; placing by the rectangle is
   * what puts it visibly off-centre.
   */
  geometry jsonb not null default '{}'::jsonb,
  appearance jsonb not null default '{}'::jsonb,
  usage_rules jsonb not null default '{}'::jsonb,
  transform_rules jsonb not null default '{}'::jsonb,

  /**
   * The deterministic drawing, when there is one.
   *
   * A textual description cannot reproduce a complex object faithfully, and
   * pretending otherwise fills a library with things nobody can draw. So an
   * element ships either as geometry a renderer can execute or as an asset —
   * and `render_spec` is where the first lives, `asset_path` the second.
   */
  render_spec jsonb,
  asset_path text,
  thumbnail_path text,

  published_version integer not null default 0,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,

  unique (family_id, canonical_name),
  constraint jelements_name_length check (length(canonical_name) between 2 and 120),
  constraint jelements_has_something_to_draw
    check (status <> 'published' or render_spec is not null or asset_path is not null)
);

create index jelements_family_idx on public.jelements(family_id, position);
create index jelements_status_idx on public.jelements(status) where status = 'published';

/**
 * Every way somebody might name an object.
 *
 * A separate table rather than an array inside `semantic`, because this is what
 * search actually probes and an index on a column beats a scan through jsonb.
 * `normalized` is the form the query is compared against — apostrophes folded,
 * case dropped — so a person typing `oʻchoq` finds what somebody stored as
 * `o'choq`.
 */
create table public.jelement_aliases (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.jelements(id) on delete cascade,
  language text not null default 'uz',
  alias text not null,
  normalized text not null,
  /** `canonical`, `alias`, `concept`, `context` — what kind of match this is. */
  kind text not null default 'alias',
  constraint jelement_aliases_language check (language in ('uz', 'en', 'ru')),
  constraint jelement_aliases_kind check (kind in ('canonical', 'alias', 'concept', 'context', 'industry', 'action')),
  constraint jelement_aliases_length check (length(alias) between 1 and 80)
);

create index jelement_aliases_normalized_idx on public.jelement_aliases(normalized);
create index jelement_aliases_element_idx on public.jelement_aliases(element_id);
create index jelement_aliases_prefix_idx on public.jelement_aliases(normalized text_pattern_ops);

/**
 * What was published, kept.
 *
 * A deck records the element id *and* the version it was built against. An
 * admin improving an element must not silently redraw a presentation somebody
 * already exported — the same rule the design registry follows, and the reason
 * archiving never deletes.
 */
create table public.jelement_versions (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.jelements(id) on delete cascade,
  version integer not null,
  spec jsonb not null,
  content_hash text not null,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (element_id, version),
  constraint jelement_versions_positive check (version > 0)
);

/**
 * Where an element was used.
 *
 * Kept for ranking, not for reading somebody's deck: the row records which
 * element went onto which slide, and nothing about what the slide said.
 */
create table public.jelement_usage (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.jelements(id) on delete cascade,
  presentation_id uuid references public.presentations(id) on delete set null,
  slide_id uuid references public.slides(id) on delete set null,
  /** The query that found it, so ranking can be improved from real use. */
  query text,
  slide_role text,
  created_at timestamptz not null default now()
);

create index jelement_usage_element_idx on public.jelement_usage(element_id, created_at desc);

-- ------------------------------------------------------------------- RLS --

alter table public.jelement_families enable row level security;
alter table public.jelements enable row level security;
alter table public.jelement_aliases enable row level security;
alter table public.jelement_versions enable row level security;
alter table public.jelement_usage enable row level security;

/**
 * Split by role, not merged with an `or`.
 *
 * `is_admin()` has no EXECUTE for `anon`, and Postgres checks a policy
 * expression's ACL when it initialises — so `published or is_admin()` fails for
 * a signed-out reader rather than short-circuiting. This repo has been caught
 * by that once already.
 */
create policy jelement_families_public_read on public.jelement_families
  for select to anon using (status = 'published');
create policy jelement_families_read on public.jelement_families
  for select to authenticated
  using (status = 'published' or (select public.is_admin()));

create policy jelements_public_read on public.jelements
  for select to anon
  using (status = 'published' and exists (
    select 1 from public.jelement_families f
    where f.id = family_id and f.status = 'published'));
create policy jelements_read on public.jelements
  for select to authenticated
  using (
    (select public.is_admin())
    or (status = 'published' and exists (
      select 1 from public.jelement_families f
      where f.id = family_id and f.status = 'published'))
  );

create policy jelement_aliases_public_read on public.jelement_aliases
  for select to anon
  using (exists (
    select 1 from public.jelements e
    where e.id = element_id and e.status = 'published'));
create policy jelement_aliases_read on public.jelement_aliases
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.jelements e where e.id = element_id and e.status = 'published')
  );

-- A version is readable by anyone, always: an archived element still has to
-- render inside the decks that already use it.
create policy jelement_versions_read on public.jelement_versions
  for select to anon, authenticated using (true);

create policy jelement_usage_admin_read on public.jelement_usage
  for select to authenticated using ((select public.is_admin()));

/**
 * No client writes any of this, including admins.
 *
 * Every change goes through a definer RPC, so the library cannot be edited by
 * a request that merely carries an admin's token — the RPC is where the
 * validation and the audit entry live. A phone in particular has no business
 * mutating a global catalogue.
 */
revoke insert, update, delete on
  public.jelement_families, public.jelements, public.jelement_aliases,
  public.jelement_versions
  from anon, authenticated;

-- Usage is the exception: recording that an element was used is what the server
-- does on the caller's behalf, and only the server may do it.
revoke insert, update, delete on public.jelement_usage from anon, authenticated;
grant insert on public.jelement_usage to service_role;

/**
 * Reading is granted explicitly.
 *
 * A policy filters; a grant permits. Relying on the project's default
 * privileges for one and writing the other by hand is how a table ends up with
 * policies that describe access nobody actually has — which is exactly what
 * happened here first time round, and what the design registry avoids by
 * saying both out loud.
 */
grant select on
  public.jelement_families, public.jelements, public.jelement_aliases,
  public.jelement_versions
  to anon, authenticated;

grant select on public.jelement_usage to authenticated;
grant select, insert, update on
  public.jelement_families, public.jelements, public.jelement_aliases,
  public.jelement_versions, public.jelement_usage
  to service_role;

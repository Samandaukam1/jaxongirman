-- A design can arrive as a deck somebody already made.
--
-- Until now a JSLAYD design was written: an admin authored a prompt, the
-- compiler turned it into a document, and the document described archetypes.
-- That works and stays. What it cannot do is accept a template a designer
-- already built, and templates are built in PowerPoint.
--
-- A PPTX slide is an archetype in another notation. It has a canvas, text at
-- coordinates, shapes and pictures — the same things `JslaydDocument` already
-- holds. So a PPTX design becomes a JslaydDocument at import, stored in the
-- same `compiled_config` as everything else, and every reader downstream — the
-- budget engine, the layout planner, the renderers, the exporters — carries on
-- knowing nothing about where it came from.
--
-- Which is why this adds so little to the design table itself. What it does add
-- is the two things a template needs that a written design never did: what each
-- of its slides is *for*, and what subjects the family suits.

/* ------------------------------------------------------------ the source */

do $$
begin
  if not exists (select 1 from pg_type where typname = 'design_source') then
    -- `svg` is listed although nothing produces it yet. A design source is a
    -- notation, and leaving room for the next one costs a word here and an
    -- enum migration later.
    create type public.design_source as enum ('code', 'pptx', 'svg');
  end if;
end $$;

alter table public.presentation_designs
  add column if not exists design_source public.design_source not null default 'code';

comment on column public.presentation_designs.design_source is
  'The notation the design was authored in. All of them compile to the same JslaydDocument in `compiled_config`; nothing downstream branches on this.';

/* ---------------------------------------------------------- the keywords */

/**
 * What a design is for, scored.
 *
 * Objects rather than a text array, because the score is the point: a design
 * that is 100 for cardiology and 50 for technology must win a cardiology deck
 * by a wide margin and lose a technology one. A flat list of strings cannot say
 * that, and the selector would be reduced to counting matches.
 */
alter table public.presentation_designs
  add column if not exists keywords jsonb not null default '[]'::jsonb;

comment on column public.presentation_designs.keywords is
  'Up to ten {keyword, score} pairs, score 1-100, keywords drawn from `design_topics`. Publishing requires at least one.';

alter table public.presentation_designs drop constraint if exists presentation_designs_keywords_shape;
alter table public.presentation_designs add constraint presentation_designs_keywords_shape check (
  jsonb_typeof(keywords) = 'array' and jsonb_array_length(keywords) <= 10
);

/* ------------------------------------------------- what each slide is for */

/**
 * The job a slide does in a talk.
 *
 * A design family of twenty-five pages is not twenty-five interchangeable
 * layouts; it is an opening, a few ways of explaining something, a way of
 * comparing, a way of concluding, and a closing. A deck of ten needs one of
 * each kind in the right order, and picking the first ten pages gives you five
 * openings and no conclusion.
 *
 * The vocabulary is closed so a planner can reason about it. `welcome` and
 * `thanks` are separated from the rest because they are not content: one
 * carries the topic and the author, the other carries a sentence nobody needs
 * generated.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'slide_story_role') then
    create type public.slide_story_role as enum (
      'welcome', 'introduction', 'overview', 'key_concepts', 'importance',
      'types', 'structure', 'process', 'methods', 'analysis', 'challenges',
      'solutions', 'applications', 'examples', 'results', 'recommendations',
      'conclusion', 'thanks',
      -- Layout kinds, which describe how a page is built rather than what it
      -- says. A page can be both: a `comparison` that serves `types`.
      'agenda', 'timeline', 'comparison', 'big_number', 'quote',
      'case_study', 'data', 'chart', 'table', 'image_story', 'references'
    );
  end if;
end $$;

create table if not exists public.design_slide_profiles (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.presentation_designs(id) on delete cascade,
  /** Which version of the design this profile describes. */
  design_version integer not null default 1,
  /** The archetype id inside `compiled_config`. */
  archetype_id text not null,
  /** Where the page sat in the uploaded file, kept as a weak ordering signal. */
  source_index integer not null default 0,

  role public.slide_story_role not null,
  /** 1-18 by convention, 999 for a closing page. A suggestion, never a rule. */
  recommended_story_position integer not null default 50,
  alternative_roles public.slide_story_role[] not null default '{}',

  density text not null default 'medium',
  text_capacity text not null default 'medium',
  visual_weight text not null default 'medium',
  /** e.g. `left-title-right-chart`; two pages sharing one read as repetition. */
  layout_signature text not null default '',

  supports_image boolean not null default false,
  supports_chart boolean not null default false,
  supports_table boolean not null default false,
  supports_quote boolean not null default false,
  supports_stats boolean not null default false,

  /** True for a closing page, so nothing schedules it in the middle. */
  is_terminal boolean not null default false,

  created_at timestamptz not null default now(),
  unique (design_id, design_version, archetype_id)
);

create index if not exists design_slide_profiles_lookup
  on public.design_slide_profiles (design_id, design_version, role);

/* ---------------------------------------------------- the uploaded file */

/**
 * The template as it arrived, kept beside the design it produced.
 *
 * The hash is the identity. A file uploaded twice under two names is one
 * design, and checking by name would mean never finding out — `template.pptx`
 * and `template-final.pptx` are the same deck and nobody notices until the
 * catalogue holds both.
 */
create table if not exists public.design_source_assets (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references public.presentation_designs(id) on delete cascade,
  source public.design_source not null,
  content_hash text not null unique,
  storage_path text not null,
  original_filename text not null default '',
  slide_count integer not null default 0,
  text_node_count integer not null default 0,
  image_count integer not null default 0,
  byte_size bigint not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists design_source_assets_design_idx
  on public.design_source_assets (design_id);

/* -------------------------------------------------------- the font shelf */

/**
 * Typefaces, once each, for the whole library.
 *
 * `presentation_design_fonts` already stores faces with a checksum, but per
 * design — so ten designs using Inter store Inter ten times, and an eleventh
 * has no way to discover it is already there. The shelf is shared; a design
 * points at it.
 */
create table if not exists public.font_families (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  /** Lowercased, punctuation stripped: what two spellings are compared by. */
  normalized_name text not null unique,
  source text not null default 'upload',
  license_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.font_faces (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.font_families(id) on delete cascade,
  weight integer not null default 400,
  italic boolean not null default false,
  format text not null default 'ttf',
  storage_path text not null,
  content_hash text not null,
  byte_size bigint not null default 0,
  created_at timestamptz not null default now(),
  -- Two ways to be the same face: the same bytes, or the same slot in the
  -- family. Both are refused, because both would be a second copy.
  unique (content_hash),
  unique (family_id, weight, italic)
);

create index if not exists font_faces_family_idx on public.font_faces (family_id);

/** Which designs need a family, so nothing in use is deleted. */
create table if not exists public.design_font_usage (
  design_id uuid not null references public.presentation_designs(id) on delete cascade,
  family_id uuid not null references public.font_families(id) on delete cascade,
  /** The name as the template spelled it, when no face could be resolved. */
  requested_name text not null default '',
  resolved boolean not null default true,
  primary key (design_id, family_id)
);

/* ---------------------------------------------------------- the taxonomy */

/**
 * The subjects a design may claim, and a deck may ask for.
 *
 * Closed on purpose. A classifier free to invent labels writes "Tibbiyot",
 * "Meditsina" and "Sog'liqni saqlash" for one idea, and a selector comparing
 * free text is comparing spelling. Both sides pick from this list, so a match
 * is a match rather than a guess.
 */
create table if not exists public.design_topics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label_uz text not null,
  family text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

/** The other names one subject answers to, in every language it arrives in. */
create table if not exists public.design_topic_synonyms (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.design_topics(id) on delete cascade,
  term text not null,
  normalized text not null,
  unique (normalized)
);

create index if not exists design_topic_synonyms_topic_idx
  on public.design_topic_synonyms (topic_id);

/* ------------------------------------------------------------------ RLS */

alter table public.design_slide_profiles enable row level security;
alter table public.design_source_assets enable row level security;
alter table public.font_families enable row level security;
alter table public.font_faces enable row level security;
alter table public.design_font_usage enable row level security;
alter table public.design_topics enable row level security;
alter table public.design_topic_synonyms enable row level security;

-- Read by anything that plans or renders a deck, which includes a phone.
drop policy if exists design_slide_profiles_read on public.design_slide_profiles;
create policy design_slide_profiles_read on public.design_slide_profiles
  for select to authenticated using (true);

drop policy if exists font_families_read on public.font_families;
create policy font_families_read on public.font_families
  for select to authenticated using (true);

drop policy if exists font_faces_read on public.font_faces;
create policy font_faces_read on public.font_faces
  for select to authenticated using (true);

drop policy if exists design_font_usage_read on public.design_font_usage;
create policy design_font_usage_read on public.design_font_usage
  for select to authenticated using (true);

drop policy if exists design_topics_read on public.design_topics;
create policy design_topics_read on public.design_topics
  for select to authenticated using (true);

drop policy if exists design_topic_synonyms_read on public.design_topic_synonyms;
create policy design_topic_synonyms_read on public.design_topic_synonyms
  for select to authenticated using (true);

-- The uploaded file is the console's business and nobody else's: what a phone
-- renders is the compiled document, not the package it came from.
drop policy if exists design_source_assets_admin on public.design_source_assets;
create policy design_source_assets_admin on public.design_source_assets
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'design_slide_profiles', 'font_families', 'font_faces',
    'design_font_usage', 'design_topics', 'design_topic_synonyms'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin', t);
  end loop;
end $$;

grant select on public.design_slide_profiles, public.design_source_assets,
  public.font_families, public.font_faces, public.design_font_usage,
  public.design_topics, public.design_topic_synonyms to authenticated;
grant insert, update, delete on public.design_slide_profiles, public.design_source_assets,
  public.font_families, public.font_faces, public.design_font_usage,
  public.design_topics, public.design_topic_synonyms to authenticated;

/* -------------------------------------------------------------- storage */

/**
 * Where uploaded templates live. Private: the package is an authoring
 * artefact, and a design's readers need the compiled document instead.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('design-source', 'design-source', false, 52428800, array[
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/svg+xml', 'application/zip'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists design_source_admin on storage.objects;
create policy design_source_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'design-source' and (select public.is_admin()))
  with check (bucket_id = 'design-source' and (select public.is_admin()));

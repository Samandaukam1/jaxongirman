import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildEdgeModules, repoRoot } from "./build-edge.mjs";

/**
 * Regenerates the slide-template migration from the TypeScript definitions in
 * `supabase/functions/_shared/templates/`. Those files are the authoring source
 * (type-checked, reviewable); this script projects them into SQL so the catalog
 * the app reads can never drift from the blueprints the pipeline renders.
 *
 *   node supabase/scripts/build-template-seed.mjs
 */

const dir = buildEdgeModules();
const { slideTemplates, retiredTemplateCodes } = await import(`${dir}/templates/index.js`);
const { paletteFamilies } = await import(`${dir}/palettes.js`);
const { renderPreview } = await import(`${dir}/template-engine.js`);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;

const paletteRows = paletteFamilies.map((family) =>
  `  (${quote(family.code)}, ${quote(family.name)}, ${family.sortOrder}, ${json(family.tokens)})`,
).join(",\n");

const templateRows = slideTemplates.map((template) => {
  const preview = renderPreview(template);
  return `  (${quote(template.code)}, ${quote(template.style)}, ${quote(template.name)}, ${quote(template.tagline)}, ${template.sortOrder}, ${json(template.artDirection)}, ${json(preview)})`;
}).join(",\n");

/**
 * Withdrawing a design is a deactivation, not a delete.
 *
 * The upsert above only ever marks what it emits active, so a design dropped
 * from the TypeScript source would keep its old row and stay in the picker.
 * Deactivating by name is what actually removes it. The row survives because
 * presentations generated while it was live still reference the code, and a
 * foreign key with history behind it is not something to break for tidiness.
 */
const retiredSql = retiredTemplateCodes.length === 0 ? "" : `
update public.slide_templates set is_active = false, updated_at = now()
  where code in (${retiredTemplateCodes.map(quote).join(", ")});
`;

/** The idempotent upserts, shared by the base migration and catalogue refreshes. */
const catalogueSql = `insert into public.palette_families (code, name, sort_order, tokens) values
${paletteRows}
on conflict (code) do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  tokens = excluded.tokens,
  is_active = true,
  updated_at = now();

insert into public.slide_templates (code, style, name, tagline, sort_order, art_direction, preview) values
${templateRows}
on conflict (code) do update set
  style = excluded.style,
  name = excluded.name,
  tagline = excluded.tagline,
  sort_order = excluded.sort_order,
  art_direction = excluded.art_direction,
  preview = excluded.preview,
  is_active = true,
  updated_at = now();
${retiredSql}`;

const sql = `-- GENERATED FILE — do not edit by hand.
-- Source: supabase/functions/_shared/templates/*.ts and palettes.ts
-- Regenerate with: node supabase/scripts/build-template-seed.mjs
--
-- Adds the design-template catalogue: six palette families and sixteen named
-- slide templates (four per presentation style). The pipeline renders decks from
-- the blueprint code; these rows are the catalogue the apps read and the choice
-- recorded against each presentation.

-- Decorative shapes deliberately bleed past the slide edge (cropped circles are
-- a core motif), so element geometry must allow negative offsets. The canvas
-- clips them on render. A generous bound still rejects nonsense coordinates.
alter table public.slide_elements drop constraint if exists slide_elements_geometry;
alter table public.slide_elements add constraint slide_elements_geometry
  check (width > 0 and height > 0 and x between -2000 and 3000 and y between -2000 and 3000);

create table if not exists public.palette_families (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  tokens jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint palette_families_code_format check (code ~ '^[a-z0-9_]{3,40}$')
);

create table if not exists public.slide_templates (
  code text primary key,
  style public.presentation_style not null,
  name text not null,
  tagline text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  art_direction jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slide_templates_code_format check (code ~ '^[a-z0-9_]{3,40}$')
);

create index if not exists slide_templates_style_order_idx on public.slide_templates(style, sort_order);

alter table public.presentations
  add column if not exists template_code text references public.slide_templates(code) on delete restrict,
  add column if not exists palette_code text references public.palette_families(code) on delete restrict;

${catalogueSql}
-- Existing presentations keep working: backfill the first template of their style.
update public.presentations p
set template_code = (
      select t.code from public.slide_templates t
      where t.style = p.style order by t.sort_order limit 1
    ),
    palette_code = 'limon_tun'
where p.template_code is null;

alter table public.palette_families enable row level security;
alter table public.slide_templates enable row level security;

-- Clients see the active catalogue; admins additionally see retired entries.
drop policy if exists palette_families_read on public.palette_families;
create policy palette_families_read on public.palette_families
  for select to anon, authenticated using (is_active or public.is_admin());

drop policy if exists slide_templates_read on public.slide_templates;
create policy slide_templates_read on public.slide_templates
  for select to anon, authenticated using (is_active or public.is_admin());

grant select on public.palette_families, public.slide_templates to anon, authenticated;

-- start_generation now records the chosen design. The previous nine-argument
-- overload is dropped so PostgREST cannot resolve to a version that skips the
-- template columns. Unknown or missing codes still fall back to the style's
-- first template and the default palette.
drop function if exists public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text);

create or replace function public.start_generation(
  p_presentation_id uuid,
  p_topic text,
  p_title text,
  p_style public.presentation_style,
  p_slide_count integer,
  p_author_name text default null,
  p_teacher_name text default null,
  p_sources text[] default '{}'::text[],
  p_idempotency_key text default null,
  p_template_code text default null,
  p_palette_code text default null
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
  v_template text;
  v_palette text;
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

  select code into v_template from public.slide_templates
  where code = p_template_code and style = p_style and is_active;
  if v_template is null then
    select code into v_template from public.slide_templates
    where style = p_style and is_active order by sort_order limit 1;
  end if;
  if v_template is null then
    raise exception 'no active template for style %', p_style using errcode = '22023';
  end if;

  select code into v_palette from public.palette_families where code = p_palette_code and is_active;
  if v_palette is null then
    select code into v_palette from public.palette_families where is_active order by sort_order limit 1;
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
    author_name, teacher_name, estimated_credits, reserved_credits,
    template_code, palette_code
  ) values (
    p_presentation_id, v_user_id,
    left(coalesce(nullif(btrim(p_title), ''), btrim(p_topic)), 180),
    left(btrim(p_topic), 2000), p_style, 'queued', p_slide_count,
    nullif(left(btrim(coalesce(p_author_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_teacher_name, '')), 120), ''),
    v_estimate, v_estimate,
    v_template, v_palette
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
    jsonb_build_object('presentation_id', p_presentation_id, 'style', p_style, 'slide_count', p_slide_count, 'template', v_template, 'palette', v_palette)
  );

  return query select p_presentation_id, v_job_id, v_estimate;
end;
$$;

grant execute on function public.start_generation(uuid, text, text, public.presentation_style, integer, text, text, text[], text, text, text) to authenticated;
`;

const migrations = path.join(repoRoot, "supabase", "migrations");
const target = path.join(migrations, "202608070005_slide_templates.sql");
writeFileSync(target, sql);
console.log(`✓ ${path.relative(repoRoot, target)} — ${paletteFamilies.length} palitra, ${slideTemplates.length} shablon`);

/**
 * The base migration above only runs on fresh databases. Environments that
 * already have it need the catalogue re-applied, so pass a name to emit a
 * standalone, idempotent refresh migration:
 *
 *   node supabase/scripts/build-template-seed.mjs --catalogue 202608080001_klassik
 */
const flag = process.argv.indexOf("--catalogue");
if (flag !== -1) {
  const name = process.argv[flag + 1];
  if (!name || !/^\d{12}_[a-z0-9_]+$/.test(name)) {
    console.error("--catalogue nomi '<12 raqam>_<nom>' ko'rinishida bo'lishi kerak");
    process.exit(1);
  }
  const cataloguePath = path.join(migrations, `${name}.sql`);
  writeFileSync(cataloguePath, `-- GENERATED FILE — do not edit by hand.\n-- Regenerate with: node supabase/scripts/build-template-seed.mjs --catalogue ${name}\n-- Idempotent refresh of the design catalogue for databases that already ran\n-- 202608070005_slide_templates.sql.\n\n${catalogueSql}`);
  console.log(`✓ ${path.relative(repoRoot, cataloguePath)} — katalog yangilanishi`);
}

/**
 * Telling the two kinds of design apart in the catalogue listing.
 *
 * A design written as a prompt and a design imported from PowerPoint are the
 * same row and two entirely different objects: one is compiled and drawn, the
 * other is a package that gets cloned. The console now shows them in separate
 * sections — PPTX templates have their own screen, and the JSLAYD screen is for
 * written designs only — and neither list could be built, because the listing
 * function never returned the column that says which is which.
 *
 * The return type changes, so the function is dropped rather than replaced.
 * Nothing else about it moves.
 */

drop function if exists public.admin_list_designs(
  public.jslayd_design_status, public.presentation_style, text, integer, integer);

create or replace function public.admin_list_designs(
  p_status public.jslayd_design_status default null,
  p_tier public.presentation_style default null,
  p_query text default null,
  p_limit integer default 100,
  p_offset integer default 0,
  p_source public.design_source default null
)
returns table (
  id uuid,
  slug text,
  name text,
  tier public.presentation_style,
  status public.jslayd_design_status,
  description text,
  is_premium boolean,
  is_featured boolean,
  sort_order integer,
  thumbnail_path text,
  health_score integer,
  published_version integer,
  archetype_count integer,
  font_count integer,
  used_by integer,
  created_at timestamptz,
  updated_at timestamptz,
  published_at timestamptz,
  design_source public.design_source,
  source_asset_path text,
  keywords jsonb,
  page_count integer
)
language sql
security definer
set search_path = ''
as $$
  select
    design.id, design.slug, design.name, design.tier, design.status, design.description,
    design.is_premium, design.is_featured, design.sort_order, design.thumbnail_path,
    design.health_score, design.published_version,
    coalesce(jsonb_array_length(design.compiled_config->'archetypes'), 0)::integer,
    (select count(*)::integer from public.presentation_design_fonts font where font.design_id = design.id),
    (select count(*)::integer from public.presentations deck where deck.design_id = design.id),
    design.created_at, design.updated_at, design.published_at,
    design.design_source, design.source_asset_path, design.keywords,
    -- How many source slides this design carries, which is the number that
    -- matters for a template and is meaningless for a written design.
    (select count(*)::integer
       from public.design_slide_profiles profile
      where profile.design_id = design.id
        and profile.design_version = greatest(design.published_version, 1))
  from public.presentation_designs design
  where public.is_admin()
    and (p_status is null or design.status = p_status)
    and (p_tier is null or design.tier = p_tier)
    and (p_source is null or design.design_source = p_source)
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or design.name ilike '%' || btrim(p_query) || '%'
      or design.slug ilike '%' || btrim(p_query) || '%'
    )
  order by design.tier, design.sort_order, design.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_designs(
  public.jslayd_design_status, public.presentation_style, text, integer, integer, public.design_source)
  from public, anon;
grant execute on function public.admin_list_designs(
  public.jslayd_design_status, public.presentation_style, text, integer, integer, public.design_source)
  to authenticated;

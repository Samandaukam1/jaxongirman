/**
 * Publishing a template a second time kept its pages at version one.
 *
 * `design_slide_profiles` is keyed by `(design_id, design_version)` and the
 * importer writes version 1. `admin_publish_design` mints version 2 on the
 * second publish and copied nothing, so the generator — which reads profiles
 * for the version a deck is pinned to — found none.
 *
 * A design with no page profiles is a design the generator treats as written
 * rather than imported: it would choose archetypes by shape, draw the deck, and
 * the export would then refuse it because a PPTX design is never drawn. So the
 * second publish of a template quietly turned it into a design that could
 * generate but not export.
 *
 * Nothing here published one yet, which is why it had not been seen. The pages
 * are now carried forward with the version, and the guard added alongside this
 * checks the version being published — which exists by the time it runs,
 * because the copy happens before the status changes.
 */

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

  /**
   * The pages, carried to the version being published.
   *
   * Copied from whichever version most recently has them, so a design
   * published four times still knows what its pages are for and which source
   * slide each one clones. Written before the status changes, because the
   * publish guard reads them.
   */
  insert into public.design_slide_profiles (
    design_id, design_version, archetype_id, source_index, role, alternative_roles,
    recommended_story_position, density, text_capacity, visual_weight, layout_signature,
    supports_image, supports_chart, supports_table, supports_quote, supports_stats,
    is_terminal, source_slide_part, text_map
  )
  select
    profile.design_id, v_version, profile.archetype_id, profile.source_index, profile.role,
    profile.alternative_roles, profile.recommended_story_position, profile.density,
    profile.text_capacity, profile.visual_weight, profile.layout_signature,
    profile.supports_image, profile.supports_chart, profile.supports_table,
    profile.supports_quote, profile.supports_stats, profile.is_terminal,
    profile.source_slide_part, profile.text_map
  from public.design_slide_profiles profile
  where profile.design_id = p_design_id
    and profile.design_version = (
      select max(other.design_version)
      from public.design_slide_profiles other
      where other.design_id = p_design_id and other.design_version <= v_version
    )
  on conflict (design_id, design_version, archetype_id) do update set
    source_index = excluded.source_index,
    role = excluded.role,
    alternative_roles = excluded.alternative_roles,
    recommended_story_position = excluded.recommended_story_position,
    density = excluded.density,
    text_capacity = excluded.text_capacity,
    visual_weight = excluded.visual_weight,
    layout_signature = excluded.layout_signature,
    supports_image = excluded.supports_image,
    supports_chart = excluded.supports_chart,
    supports_table = excluded.supports_table,
    supports_quote = excluded.supports_quote,
    supports_stats = excluded.supports_stats,
    is_terminal = excluded.is_terminal,
    source_slide_part = excluded.source_slide_part,
    text_map = excluded.text_map;

  update public.presentation_designs
  set status = 'published', published_version = v_version, published_at = now()
  where id = p_design_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'design.published', 'presentation_design', p_design_id::text,
    jsonb_build_object('version', v_version, 'content_hash', v_design.content_hash));

  return v_version;
end;
$$;

revoke all on function public.admin_publish_design(uuid) from public, anon;
grant execute on function public.admin_publish_design(uuid) to authenticated;

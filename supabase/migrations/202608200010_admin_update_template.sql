/**
 * Editing an imported PowerPoint template.
 *
 * A written design is edited by editing its prompt: the document is the design,
 * so the workbench compiles it and everything follows. A template has no prompt
 * and its document is not authored — it was read out of a file, and rewriting
 * it by hand would mean the design no longer describes the package it clones.
 *
 * So there are exactly three things about a template worth changing after
 * import, and this changes those and nothing else:
 *
 *  - what it is called, which tier it belongs to, whether it is premium;
 *  - which subjects it suits and how well, because that is what the phone
 *    compares a deck's topic against;
 *  - what each of its pages is for, because that is what decides which source
 *    slides a deck is built from.
 *
 * `compiled_config`, `source_asset_path` and the page-to-slide links are not
 * reachable from here. Changing a template's geometry means importing the file
 * again, which is the honest operation for it.
 *
 * Roles are written to every version of the design rather than to one. A role
 * is a statement about the page, not about a release, and an admin correcting
 * "this is a conclusion, not an introduction" means it about the page. Decks
 * already generated are rows and are untouched either way.
 */

create or replace function public.admin_update_template(
  p_design_id uuid,
  p_name text default null,
  p_tier public.presentation_style default null,
  p_description text default null,
  p_is_premium boolean default null,
  p_keywords jsonb default null,
  p_pages jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_design public.presentation_designs;
  v_keywords jsonb;
  v_page jsonb;
  v_role text;
  v_position integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_design from public.presentation_designs where id = p_design_id for update;
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;
  if v_design.design_source <> 'pptx' then
    raise exception 'not_a_template' using errcode = '22023';
  end if;

  /**
   * The subjects, checked against the same closed list the importer uses.
   *
   * A keyword nobody recognises is a design that never matches anything, which
   * is a silent failure rather than a loud one — so an unknown slug is refused
   * here instead of being stored and wondered about later.
   */
  if p_keywords is not null then
    if jsonb_typeof(p_keywords) <> 'array' then
      raise exception 'keywords_not_an_array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_keywords) > 10 then
      raise exception 'too_many_keywords' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'keyword', entry->>'keyword',
             'score', least(100, greatest(0, coalesce((entry->>'score')::integer, 50)))
           )), '[]'::jsonb)
      into v_keywords
    from jsonb_array_elements(p_keywords) as entry
    where exists (select 1 from public.design_topics topic where topic.slug = entry->>'keyword');

    if jsonb_array_length(v_keywords) < jsonb_array_length(p_keywords) then
      raise exception 'unknown_topic' using errcode = '22023';
    end if;
  end if;

  update public.presentation_designs set
    name = coalesce(nullif(btrim(p_name), ''), name),
    tier = coalesce(p_tier, tier),
    description = coalesce(p_description, description),
    is_premium = coalesce(p_is_premium, is_premium),
    keywords = coalesce(v_keywords, keywords)
  where id = p_design_id;

  if p_pages is not null then
    if jsonb_typeof(p_pages) <> 'array' then
      raise exception 'pages_not_an_array' using errcode = '22023';
    end if;

    for v_page in select * from jsonb_array_elements(p_pages) loop
      v_role := v_page->>'role';
      -- The enum does the checking: a role outside it cannot be cast, and a
      -- list this function carried separately would be a second copy to keep in
      -- step with the type.
      if v_role is null or not exists (
        select 1 from unnest(enum_range(null::public.slide_story_role)) as known
        where known::text = v_role
      ) then
        raise exception 'unknown_role: %', coalesce(v_role, 'null') using errcode = '22023';
      end if;

      v_position := nullif(v_page->>'recommended_story_position', '')::integer;

      update public.design_slide_profiles set
        role = v_role::public.slide_story_role,
        recommended_story_position = case
          -- A closing page keeps its place at the end whatever is asked for.
          when is_terminal then recommended_story_position
          when v_position between 1 and 18 then v_position
          else recommended_story_position
        end
      where design_id = p_design_id
        and archetype_id = v_page->>'archetype_id';
    end loop;
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (
    v_admin, 'design.template_edited', 'presentation_design', p_design_id::text,
    jsonb_build_object('name', v_design.name, 'tier', v_design.tier, 'keywords', v_design.keywords),
    jsonb_build_object('name', p_name, 'tier', p_tier, 'keywords', v_keywords, 'pages', p_pages)
  );
end;
$$;

revoke all on function public.admin_update_template(
  uuid, text, public.presentation_style, text, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.admin_update_template(
  uuid, text, public.presentation_style, text, boolean, jsonb, jsonb) to authenticated;

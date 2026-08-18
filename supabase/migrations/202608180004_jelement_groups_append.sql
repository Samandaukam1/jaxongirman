-- A family grows, and it grows in sections.
--
-- Two limits showed up the moment the library held something real.
--
-- The first is that saving a family replaces it. `admin_save_jelement_family`
-- archives every element not in the document it was handed, which is right for
-- editing a specification and wrong for adding to one: a second sheet of twelve
-- would file the first twelve away. Appending needs its own call, and it needs
-- to leave everything it was not told about alone.
--
-- The second is that a hundred medical objects in one flat list is not a
-- library, it is a scroll. They divide the way the subject does — cardiology,
-- ENT, diagnostics — and both the console and the search should know it.
--
-- `jelements.subcategory` already exists and has been carrying an empty string
-- since the table was created. That is exactly this idea, so it is used rather
-- than joined by a new column beside it.

comment on column public.jelements.subcategory is
  'The section within the family — kardiologiya, LOR, diagnostika. Grouped by in the console and matched by search.';

create index if not exists jelements_subcategory_idx
  on public.jelements (family_id, subcategory)
  where subcategory <> '';

/**
 * Adds elements to a family without disturbing the ones already there.
 *
 * The same upsert as the full save — an element returning under a name it
 * already has is an edit, not a duplicate — but with two differences that are
 * the whole point: positions continue from the end rather than restarting at
 * zero, and nothing is archived for being absent.
 *
 * Deliberately not a flag on the existing function. "Replace" and "append" are
 * opposite answers to what an unmentioned element means, and a boolean that
 * silently decides whether somebody's twelve elements survive is the kind of
 * parameter that gets passed wrongly once.
 */
create or replace function public.admin_append_jelement_family(
  p_family_id uuid,
  p_spec jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_element jsonb;
  v_element_id uuid;
  v_position integer;
  v_added integer := 0;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.jelement_families where id = p_family_id) then
    raise exception 'family not found' using errcode = 'P0002';
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.jelements where family_id = p_family_id;

  for v_element in select * from jsonb_array_elements(coalesce(p_spec -> 'elements', '[]'::jsonb))
  loop
    insert into public.jelements (
      family_id, position, canonical_name, display_name, object_class,
      category, subcategory, semantic, geometry, appearance, usage_rules,
      transform_rules, render_spec
    ) values (
      p_family_id, v_position,
      v_element ->> 'canonicalName',
      coalesce(v_element ->> 'displayName', v_element ->> 'canonicalName'),
      coalesce(v_element ->> 'objectClass', 'other'),
      coalesce(v_element ->> 'category', ''),
      coalesce(v_element ->> 'subcategory', ''),
      coalesce(v_element -> 'semantic', '{}'::jsonb),
      coalesce(v_element -> 'geometry', '{}'::jsonb),
      coalesce(v_element -> 'appearance', '{}'::jsonb),
      coalesce(v_element -> 'usage', '{}'::jsonb),
      coalesce(v_element -> 'transform', '{}'::jsonb),
      case when jsonb_array_length(coalesce(v_element -> 'geometry' -> 'components', '[]'::jsonb)) > 0
           then v_element -> 'geometry' else null end
    )
    on conflict (family_id, canonical_name) do update set
      display_name = excluded.display_name,
      object_class = excluded.object_class,
      category = excluded.category,
      subcategory = excluded.subcategory,
      semantic = excluded.semantic,
      appearance = excluded.appearance,
      usage_rules = excluded.usage_rules,
      transform_rules = excluded.transform_rules,
      -- Geometry and position are left as they are on an update. A returning
      -- element already has its picture and its place; re-sending the manifest
      -- to correct a name must not move it to the end or reset its aspect
      -- ratio to the manifest's placeholder.
      updated_at = now()
    returning id into v_element_id;

    perform public.jelement_reindex_aliases(v_element_id);
    v_position := v_position + 1;
    v_added := v_added + 1;
  end loop;

  update public.jelement_families set updated_at = now() where id = p_family_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'jelement_family_append', 'jelement_family', p_family_id,
          jsonb_build_object('added', v_added));

  return v_added;
end;
$$;

revoke all on function public.admin_append_jelement_family(uuid, jsonb) from public, anon;
grant execute on function public.admin_append_jelement_family(uuid, jsonb) to authenticated;

-- The section a query can name.
--
-- Rewritten rather than patched because the scoring lives in one expression and
-- splitting it across migrations would mean reading two files to know what a
-- score means. Only the two blocks marked below are new.

create or replace function public.jelement_search(
  p_query text,
  p_slide_role text default null,
  p_limit integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needle text := public.jelement_normalize(p_query);
  v_words text[];
begin
  if v_needle = '' then return '[]'::jsonb; end if;
  v_words := string_to_array(v_needle, ' ');

  return coalesce((
    select jsonb_agg(row order by row.score desc, row.usage_count desc, row.canonical_name)
    from (
      select
        e.id,
        e.canonical_name,
        e.display_name,
        e.object_class,
        f.id as family_id,
        f.slug as family_slug,
        f.name as family_name,
        f.style as family_style,
        e.subcategory,
        e.published_version,
        e.usage_count,
        e.thumbnail_path,
        -- Only what a planner needs to choose. The geometry is fetched after a
        -- choice is made, not before — a shortlist of render specs would be
        -- most of the library.
        e.usage_rules -> 'slideRoles' as slide_roles,
        e.usage_rules -> 'visualWeight' as visual_weight,
        (
          -- The query is the name.
          case when public.jelement_normalize(e.canonical_name) = v_needle then 100 else 0 end
          -- The query begins the name, or the name begins the query.
          + case when public.jelement_normalize(e.canonical_name) like v_needle || '%'
                   or v_needle like public.jelement_normalize(e.canonical_name) || '%' then 45 else 0 end
          + coalesce((
              select max(
                case a.kind
                  when 'canonical' then 60
                  when 'alias' then 40
                  when 'concept' then 22
                  when 'context' then 18
                  when 'industry' then 12
                  else 8
                end
                -- A whole-term match counts fully; a term that merely contains
                -- one of the query's words counts for less.
                * case when a.normalized = v_needle then 1.0
                       when a.normalized like v_needle || '%' then 0.8
                       when v_needle like '%' || a.normalized || '%' then 0.6
                       else 0.35 end)
              from public.jelement_aliases a
              where a.element_id = e.id
                and (a.normalized = v_needle
                     or a.normalized like v_needle || '%'
                     or v_needle like '%' || a.normalized || '%'
                     or a.normalized = any (v_words))
            ), 0)
          -- The family answers the query even when no single element does:
          -- "mining" should surface a mining family's objects.
          + case when public.jelement_normalize(f.name) like '%' || v_needle || '%'
                   or public.jelement_normalize(coalesce(f.category, '')) = v_needle then 15 else 0 end
          -- The section answers too: "kardiologiya" should surface the heart
          -- and the monitor without either being called that. Weighted below a
          -- family match, because a section is narrower and a person naming one
          -- usually wants everything in it.
          + case when coalesce(e.subcategory, '') <> ''
                   and (public.jelement_normalize(e.subcategory) = v_needle
                        or public.jelement_normalize(e.subcategory) = any (v_words)
                        or v_needle like public.jelement_normalize(e.subcategory) || '%')
                 then 30 else 0 end
          -- Suited to the slide being planned.
          + case when p_slide_role is not null
                   and e.usage_rules -> 'slideRoles' ? p_slide_role then 12 else 0 end
          -- A tiebreak, capped so it can never outrank meaning.
          + least(e.usage_count::numeric / 25, 5)
        ) as score
      from public.jelements e
      join public.jelement_families f on f.id = e.family_id
      where e.status = 'published' and f.status = 'published'
    ) row
    where row.score > 10
    limit greatest(1, least(coalesce(p_limit, 8), 40))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.jelement_search(text, text, integer) from public, anon;
grant execute on function public.jelement_search(text, text, integer) to authenticated, service_role;

-- Finding an element.
--
-- The planner asks for "mining automation" and needs a handful of candidates
-- back, fast, without the whole library travelling to a model. So the search
-- runs here and returns a shortlist: a few hundred bytes per candidate rather
-- than a render specification each.
--
-- Ranking is layered, and the layers are ordered by how much they mean:
--
--   an exact canonical name          the query names the thing
--   a prefix of a canonical name     the query nearly names it
--   an alias                         somebody else's word for it
--   a concept or context             what it is used for
--   an industry                      the field it belongs to
--   slide-role fit                   whether it suits this slide
--   popularity                       a tiebreak, never a driver
--
-- Popularity is last and small on purpose. Letting use decide relevance is how
-- a library ends up returning the same six elements for every query, and the
-- seventh never gets used because it never gets shown.

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

/**
 * One element, in full, once something has chosen it.
 *
 * The two-step is the whole performance story: a search returns a few hundred
 * bytes per candidate, and only the chosen one costs a render specification.
 * A library of thousands stays usable on a phone because of this split.
 *
 * A pinned version is served exactly: a deck built against version 2 keeps
 * getting version 2 after version 3 is published.
 */
create or replace function public.jelement_resolve(p_element_id uuid, p_version integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_element public.jelements%rowtype;
  v_family public.jelement_families%rowtype;
  v_spec jsonb;
begin
  select * into v_element from public.jelements where id = p_element_id;
  if not found then return 'null'::jsonb; end if;
  select * into v_family from public.jelement_families where id = v_element.family_id;

  if p_version is not null then
    select spec into v_spec from public.jelement_versions
     where element_id = p_element_id and version = p_version;
    -- An archived element still resolves through its versions, which is the
    -- reason archiving never deletes.
    if v_spec is null then return 'null'::jsonb; end if;
  else
    if v_element.status <> 'published' or v_family.status <> 'published' then
      return 'null'::jsonb;
    end if;
    v_spec := to_jsonb(v_element);
  end if;

  return jsonb_build_object(
    'element', v_spec,
    'family', jsonb_build_object(
      'id', v_family.id, 'slug', v_family.slug, 'name', v_family.name,
      'colorTokens', v_family.color_tokens, 'visualDNA', v_family.visual_dna
    ),
    'version', coalesce(p_version, v_element.published_version)
  );
end;
$$;

/** Records that an element was used, for ranking. Never the slide's words. */
create or replace function public.jelement_record_usage(
  p_element_id uuid,
  p_presentation_id uuid default null,
  p_slide_id uuid default null,
  p_query text default null,
  p_slide_role text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.jelement_usage (element_id, presentation_id, slide_id, query, slide_role)
  values (p_element_id, p_presentation_id, p_slide_id, left(coalesce(p_query, ''), 200), p_slide_role);

  update public.jelements set usage_count = usage_count + 1 where id = p_element_id;
end;
$$;

/**
 * Searching needs an account.
 *
 * A signed-out caller has no presentation to put an element into, and the anon
 * surface in this project is deliberately a short list of pairing and
 * scan-landing entry points — a guard test enumerates it. Widening it for a
 * picker nobody signed out can use would trade a real boundary for nothing.
 */
revoke all on function public.jelement_search(text, text, integer) from public, anon;
revoke all on function public.jelement_resolve(uuid, integer) from public, anon;
revoke all on function public.jelement_record_usage(uuid, uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.jelement_search(text, text, integer) to authenticated, service_role;
grant execute on function public.jelement_resolve(uuid, integer) to authenticated, service_role;
grant execute on function public.jelement_record_usage(uuid, uuid, uuid, text, text) to service_role;

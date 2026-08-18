-- The picker shows the object.
--
-- `jelement_search` returned a name, a family and a thumbnail path that nothing
-- ever wrote to, so the phone drew the same grey glyph for every candidate —
-- and picking a mining excavator from twelve identical squares is guessing.
-- Now that an element carries its render, the shortlist carries it too.

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
        -- The picture itself, so a phone's picker can show the object rather
        -- than the same grey icon twelve times. The variants are not sent: a
        -- shortlist needs one image each, and the recolour is chosen when the
        -- element is actually placed.
        e.asset_path,
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

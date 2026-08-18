-- Deleting an element, and the family it belongs to.
--
-- Archiving already existed and is the right default: it keeps an element
-- resolvable for the decks that already carry it while taking it out of search.
-- But a library accumulates genuine mistakes — an import with the wrong grid, a
-- family of thirteen empty squares from a specification that lost its
-- indentation — and archiving those leaves them in the way forever.
--
-- What makes deletion safe here is that nothing else does. Every child table
-- already cascades from `jelements` and `jelement_families`, so the rows go
-- cleanly; what the database cannot know is whether somebody's slide is holding
-- a placement that points at this element. That is checked before anything is
-- removed, and it is checked against the slides themselves rather than against
-- `usage_count`, because a counter is a summary and a summary can be stale.
--
-- The storage objects are returned rather than deleted. SQL cannot remove a
-- file from a bucket, and pretending otherwise would leave the artwork orphaned
-- while the row that named it was gone.

/**
 * Whether any slide anywhere is still drawing this element.
 *
 * A placement lives in `slide_elements.content` as `{"jelement": {...}}`, put
 * there by the editor so any member row can rebuild the whole set. That is what
 * a deck actually depends on, so that is what is asked.
 */
create or replace function public.jelement_in_use(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.slide_elements
     where content -> 'jelement' ->> 'elementId' = p_element_id::text
  );
$$;

create or replace function public.admin_delete_jelement(p_element_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paths text[];
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select canonical_name,
         array_remove(
           array[asset_path] || coalesce(
             (select array_agg(value) from jsonb_each_text(asset_variants)), '{}'::text[]
           ),
           null
         )
    into v_name, v_paths
    from public.jelements
   where id = p_element_id;

  if v_name is null then
    raise exception 'element not found' using errcode = 'P0002';
  end if;

  if public.jelement_in_use(p_element_id) then
    -- Named, because "it is in use" is not something an admin can act on and
    -- "«Ochiq kitob» is on a slide" is.
    raise exception '«%» slaydlarda ishlatilyapti — o''chirish o''rniga arxivlang.', v_name
      using errcode = 'P0001';
  end if;

  delete from public.jelements where id = p_element_id;
  return coalesce(v_paths, '{}'::text[]);
end;
$$;

/**
 * The family, and everything in it.
 *
 * Refused wholesale rather than partially: deleting eleven of twelve elements
 * and stopping at the one on somebody's slide would leave a family that is
 * neither there nor gone.
 */
create or replace function public.admin_delete_jelement_family(p_family_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paths text[];
  v_name text;
  v_used text;
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select name into v_name from public.jelement_families where id = p_family_id;
  if v_name is null then
    raise exception 'family not found' using errcode = 'P0002';
  end if;

  select string_agg(canonical_name, ', ' order by position)
    into v_used
    from public.jelements
   where family_id = p_family_id
     and public.jelement_in_use(id);

  if v_used is not null then
    raise exception 'Bu elementlar slaydlarda ishlatilyapti: %. Oilani arxivlang.', v_used
      using errcode = 'P0001';
  end if;

  select array_remove(array_agg(path), null)
    into v_paths
    from public.jelements e,
         lateral (
           select unnest(
             array[e.asset_path] || coalesce(
               (select array_agg(value) from jsonb_each_text(e.asset_variants)), '{}'::text[]
             )
           ) as path
         ) paths
   where e.family_id = p_family_id;

  -- `jelements` cascades from the family, and `jelement_aliases`,
  -- `jelement_versions` and `jelement_usage` all cascade from those.
  delete from public.jelement_families where id = p_family_id;
  return coalesce(v_paths, '{}'::text[]);
end;
$$;

revoke all on function public.jelement_in_use(uuid) from public, anon;
revoke all on function public.admin_delete_jelement(uuid) from public, anon;
revoke all on function public.admin_delete_jelement_family(uuid) from public, anon;

grant execute on function public.jelement_in_use(uuid) to authenticated;
grant execute on function public.admin_delete_jelement(uuid) to authenticated;
grant execute on function public.admin_delete_jelement_family(uuid) to authenticated;

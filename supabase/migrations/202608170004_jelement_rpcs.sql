-- The only way anything writes to the JElement library.
--
-- No client holds INSERT or UPDATE on the tables, so these functions are where
-- validation, aliasing and the audit entry live. The shape follows
-- `admin_save_design` and `admin_publish_design` for the same reasons those
-- functions have it.

/**
 * Saves a compiled family and all of its elements, atomically.
 *
 * The whole family arrives at once because that is how it is produced: an
 * analyzer reads one reference sheet and returns one specification. Saving it
 * element by element would leave a half-imported family visible between calls.
 *
 * Elements absent from the payload are archived rather than deleted — a deck
 * may already use one, and a version it needs must survive its removal from the
 * catalogue (§22).
 */
create or replace function public.admin_save_jelement_family(
  p_family_id uuid,
  p_spec jsonb,
  p_source_prompt text default ''
)
returns public.jelement_families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_family public.jelement_families%rowtype;
  v_element jsonb;
  v_element_id uuid;
  v_position integer := 0;
  v_seen uuid[] := '{}';
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_spec, 'null'::jsonb)) <> 'object' then
    raise exception 'spec must be an object' using errcode = '22023';
  end if;
  if p_spec ->> 'format' <> 'JELEMENT' then
    raise exception 'not a JElement specification' using errcode = '22023';
  end if;

  if p_family_id is not null then
    select to_jsonb(row) into v_before from public.jelement_families row where row.id = p_family_id;
    if v_before is null then
      raise exception 'family_not_found' using errcode = '02000';
    end if;
  end if;

  insert into public.jelement_families (
    id, slug, name, category, subcategory, style, description,
    visual_dna, color_tokens, search_metadata, source_prompt,
    content_hash, created_by
  ) values (
    coalesce(p_family_id, gen_random_uuid()),
    p_spec -> 'family' ->> 'slug',
    p_spec -> 'family' ->> 'name',
    coalesce(p_spec -> 'family' ->> 'category', ''),
    coalesce(p_spec -> 'family' ->> 'subcategory', ''),
    coalesce(p_spec -> 'family' ->> 'style', ''),
    coalesce(p_spec -> 'family' ->> 'description', ''),
    coalesce(p_spec -> 'visualDNA', '{}'::jsonb),
    coalesce(p_spec -> 'colorTokens', '{}'::jsonb),
    coalesce(p_spec -> 'search', '{}'::jsonb),
    coalesce(p_source_prompt, ''),
    encode(extensions.digest(p_spec::text, 'sha256'), 'hex'),
    v_admin
  )
  on conflict (id) do update set
    slug = excluded.slug, name = excluded.name, category = excluded.category,
    subcategory = excluded.subcategory, style = excluded.style,
    description = excluded.description, visual_dna = excluded.visual_dna,
    color_tokens = excluded.color_tokens, search_metadata = excluded.search_metadata,
    source_prompt = excluded.source_prompt, content_hash = excluded.content_hash,
    updated_at = now()
  returning * into v_family;

  for v_element in select * from jsonb_array_elements(coalesce(p_spec -> 'elements', '[]'::jsonb))
  loop
    insert into public.jelements (
      family_id, position, canonical_name, display_name, object_class,
      category, subcategory, semantic, geometry, appearance, usage_rules,
      transform_rules, render_spec
    ) values (
      v_family.id, v_position,
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
      -- Geometry with components is something a renderer can execute, so it is
      -- the render spec. An element with none ships as an asset instead.
      case when jsonb_array_length(coalesce(v_element -> 'geometry' -> 'components', '[]'::jsonb)) > 0
           then v_element -> 'geometry' else null end
    )
    on conflict (family_id, canonical_name) do update set
      position = excluded.position, display_name = excluded.display_name,
      object_class = excluded.object_class, category = excluded.category,
      subcategory = excluded.subcategory, semantic = excluded.semantic,
      geometry = excluded.geometry, appearance = excluded.appearance,
      usage_rules = excluded.usage_rules, transform_rules = excluded.transform_rules,
      render_spec = excluded.render_spec, updated_at = now()
    returning id into v_element_id;

    v_seen := v_seen || v_element_id;
    perform public.jelement_reindex_aliases(v_element_id);
    v_position := v_position + 1;
  end loop;

  -- An element that vanished from the specification leaves the catalogue but
  -- keeps its rows: a deck that used it still needs the version it pinned.
  update public.jelements set status = 'archived', updated_at = now()
   where family_id = v_family.id
     and not (id = any (v_seen))
     and status <> 'archived';

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, case when v_before is null then 'jelement_family.created' else 'jelement_family.saved' end,
          'jelement_family', v_family.id::text, v_before, to_jsonb(v_family));

  return v_family;
end;
$$;

/**
 * Rebuilds one element's searchable terms.
 *
 * Every way somebody might name the object becomes a row, normalised the same
 * way a query will be. Kept as its own function because both saving and a later
 * alias edit need it, and because a search index rebuilt two different ways is
 * a search that answers differently depending on which path wrote it.
 */
create or replace function public.jelement_reindex_aliases(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_element public.jelements%rowtype;
  v_term text;
begin
  select * into v_element from public.jelements where id = p_element_id;
  if not found then return; end if;

  delete from public.jelement_aliases where element_id = p_element_id;

  insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
  values (p_element_id, 'en', v_element.canonical_name,
          public.jelement_normalize(v_element.canonical_name), 'canonical');

  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'aliases', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'en', v_term, public.jelement_normalize(v_term), 'alias')
    on conflict do nothing;
  end loop;

  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'uzbekTerms', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'uz', v_term, public.jelement_normalize(v_term), 'alias');
  end loop;

  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'russianTerms', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'ru', v_term, public.jelement_normalize(v_term), 'alias');
  end loop;

  -- Concepts and contexts are what let "mining automation" find an inspection
  -- drone nobody ever called an automation device. Scored lower than a name,
  -- but present.
  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'concepts', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'en', v_term, public.jelement_normalize(v_term), 'concept');
  end loop;

  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'contexts', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'en', v_term, public.jelement_normalize(v_term), 'context');
  end loop;

  for v_term in
    select jsonb_array_elements_text(coalesce(v_element.semantic -> 'industries', '[]'::jsonb))
  loop
    insert into public.jelement_aliases (element_id, language, alias, normalized, kind)
    values (p_element_id, 'en', v_term, public.jelement_normalize(v_term), 'industry');
  end loop;
end;
$$;

/**
 * The same normalisation the client uses, in the database.
 *
 * Uzbek is written with two different apostrophes depending on the keyboard.
 * `oʻchoq` and `o'choq` are the same word and a person typing one must find the
 * other, so both fold to one form before anything is compared.
 *
 * Deliberately no stemming and no fuzzy distance: "kon" must not match "konus",
 * because a search that returns a cone for a mine is worse than one that
 * returns nothing.
 */
create or replace function public.jelement_normalize(p_term text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p_term, '')), '[‘’ʻʼ`´]', '''', 'g'),
      '[^[:alnum:]''\- ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

/**
 * Publishes a family and every element in it.
 *
 * A family is published as a unit because an element is meaningless without the
 * colour roles its shapes bind to — publishing one without the other ships
 * objects that render as holes.
 *
 * Republishing an unchanged family is a no-op rather than a new version number:
 * a history full of identical entries is a history nobody can read.
 */
create or replace function public.admin_publish_jelement_family(p_family_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_family public.jelement_families%rowtype;
  v_version integer;
  v_element public.jelements%rowtype;
  v_hash text;
  v_existing integer;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_family from public.jelement_families where id = p_family_id for update;
  if not found then raise exception 'family_not_found' using errcode = 'P0002'; end if;
  if v_family.color_tokens = '{}'::jsonb then
    raise exception 'Oila rang rollarini belgilamagan — elementlar chizilmaydi.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jelements where family_id = p_family_id and status <> 'archived') then
    raise exception 'Oilada nashr qilinadigan element yo''q.' using errcode = '22023';
  end if;

  v_version := v_family.published_version + 1;

  for v_element in
    select * from public.jelements where family_id = p_family_id and status <> 'archived'
  loop
    if v_element.render_spec is null and v_element.asset_path is null then
      raise exception 'Element "%" chizilmaydi: geometriya ham, asset ham yo''q.', v_element.canonical_name
        using errcode = '22023';
    end if;

    v_hash := encode(extensions.digest(
      coalesce(v_element.render_spec, '{}'::jsonb)::text || coalesce(v_element.asset_path, ''), 'sha256'), 'hex');

    select version into v_existing from public.jelement_versions
     where element_id = v_element.id and content_hash = v_hash
     order by version desc limit 1;

    if v_existing is null then
      v_existing := v_element.published_version + 1;
      insert into public.jelement_versions (element_id, version, spec, content_hash, published_by)
      values (v_element.id, v_existing, to_jsonb(v_element), v_hash, v_admin);
    end if;

    update public.jelements
       set status = 'published', published_version = v_existing, published_at = now()
     where id = v_element.id;
  end loop;

  update public.jelement_families
     set status = 'published', published_version = v_version, published_at = now()
   where id = p_family_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, 'jelement_family.published', 'jelement_family', p_family_id::text,
          jsonb_build_object('version', v_version));

  return v_version;
end;
$$;

/**
 * Removes a family from search without breaking what already uses it.
 *
 * Archiving is not deletion and never becomes it: a presentation exported last
 * month pinned an element version, and that version has to keep resolving. The
 * catalogue stops offering it; the decks that have it keep it.
 */
create or replace function public.admin_archive_jelement_family(p_family_id uuid, p_restore boolean default false)
returns public.jelement_families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_family public.jelement_families%rowtype;
  v_status public.jelement_status := case when p_restore then 'draft' else 'archived' end;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.jelement_families set status = v_status, updated_at = now()
   where id = p_family_id returning * into v_family;
  if not found then raise exception 'family_not_found' using errcode = 'P0002'; end if;

  update public.jelements set status = v_status, updated_at = now()
   where family_id = p_family_id;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, after_data)
  values (v_admin, case when p_restore then 'jelement_family.restored' else 'jelement_family.archived' end,
          'jelement_family', p_family_id::text, to_jsonb(v_family));

  return v_family;
end;
$$;

/** The catalogue as the console lists it, with counts rather than every child. */
create or replace function public.admin_list_jelement_families()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(row order by row.updated_at desc)
    from (
      select f.id, f.slug, f.name, f.category, f.style, f.status,
             f.color_tokens, f.thumbnail_path, f.published_version, f.updated_at,
             count(e.id) filter (where e.status <> 'archived') as element_count,
             coalesce(sum(e.usage_count), 0) as usage_count
        from public.jelement_families f
        left join public.jelements e on e.family_id = f.id
       group by f.id
    ) row
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_save_jelement_family(uuid, jsonb, text) from public, anon;
revoke all on function public.admin_publish_jelement_family(uuid) from public, anon;
revoke all on function public.admin_archive_jelement_family(uuid, boolean) from public, anon;
revoke all on function public.admin_list_jelement_families() from public, anon;
revoke all on function public.jelement_reindex_aliases(uuid) from public, anon, authenticated;

grant execute on function public.admin_save_jelement_family(uuid, jsonb, text) to authenticated;
grant execute on function public.admin_publish_jelement_family(uuid) to authenticated;
grant execute on function public.admin_archive_jelement_family(uuid, boolean) to authenticated;
grant execute on function public.admin_list_jelement_families() to authenticated;
grant execute on function public.jelement_normalize(text) to authenticated, service_role;

-- A pinned version resolves with its picture.
--
-- Split from `202608180001` rather than appended to it. That migration had
-- already run against production by the time this was written, and a recorded
-- version is never re-applied — so editing it would have left the change in the
-- file, absent from the database, and invisible to anybody reading either.
--
-- On a fresh database the two run in order and converge on the same function.

/**
 * A pinned version still resolves with its picture.
 *
 * `jelement_resolve` returns the whole element row for a live lookup, so the
 * new columns arrive without it being touched. A pinned lookup returns the
 * frozen specification instead — and the artwork is not part of that. It is a
 * property of the element rather than of a revision of its description: the
 * picture is attached, replaced and re-cut long after the text was written.
 *
 * So the live asset columns are merged onto the snapshot. A deck pinned to v1
 * keeps v1's geometry and semantics and still shows the picture that element
 * has today, which is what somebody replacing a blurry render expects.
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
    v_spec := v_spec || jsonb_build_object(
      'asset_path', to_jsonb(v_element.asset_path),
      'asset_accent_hue', to_jsonb(v_element.asset_accent_hue),
      'asset_variants', coalesce(v_element.asset_variants, '{}'::jsonb)
    );
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

revoke all on function public.jelement_resolve(uuid, integer) from public, anon;
grant execute on function public.jelement_resolve(uuid, integer) to authenticated, service_role;

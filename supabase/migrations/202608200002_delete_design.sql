/**
 * Deleting a design, as opposed to withdrawing one.
 *
 * Archiving already exists and is the right answer almost always: a design a
 * deck was made with has to stay, because `presentations.design_id` is the only
 * record of what that deck was laid out by, and losing it turns a finished
 * presentation into one nobody can re-generate or re-style.
 *
 * What archiving is wrong for is the design that never became anything — a
 * draft, a template imported to see what it looked like, a duplicate made to
 * try a colour. Those accumulate in the catalogue and there is no honest reason
 * to keep them.
 *
 * So the rule is the one the data already implies: a design nothing points at
 * may be deleted, and a design something points at may not. The refusal says
 * how many decks are in the way, because "no" without a number is a dead end.
 *
 * The storage objects are returned rather than removed here. A function cannot
 * reach the bucket, and deleting the row first is the right order anyway: an
 * object with no row is litter, while a row pointing at a deleted object is a
 * design that renders a missing font.
 */
create or replace function public.admin_delete_design(p_design_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_design record;
  v_used integer;
  v_paths jsonb;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_design from public.presentation_designs where id = p_design_id for update;
  if not found then
    raise exception 'design_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_used from public.presentations where design_id = p_design_id;
  if v_used > 0 then
    raise exception 'Bu dizayn % ta taqdimotda ishlatilgan. O''chirish o''rniga arxivlang.', v_used
      using errcode = '22023', detail = 'design_in_use';
  end if;

  -- Everything the row owns outside the database, so the caller can sweep it.
  select jsonb_build_object(
    'fonts', coalesce((
      select jsonb_agg(asset_path)
      from public.presentation_design_fonts
      where design_id = p_design_id and asset_path is not null
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(storage_path)
      from public.design_source_assets
      where design_id = p_design_id and storage_path <> ''
    ), '[]'::jsonb)
  ) into v_paths;

  -- Written before the delete: after it there is no row to name, and an audit
  -- entry that cannot say what was removed is not an audit entry.
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data)
  values (
    v_admin, 'design.deleted', 'presentation_design', p_design_id::text,
    jsonb_build_object(
      'slug', v_design.slug,
      'name', v_design.name,
      'tier', v_design.tier,
      'status', v_design.status,
      'design_source', v_design.design_source,
      'assets', v_paths
    )
  );

  -- Profiles, versions, fonts and source assets all cascade from here.
  delete from public.presentation_designs where id = p_design_id;

  return v_paths;
end;
$$;

revoke all on function public.admin_delete_design(uuid) from public, anon;
grant execute on function public.admin_delete_design(uuid) to authenticated;

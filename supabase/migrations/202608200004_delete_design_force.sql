/**
 * Deleting a design a deck was made with.
 *
 * The first version refused outright: `presentations.design_id` is the only
 * record of what a deck was laid out by, so deleting the design erases that.
 * True — and a prohibition was the wrong shape for it.
 *
 * The foreign key is `set null` precisely because this is survivable. A
 * finished deck's slides are already rendered into rows; it keeps opening,
 * keeps exporting and keeps printing. What it loses is the ability to be
 * re-generated in that design, and the note saying which one it was.
 *
 * That is a warning, not a wall — and refusing outright meant a test deck made
 * to check an import permanently pinned the design it was testing. So the
 * refusal now stands only until somebody says they meant it, and the audit
 * entry records how many decks were affected.
 */
drop function if exists public.admin_delete_design(uuid);

create or replace function public.admin_delete_design(
  p_design_id uuid,
  p_force boolean default false
)
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

  -- Not a wall, but not a slip either: a caller that did not ask for this is
  -- told what it would cost rather than being allowed to find out.
  if v_used > 0 and not coalesce(p_force, false) then
    raise exception 'Bu dizayn % ta taqdimotda ishlatilgan.', v_used
      using errcode = '22023', detail = 'design_in_use';
  end if;

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

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data)
  values (
    v_admin, 'design.deleted', 'presentation_design', p_design_id::text,
    jsonb_build_object(
      'slug', v_design.slug,
      'name', v_design.name,
      'tier', v_design.tier,
      'status', v_design.status,
      'design_source', v_design.design_source,
      -- The number matters more here than anywhere else in this row: it is how
      -- many finished decks lost the record of what drew them.
      'presentations_unlinked', v_used,
      'assets', v_paths
    )
  );

  delete from public.presentation_designs where id = p_design_id;

  return v_paths;
end;
$$;

revoke all on function public.admin_delete_design(uuid, boolean) from public, anon;
grant execute on function public.admin_delete_design(uuid, boolean) to authenticated;

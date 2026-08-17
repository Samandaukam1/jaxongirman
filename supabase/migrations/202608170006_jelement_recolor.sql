-- Recolouring a family.
--
-- One row changes and every element follows, because no element ever wrote a
-- colour down — they bind to roles, and this is where a role's value lives.
-- That is the entire contract the compiler enforces by refusing a literal hex
-- on a shape, and this function is what makes the contract worth having.
--
-- Deliberately separate from `admin_save_jelement_family`: changing a palette
-- is a different act from re-importing a specification, and routing it through
-- the importer would mean an admin adjusting an accent had to hold the whole
-- specification to do it.

create or replace function public.admin_recolor_jelement_family(
  p_family_id uuid,
  p_color_tokens jsonb
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
  v_role text;
  v_value text;
begin
  if not public.is_admin(v_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_color_tokens, 'null'::jsonb)) <> 'object' then
    raise exception 'color tokens must be an object' using errcode = '22023';
  end if;
  if p_color_tokens = '{}'::jsonb then
    raise exception 'Rang rollari bo''sh bo''lishi mumkin emas.' using errcode = '22023';
  end if;

  -- Every value is a colour, checked here rather than trusted: a malformed one
  -- reaches every element bound to that role at once, and the failure would
  -- look like the elements were broken rather than the palette.
  for v_role, v_value in select key, value #>> '{}' from jsonb_each(p_color_tokens)
  loop
    if v_value !~* '^#[0-9a-f]{6}$' then
      raise exception '«%» roli uchun «%» HEX rang emas.', v_role, v_value using errcode = '22023';
    end if;
  end loop;

  select to_jsonb(row) into v_before from public.jelement_families row where row.id = p_family_id;
  if v_before is null then
    raise exception 'family_not_found' using errcode = 'P0002';
  end if;

  update public.jelement_families
     set color_tokens = p_color_tokens, updated_at = now()
   where id = p_family_id
  returning * into v_family;

  /**
   * A published family that has been recoloured is not what was published.
   *
   * Sent back to draft rather than left claiming a version it no longer
   * matches — the decks already using it keep the version they pinned, and an
   * admin republishes when the palette is settled. Silently changing what a
   * published version means is the one thing versioning exists to prevent.
   */
  if v_family.status = 'published' then
    update public.jelement_families set status = 'draft' where id = p_family_id
    returning * into v_family;
    update public.jelements set status = 'draft', updated_at = now()
     where family_id = p_family_id and status = 'published';
  end if;

  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data)
  values (v_admin, 'jelement_family.recoloured', 'jelement_family', p_family_id::text,
          v_before -> 'color_tokens', p_color_tokens);

  return v_family;
end;
$$;

revoke all on function public.admin_recolor_jelement_family(uuid, jsonb) from public, anon;
grant execute on function public.admin_recolor_jelement_family(uuid, jsonb) to authenticated;

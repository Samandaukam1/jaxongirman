-- The two switches, and a way for an administrator to reach them.
--
-- `app_settings` has a select policy and no write policy: settings are changed
-- through security-definer functions that check who is asking and record what
-- they did. This is that function for the design engine.

create or replace function public.admin_set_design_engine(
  p_generative boolean,
  p_legacy_restricted boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.app_settings
     set value = to_jsonb(p_generative), updated_at = now(), updated_by = v_actor
   where key = 'design.generative_enabled';

  update public.app_settings
     set value = to_jsonb(p_legacy_restricted), updated_at = now(), updated_by = v_actor
   where key = 'design.legacy_restricted';

  -- Which engine makes every customer's next deck is not a quiet setting.
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (
    v_actor,
    'design.engine_changed',
    'app_settings',
    'design.generative_enabled',
    p_reason,
    jsonb_build_object('generative', p_generative, 'legacy_restricted', p_legacy_restricted)
  );

  return jsonb_build_object(
    'generative_enabled', p_generative,
    'legacy_restricted', p_legacy_restricted
  );
end;
$$;

revoke all on function public.admin_set_design_engine(boolean, boolean, text) from public;
grant execute on function public.admin_set_design_engine(boolean, boolean, text) to authenticated;

comment on function public.admin_set_design_engine(boolean, boolean, text) is
  'Turns the generative design engine on or off and restricts the legacy JSLAYD/PPTX designs. Admin only; every change is written to the audit log because it decides how every deck made afterwards looks.';

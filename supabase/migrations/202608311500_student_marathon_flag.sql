-- The switch the whole marathon hangs from.
--
-- Off, and it stays off: the feature is built, deployed and dormant until an
-- administrator decides otherwise. Readable by the app because the app is what
-- has to decide whether to draw a vote button; writable only through the admin
-- function that records who changed it.

insert into public.app_settings (key, value, description, public_read)
values (
  'student_marathon_enabled',
  'false'::jsonb,
  'Talabalar marafoni foydalanuvchilarga ko''rinsinmi. Yoqilganda bosh sahifa, loyihalar, do''kon, o''yingoh va profildagi marafon elementlari paydo bo''ladi.',
  true
)
on conflict (key) do nothing;

create or replace function public.admin_set_student_marathon(
  p_enabled boolean,
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
     set value = to_jsonb(p_enabled), updated_at = now(), updated_by = v_actor
   where key = 'student_marathon_enabled';

  -- Turning this on changes what every user sees on five screens at once.
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, reason, after_data)
  values (
    v_actor,
    'marathon.visibility_changed',
    'app_settings',
    'student_marathon_enabled',
    p_reason,
    jsonb_build_object('enabled', p_enabled)
  );

  return jsonb_build_object('student_marathon_enabled', p_enabled);
end;
$$;

revoke all on function public.admin_set_student_marathon(boolean, text) from public;
grant execute on function public.admin_set_student_marathon(boolean, text) to authenticated;

comment on function public.admin_set_student_marathon(boolean, text) is
  'Shows or hides the student marathon across the app. Admin only; audited, because it changes five screens at once.';

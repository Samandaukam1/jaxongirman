-- Atomic editor history, export queueing, and checked admin configuration mutations.

create or replace function public.apply_editor_operation(
  p_presentation_id uuid,
  p_slide_id uuid,
  p_operation jsonb,
  p_inverse_operation jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_action text := p_operation ->> 'action';
  v_element_id uuid := nullif(p_operation ->> 'elementId', '')::uuid;
  v_new_id uuid := nullif(p_operation ->> 'newId', '')::uuid;
  v_patch jsonb := coalesce(p_operation -> 'patch', '{}'::jsonb);
  v_element jsonb := coalesce(p_operation -> 'element', '{}'::jsonb);
  v_version integer;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.slides
    where id = p_slide_id and presentation_id = p_presentation_id and owner_id = v_user_id
  ) then raise exception 'slide not found' using errcode = 'P0002'; end if;

  if v_action = 'update' then
    update public.slide_elements
    set
      x = case when v_patch ? 'x' then (v_patch ->> 'x')::numeric else x end,
      y = case when v_patch ? 'y' then (v_patch ->> 'y')::numeric else y end,
      width = case when v_patch ? 'width' then (v_patch ->> 'width')::numeric else width end,
      height = case when v_patch ? 'height' then (v_patch ->> 'height')::numeric else height end,
      rotation = case when v_patch ? 'rotation' then (v_patch ->> 'rotation')::numeric else rotation end,
      z_index = case when v_patch ? 'zIndex' then (v_patch ->> 'zIndex')::integer else z_index end,
      opacity = case when v_patch ? 'opacity' then (v_patch ->> 'opacity')::numeric else opacity end,
      locked = case when v_patch ? 'locked' then (v_patch ->> 'locked')::boolean else locked end,
      style = case when v_patch ? 'style' then v_patch -> 'style' else style end,
      content = case when v_patch ? 'content' then v_patch -> 'content' else content end
    where id = v_element_id and slide_id = p_slide_id and presentation_id = p_presentation_id and owner_id = v_user_id;
    if not found then raise exception 'element not found' using errcode = 'P0002'; end if;
  elsif v_action = 'delete' then
    delete from public.slide_elements
    where id = v_element_id and slide_id = p_slide_id and presentation_id = p_presentation_id and owner_id = v_user_id;
    if not found then raise exception 'element not found' using errcode = 'P0002'; end if;
  elsif v_action = 'duplicate' then
    if v_new_id is null then raise exception 'newId is required' using errcode = '22023'; end if;
    insert into public.slide_elements (
      id, slide_id, presentation_id, owner_id, type, x, y, width, height,
      rotation, z_index, opacity, locked, style, content
    )
    select v_new_id, slide_id, presentation_id, owner_id, type,
      x + coalesce((p_operation ->> 'offsetX')::numeric, 18),
      y + coalesce((p_operation ->> 'offsetY')::numeric, 18),
      width, height, rotation, z_index + 1, opacity, false, style, content
    from public.slide_elements
    where id = v_element_id and slide_id = p_slide_id and presentation_id = p_presentation_id and owner_id = v_user_id;
    if not found then raise exception 'element not found' using errcode = 'P0002'; end if;
  elsif v_action = 'insert' then
    insert into public.slide_elements (
      id, slide_id, presentation_id, owner_id, type, x, y, width, height,
      rotation, z_index, opacity, locked, style, content
    ) values (
      coalesce(nullif(v_element ->> 'id', '')::uuid, gen_random_uuid()),
      p_slide_id, p_presentation_id, v_user_id,
      (v_element ->> 'type')::public.element_type,
      (v_element ->> 'x')::numeric, (v_element ->> 'y')::numeric,
      (v_element ->> 'width')::numeric, (v_element ->> 'height')::numeric,
      coalesce((v_element ->> 'rotation')::numeric, 0),
      coalesce((v_element ->> 'z_index')::integer, 0),
      coalesce((v_element ->> 'opacity')::numeric, 1),
      coalesce((v_element ->> 'locked')::boolean, false),
      coalesce(v_element -> 'style', '{}'::jsonb),
      coalesce(v_element -> 'content', '{}'::jsonb)
    );
  else
    raise exception 'unsupported editor action' using errcode = '22023';
  end if;

  update public.presentations
    set current_version = current_version + 1
    where id = p_presentation_id and owner_id = v_user_id
    returning current_version into v_version;

  insert into public.presentation_edit_history (
    presentation_id, owner_id, slide_id, actor_id, operation, inverse_operation, version
  ) values (
    p_presentation_id, v_user_id, p_slide_id, v_user_id, p_operation, p_inverse_operation, v_version
  );

  return v_version;
end;
$$;

create or replace function public.request_export(
  p_presentation_id uuid,
  p_format public.export_format,
  p_options jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.presentations
    where id = p_presentation_id and owner_id = v_user_id and status = 'ready'
  ) then raise exception 'ready presentation not found' using errcode = 'P0002'; end if;
  insert into public.export_jobs (presentation_id, owner_id, format, options)
  values (p_presentation_id, v_user_id, p_format, coalesce(p_options, '{}'::jsonb))
  returning id into v_job_id;
  return v_job_id;
end;
$$;

create or replace function public.admin_update_style_config(
  p_style public.presentation_style,
  p_base_credits integer,
  p_credits_per_slide numeric,
  p_expected_image_ratio numeric,
  p_credits_per_image integer,
  p_is_active boolean,
  p_reason text
)
returns public.style_configs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_before public.style_configs%rowtype;
  v_after public.style_configs%rowtype;
begin
  if not public.is_admin(v_admin_id) then raise exception 'admin role required' using errcode = '42501'; end if;
  if p_base_credits < 0 or p_credits_per_slide < 0 or p_expected_image_ratio not between 0 and 1 or p_credits_per_image < 0 then
    raise exception 'pricing values are invalid' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason is required' using errcode = '22023'; end if;
  select * into v_before from public.style_configs where style = p_style for update;
  if not found then raise exception 'style config not found' using errcode = 'P0002'; end if;
  update public.style_configs set
    base_credits = p_base_credits,
    credits_per_slide = p_credits_per_slide,
    expected_image_ratio = p_expected_image_ratio,
    credits_per_image = p_credits_per_image,
    is_active = p_is_active,
    updated_by = v_admin_id
  where style = p_style returning * into v_after;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin_id, 'style.pricing.update', 'style_config', p_style::text, to_jsonb(v_before), to_jsonb(v_after), left(btrim(p_reason), 500));
  return v_after;
end;
$$;

create or replace function public.admin_update_app_setting(
  p_key text,
  p_value jsonb,
  p_reason text
)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_before public.app_settings%rowtype;
  v_after public.app_settings%rowtype;
begin
  if not public.is_admin(v_admin_id) then raise exception 'admin role required' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason is required' using errcode = '22023'; end if;
  select * into v_before from public.app_settings where key = p_key for update;
  if not found then raise exception 'setting not found' using errcode = 'P0002'; end if;
  update public.app_settings set value = p_value, updated_by = v_admin_id where key = p_key returning * into v_after;
  insert into public.admin_audit_logs (admin_id, action, target_type, target_id, before_data, after_data, reason)
  values (v_admin_id, 'setting.update', 'app_setting', p_key, to_jsonb(v_before), to_jsonb(v_after), left(btrim(p_reason), 500));
  return v_after;
end;
$$;

grant execute on function public.apply_editor_operation(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.request_export(uuid, public.export_format, jsonb) to authenticated;
grant execute on function public.admin_update_style_config(public.presentation_style, integer, numeric, numeric, integer, boolean, text) to authenticated;
grant execute on function public.admin_update_app_setting(text, jsonb, text) to authenticated;
grant all privileges on all tables in schema public to service_role;


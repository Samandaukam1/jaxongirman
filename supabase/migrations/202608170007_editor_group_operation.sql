-- One operation for a library element.
--
-- A JElement is several shapes that behave as one thing, and every transform
-- redraws all of them from the element's geometry rather than patching each. So
-- the editor needs to persist a *set*, not a series of updates.
--
-- Doing it as one operation is what makes it atomic. A drag saved shape by
-- shape could half-fail and leave a truck with its wheels somewhere else, and
-- the inverse operation would have nothing coherent to restore — undo would
-- make it worse rather than better.
--
-- Everything else about the editor is unchanged: the other four actions, the
-- version bump and the history row are exactly as they were.

create or replace function public.apply_editor_operation(p_presentation_id uuid, p_slide_id uuid, p_operation jsonb, p_inverse_operation jsonb)
 RETURNS integer
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
  elsif v_action = 'group' then
    /**
     * A library element, replaced wholesale.
     *
     * An element is several shapes that move as one, and every transform
     * redraws all of them from its geometry — so what is persisted is the new
     * set, not a patch to each member. One operation rather than one per shape
     * keeps the change atomic: a drag that half-saved would leave a truck with
     * its wheels somewhere else, and the inverse would have nothing coherent
     * to restore.
     */
    delete from public.slide_elements
    where slide_id = p_slide_id
      and presentation_id = p_presentation_id
      and owner_id = v_user_id
      and content -> 'jelement' ->> 'groupId' = (p_operation ->> 'groupId');

    insert into public.slide_elements (
      id, slide_id, presentation_id, owner_id, type, x, y, width, height,
      rotation, z_index, opacity, locked, style, content
    )
    select
      coalesce(nullif(row ->> 'id', '')::uuid, gen_random_uuid()),
      p_slide_id, p_presentation_id, v_user_id,
      (row ->> 'type')::public.element_type,
      (row ->> 'x')::numeric, (row ->> 'y')::numeric,
      (row ->> 'width')::numeric, (row ->> 'height')::numeric,
      coalesce((row ->> 'rotation')::numeric, 0),
      coalesce((row ->> 'z_index')::integer, 0),
      coalesce((row ->> 'opacity')::numeric, 1),
      false,
      coalesce(row -> 'style', '{}'::jsonb),
      coalesce(row -> 'content', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_operation -> 'elements', '[]'::jsonb)) as row;
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

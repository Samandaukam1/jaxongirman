-- The defence script, edited by hand (Jaxongirman.app 2.0, §5.4: "PPTX himoya
-- matnini qo‘lda tahrirlash").
--
-- The owner rewrites the opening, the close, or what is said on one slide.
-- The kept PDF was drawn from the old words, so it is dropped and drawn again
-- on the next download.

create or replace function public.defense_edit(p_presentation_id uuid, p_part text, p_index integer, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.presentation_defenses%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
begin
  select * into v_row from public.presentation_defenses where presentation_id = p_presentation_id for update;
  if not found or v_row.owner_id is distinct from auth.uid() then
    raise exception 'defense not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'ready' then raise exception 'Himoya matni hali tayyor emas.' using errcode = '22023'; end if;
  if char_length(v_text) > 6000 then raise exception 'Matn juda uzun.' using errcode = '22023'; end if;

  if p_part = 'introduction' then
    update public.presentation_defenses set introduction = v_text, pdf_path = null, pdf_rendered_at = null
     where presentation_id = p_presentation_id returning * into v_row;
  elsif p_part = 'conclusion' then
    update public.presentation_defenses set conclusion = v_text, pdf_path = null, pdf_rendered_at = null
     where presentation_id = p_presentation_id returning * into v_row;
  elsif p_part = 'section' then
    if p_index is null or p_index < 0 or p_index >= jsonb_array_length(coalesce(v_row.sections, '[]'::jsonb)) then
      raise exception 'section not found' using errcode = '22023';
    end if;
    update public.presentation_defenses
       set sections = jsonb_set(sections, array[p_index::text, 'speaker_text'], to_jsonb(v_text)),
           pdf_path = null, pdf_rendered_at = null
     where presentation_id = p_presentation_id returning * into v_row;
  else
    raise exception 'unknown part' using errcode = '22023';
  end if;
  return jsonb_build_object('introduction', v_row.introduction, 'conclusion', v_row.conclusion, 'sections', v_row.sections);
end;
$$;
revoke all on function public.defense_edit(uuid, text, integer, text) from public, anon;
grant execute on function public.defense_edit(uuid, text, integer, text) to authenticated;

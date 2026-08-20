/**
 * A template cannot be published until its boxes are measured.
 *
 * The existing guard refuses a design still carrying the template's own copy.
 * This adds the other half of the same rule: a design imported before its text
 * boxes were measured has pages that nothing can write into, so a deck made
 * with it costs a person their credits, takes several minutes and then cannot
 * produce the PowerPoint file it was made for.
 *
 * The generator refuses such a design too, but the generator runs after the
 * charge. Here it cannot be chosen in the first place.
 *
 * "Measured" means the page's `text_map` holds the box facts a writer needs —
 * `characterCapacity` in particular — rather than only a shape id and a
 * binding, which is what the column held before the boxes were read from the
 * source slide.
 */

create or replace function public.guard_pptx_design_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_leak text;
  v_pages integer;
  v_measured integer;
begin
  if new.status <> 'published' or new.design_source <> 'pptx' then
    return new;
  end if;

  v_leak := public.pptx_literal_text(new.compiled_config);
  if v_leak is not null then
    raise exception 'Shablondan olingan dizaynda shablonning o''z matni qolgan: %',
      left(v_leak, 60)
      using errcode = '22023', detail = 'template_text_leak';
  end if;

  select
    count(*),
    count(*) filter (
      where jsonb_typeof(profile.text_map) = 'array'
        and exists (
          select 1
          from jsonb_array_elements(profile.text_map) as slot
          where jsonb_typeof(slot -> 'characterCapacity') = 'number'
        )
    )
  into v_pages, v_measured
  from public.design_slide_profiles profile
  where profile.design_id = new.id
    and profile.design_version = greatest(new.published_version, 1);

  if v_pages = 0 then
    raise exception 'Shablonning sahifalari bog''lanmagan. Uni qayta import qiling.'
      using errcode = '22023', detail = 'template_pages_missing';
  end if;

  if v_measured < v_pages then
    raise exception 'Shablon eski formatda import qilingan (% ta sahifadan % tasi o''lchangan). Uni qayta import qiling.',
      v_pages, v_measured
      using errcode = '22023', detail = 'template_boxes_unmeasured';
  end if;

  return new;
end;
$$;

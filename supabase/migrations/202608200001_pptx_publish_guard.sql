/**
 * A template's own words must not reach a customer's deck.
 *
 * The importer binds every text box, so a design produced from a PowerPoint
 * file carries no copy of its own — its pages are shapes and slots. That is a
 * property of one function today. The day somebody edits a stored document by
 * hand, patches one in a script, or writes a second importer, it stops being a
 * property of anything.
 *
 * Publishing is where it matters, because publishing is what puts a design in
 * front of paying customers. Sending somebody a slide reading "Lorem ipsum",
 * or the sales figures of whoever the template was originally built for, is the
 * one failure in this feature that cannot be explained away.
 *
 * Only `pptx` designs are checked. A written design places literal copy on
 * purpose — a fixed label, a rule, a mark — and forbidding that would break
 * every design already published.
 */

create or replace function public.pptx_literal_text(p_document jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  -- A text element's source is either `{bind}` or `{literal}`. Anything holding
  -- a literal is copy the design carries itself, which for an imported template
  -- means copy that came out of somebody else's file.
  select element->'source'->>'literal'
  from jsonb_array_elements(coalesce(p_document->'archetypes', '[]'::jsonb)) as archetype,
       jsonb_array_elements(coalesce(archetype->'elements', '[]'::jsonb)) as element
  where element->'source' ? 'literal'
    and length(btrim(coalesce(element->'source'->>'literal', ''))) > 0
  limit 1;
$$;

comment on function public.pptx_literal_text(jsonb) is
  'The first literal string a document places on a slide, or null. Used to keep an imported template''s own copy out of published designs.';

/**
 * Refuses to publish an imported design that still carries the template's copy.
 *
 * A trigger rather than a check inside `admin_publish_design`, so it holds for
 * any path that flips the status — including a hand-run `update` in a console,
 * which is exactly the situation the function's own check would not see.
 */
create or replace function public.guard_pptx_design_publish()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_leak text;
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

  return new;
end;
$$;

drop trigger if exists presentation_designs_pptx_guard on public.presentation_designs;
create trigger presentation_designs_pptx_guard
  before insert or update on public.presentation_designs
  for each row
  execute function public.guard_pptx_design_publish();

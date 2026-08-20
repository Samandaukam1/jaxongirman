begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

/**
 * A template's own words must not reach a customer's deck.
 *
 * The importer binds every text box, so an imported design carries no copy of
 * its own. That is a property of one function, and one function is not where a
 * promise this size should live: the day somebody patches a stored document by
 * hand or writes a second importer, the property quietly stops holding.
 *
 * Publishing is the moment that matters, because publishing is what puts a
 * design in front of people who paid.
 */

-- ------------------------------------------------------ reading a document --

select is(
  public.pptx_literal_text('{"archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]}]}'::jsonb),
  null,
  'a document where every box is bound carries no literal'
);

select is(
  public.pptx_literal_text('{"archetypes":[{"elements":[{"type":"text","source":{"literal":"Acme Q3 Results"}}]}]}'::jsonb),
  'Acme Q3 Results',
  'a literal is found and reported as itself'
);

select is(
  public.pptx_literal_text('{"archetypes":[{"elements":[{"type":"text","source":{"literal":"   "}}]}]}'::jsonb),
  null,
  'a literal of only spaces is not copy anybody reads'
);

select is(
  public.pptx_literal_text('{"archetypes":[]}'::jsonb),
  null,
  'a document with no pages is not a leak'
);

select is(
  public.pptx_literal_text('{}'::jsonb),
  null,
  'a document missing its archetypes entirely does not raise'
);

select is(
  public.pptx_literal_text(
    '{"archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]},
                    {"elements":[{"type":"text","source":{"literal":"Lorem ipsum"}}]}]}'::jsonb),
  'Lorem ipsum',
  'a leak on the second page is found too'
);

-- --------------------------------------------------------------- the guard --

/**
 * A template also has to have had its text boxes measured.
 *
 * A page's `text_map` is what a writer is given and what the exporter replaces.
 * Before the boxes were read from the source slide it held a shape id and a
 * binding and nothing about the box, and a deck made from such a design costs a
 * person their credits and then cannot produce the file it was made for. So an
 * unmeasured template is refused here, where it cannot be chosen, rather than
 * in the generator, which runs after the charge.
 */
insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-clean', 'Clean', 'great', 'pptx',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]}]}'::jsonb,
        'hash-clean', 'draft');

insert into public.design_slide_profiles (design_id, design_version, archetype_id, role, source_slide_part, text_map)
select id, 1, 'page_01', 'introduction', 'ppt/slides/slide1.xml',
       '[{"shapeId":"2","role":"title","characterCapacity":120,"paragraphs":1}]'::jsonb
from public.presentation_designs where slug = 'guard-clean';

select lives_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-clean'$$,
  'an imported design that binds everything and knows its boxes publishes'
);

insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-pageless', 'Pageless', 'great', 'pptx',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]}]}'::jsonb,
        'hash-pageless', 'draft');

select throws_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-pageless'$$,
  '22023',
  null,
  'a template whose pages were never linked to source slides is refused'
);

insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-unmeasured', 'Unmeasured', 'great', 'pptx',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]}]}'::jsonb,
        'hash-unmeasured', 'draft');

-- What the column held before the boxes were measured: a shape and a binding.
insert into public.design_slide_profiles (design_id, design_version, archetype_id, role, source_slide_part, text_map)
select id, 1, 'page_01', 'introduction', 'ppt/slides/slide1.xml',
       '[{"shapeId":"2","binding":"title","elementId":"page_01_title","paragraphs":1}]'::jsonb
from public.presentation_designs where slug = 'guard-unmeasured';

select throws_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-unmeasured'$$,
  '22023',
  null,
  'a template imported before its boxes were measured is refused'
);

insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-leaky', 'Leaky', 'great', 'pptx',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"literal":"Acme Q3"}}]}]}'::jsonb,
        'hash-leaky', 'draft');

select throws_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-leaky'$$,
  '22023',
  null,
  'an imported design still carrying the template''s copy is refused'
);

/**
 * A written design places literal copy on purpose — a fixed label, a rule, a
 * mark — so the same document is fine from the other source. Forbidding it
 * would break every design already published.
 */
insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-written', 'Written', 'great', 'code',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"literal":"JAXONGIRMAN"}}]}]}'::jsonb,
        'hash-written', 'draft');

select lives_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-written'$$,
  'a written design may place its own copy, as it always could'
);

-- A written design has no source slides and is not asked for any.
select lives_ok(
  $$update public.presentation_designs set is_featured = true where slug = 'guard-written'$$,
  'a written design is never asked for page profiles it does not have'
);

select * from finish();
rollback;

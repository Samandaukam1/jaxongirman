begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

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

insert into public.presentation_designs (slug, name, tier, design_source, compiled_config, content_hash, status)
values ('guard-clean', 'Clean', 'great', 'pptx',
        '{"format":"JSLAYD","archetypes":[{"elements":[{"type":"text","source":{"bind":"title"}}]}]}'::jsonb,
        'hash-clean', 'draft');

select lives_ok(
  $$update public.presentation_designs set status = 'published' where slug = 'guard-clean'$$,
  'an imported design that binds everything publishes'
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

select * from finish();
rollback;

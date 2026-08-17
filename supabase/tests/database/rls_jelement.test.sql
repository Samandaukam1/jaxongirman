begin;

create extension if not exists pgtap with schema extensions;
select plan(48);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1110000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'admin@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2220000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'member@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now());

insert into public.user_roles (user_id, role) values ('a1110000-0000-0000-0000-00000000000a', 'admin')
  on conflict do nothing;

-- ------------------------------------------------------------ privileges --

/**
 * The library is written by RPCs and by nothing else.
 *
 * An admin's token is not a licence to edit rows directly: the validation, the
 * alias index and the audit entry all live in the function, and a direct write
 * would skip every one of them.
 */
select ok(not has_table_privilege('authenticated', 'public.jelement_families', 'INSERT'),
  'no client inserts a family, admin or not');
select ok(not has_table_privilege('authenticated', 'public.jelements', 'UPDATE'),
  'nor edits an element in place');
select ok(not has_table_privilege('authenticated', 'public.jelement_aliases', 'INSERT'),
  'nor writes its own search terms');
select ok(not has_table_privilege('anon', 'public.jelements', 'INSERT'),
  'and a signed-out caller certainly does not');
select ok(not has_function_privilege('authenticated', 'public.jelement_record_usage(uuid, uuid, uuid, text, text)', 'EXECUTE'),
  'usage is recorded by the server, so popularity cannot be inflated from a phone');
select ok(not has_function_privilege('anon', 'public.jelement_search(text, text, integer)', 'EXECUTE'),
  'and a signed-out caller cannot search: it has no presentation to fill');
select ok(has_function_privilege('authenticated', 'public.jelement_search(text, text, integer)', 'EXECUTE'),
  'a signed-in one can');

-- ------------------------------------------------------------ normalising --

/**
 * The two Uzbek apostrophes are one letter.
 *
 * Which one somebody types depends on their keyboard. A search that treats them
 * as different letters fails for half its users and looks like the library is
 * empty.
 */
select is(public.jelement_normalize('oʻchoq'), public.jelement_normalize('o''choq'),
  'both apostrophes fold to one form');
select is(public.jelement_normalize('  KON   Yuk  Mashinasi '), 'kon yuk mashinasi',
  'case and spacing are not part of a word');
select isnt(public.jelement_normalize('kon'), public.jelement_normalize('konus'),
  'but nothing is stemmed — a cone is not a mine');

-- ----------------------------------------------------------------- saving --

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2220000-0000-0000-0000-00000000000b', true);

select throws_ok(
  $$select public.admin_save_jelement_family('{"format":"JELEMENT"}'::jsonb)$$,
  '42501', null, 'a member cannot import a family');

select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-00000000000a', true);

select throws_ok(
  $$select public.admin_save_jelement_family('{"format":"JSLAYD"}'::jsonb)$$,
  '22023', null, 'and an admin cannot import something that is not a JElement spec');

create temporary table t_family as
select public.admin_save_jelement_family(jsonb_build_object(
  'format', 'JELEMENT',
  'family', jsonb_build_object('slug', 'mining-neon', 'name', 'Mining Neon', 'category', 'Mining', 'style', 'Industrial CGI'),
  'colorTokens', jsonb_build_object('primary', '#101214', 'accent', '#A7FF00'),
  'visualDNA', jsonb_build_object('material', 'matte graphite'),
  'search', jsonb_build_object('keywords', jsonb_build_array('kon', 'mining')),
  'elements', jsonb_build_array(
    jsonb_build_object(
      'canonicalName', 'mining haul truck',
      'displayName', 'Kon yuk mashinasi',
      'objectClass', 'vehicle',
      'semantic', jsonb_build_object(
        'aliases', jsonb_build_array('haul truck', 'dump truck'),
        'uzbekTerms', jsonb_build_array('kon yuk mashinasi', 'karer samosvali'),
        'concepts', jsonb_build_array('ore transportation'),
        'contexts', jsonb_build_array('open pit')),
      'geometry', jsonb_build_object('components', jsonb_build_array(
        jsonb_build_object('id', 'body', 'shape', 'roundedRect', 'fill', 'primary'))),
      'usage', jsonb_build_object('slideRoles', jsonb_build_array('hero', 'section'), 'visualWeight', 8)),
    jsonb_build_object(
      'canonicalName', 'survey total station',
      'objectClass', 'device',
      'semantic', jsonb_build_object(
        'uzbekTerms', jsonb_build_array('geodezik asbob'),
        'concepts', jsonb_build_array('site survey', 'measurement')),
      'geometry', jsonb_build_object('components', jsonb_build_array(
        jsonb_build_object('id', 'body', 'shape', 'rect', 'fill', 'primary'))),
      'usage', jsonb_build_object('slideRoles', jsonb_build_array('explanation')))
  )
)) as family;

select is((select count(*)::integer from public.jelement_families where slug = 'mining-neon'), 1,
  'the family was saved');
select is(
  (select count(*)::integer from public.jelements e
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon'),
  2, 'with both of its elements');
select is((select status::text from public.jelement_families where slug = 'mining-neon'), 'draft',
  'and nothing is published by an import');

-- Aliases are built by the save, not by a second call somebody might forget.
select ok((select count(*) from public.jelement_aliases) >= 8,
  'every way of naming the objects became a searchable row');
select is(
  (select count(*)::integer from public.jelement_aliases a
     join public.jelements e on e.id = a.element_id
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon' and a.kind = 'canonical'),
  2, 'each element indexes its own name');
select ok(
  exists (select 1 from public.jelement_aliases where normalized = 'karer samosvali' and language = 'uz'),
  'and its Uzbek terms, normalised');

-- ------------------------------------------------------------- publishing --

select lives_ok(
  $$select public.admin_publish_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'))$$,
  'a family with colours and drawable elements publishes');

select is((select status::text from public.jelement_families where slug = 'mining-neon'), 'published',
  'the family is published');
select is((select count(*)::integer from public.jelements where status = 'published'), 2,
  'and so is every element in it');
select is(
  (select count(*)::integer from public.jelement_versions v
     join public.jelements e on e.id = v.element_id
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon'),
  2, 'each element records the version it was published as');
select is((select published_version from public.jelements where canonical_name = 'mining haul truck'), 1,
  'starting at one');

-- Republishing an unchanged family spends no version number.
select lives_ok(
  $$select public.admin_publish_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'))$$,
  'republishing is allowed');
select is(
  (select count(*)::integer from public.jelement_versions v
     join public.jelements e on e.id = v.element_id
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon'),
  2, 'but an unchanged element does not get a second version row');

-- ---------------------------------------------------------------- search --

select is(
  (select jsonb_array_length(public.jelement_search('mining haul truck'))), 1,
  'the exact name finds exactly the object');
select is(
  ((public.jelement_search('mining haul truck')) -> 0 ->> 'canonical_name'),
  'mining haul truck', 'and it is the right one');

select ok(
  (public.jelement_search('dump truck')) -> 0 ->> 'canonical_name' = 'mining haul truck',
  'somebody else''s word for it finds it too');

select ok(
  (public.jelement_search('karer samosvali')) -> 0 ->> 'canonical_name' = 'mining haul truck',
  'and so does the Uzbek term');

select ok(
  (public.jelement_search('karer samosvali')) -> 0 is not null,
  'a query typed with the other apostrophe still finds it');

select ok(
  jsonb_array_length(public.jelement_search('site survey')) >= 1,
  'a concept finds an element nobody named that');

select ok(
  jsonb_array_length(public.jelement_search('konus')) = 0,
  'and a word that merely looks similar finds nothing');

-- The shortlist is small: a search answers with what a planner needs to choose,
-- not with what a renderer needs to draw.
select ok(
  (public.jelement_search('mining haul truck')) -> 0 -> 'render_spec' is null,
  'a search result carries no render specification');
select ok(
  length((public.jelement_search('mining'))::text) < 4000,
  'and the whole shortlist stays small enough to hand to a model');

-- --------------------------------------------------------------- resolve --

create temporary table t_element as
select id, published_version from public.jelements where canonical_name = 'mining haul truck';

select ok(
  (public.jelement_resolve((select id from t_element))) -> 'element' is not null,
  'a chosen element resolves in full');
select is(
  (public.jelement_resolve((select id from t_element))) -> 'family' ->> 'slug',
  'mining-neon', 'carrying the family whose colours its shapes bind to');

-- ------------------------------------------------------- archive, not delete --

select lives_ok(
  $$select public.admin_archive_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'))$$,
  'a family can be withdrawn');

select is(
  (select jsonb_array_length(public.jelement_search('mining haul truck'))), 0,
  'an archived element leaves the catalogue');

/**
 * But a deck that already used it keeps rendering.
 *
 * This is the whole reason archiving never deletes: a presentation exported
 * last month pinned a version, and that version has to keep resolving after the
 * element stops being offered.
 */
select ok(
  (public.jelement_resolve((select id from t_element), 1)) -> 'element' is not null,
  'and its pinned version still resolves for the decks that hold it');

select is(
  (select count(*)::integer from public.jelement_versions v
     join public.jelements e on e.id = v.element_id
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon'),
  2, 'no version was destroyed by archiving');


-- ----------------------------------------------------------- recolouring --

/**
 * One row changes and every element follows.
 *
 * That is only possible because no element ever wrote a colour down — the
 * compiler refuses a literal hex on a shape, and this is the function that
 * makes the refusal worth having.
 */
select throws_ok(
  $$select public.admin_recolor_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'),
      '{"accent": "lime"}'::jsonb)$$,
  '22023', null, 'a value that is not a colour is refused before it reaches every element');

select throws_ok(
  $$select public.admin_recolor_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'), '{}'::jsonb)$$,
  '22023', null, 'and a family cannot be left with no colours at all');

reset role;
update public.jelement_families set status = 'published' where slug = 'mining-neon';
update public.jelements set status = 'published'
 where family_id = (select id from public.jelement_families where slug = 'mining-neon');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-00000000000a', true);

select lives_ok(
  $$select public.admin_recolor_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'),
      '{"primary": "#101214", "accent": "#5B5BFF"}'::jsonb)$$,
  'a palette can be changed');

select is(
  (select color_tokens ->> 'accent' from public.jelement_families where slug = 'mining-neon'),
  '#5B5BFF', 'the family carries the new colour');

/**
 * A published family that has been recoloured is not what was published.
 *
 * Sent back to draft rather than left claiming a version it no longer matches.
 * Silently changing what a published version means is the one thing versioning
 * exists to prevent.
 */
select is(
  (select status::text from public.jelement_families where slug = 'mining-neon'),
  'draft', 'recolouring a published family returns it to draft');
select is(
  (select count(*)::integer from public.jelements
    where family_id = (select id from public.jelement_families where slug = 'mining-neon')
      and status = 'published'),
  0, 'and its elements come back with it');

-- The decks that pinned a version are untouched by any of this.
select is(
  (select count(*)::integer from public.jelement_versions v
     join public.jelements e on e.id = v.element_id
     join public.jelement_families f on f.id = e.family_id
    where f.slug = 'mining-neon'),
  2, 'no version was rewritten by a recolour');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2220000-0000-0000-0000-00000000000b', true);
select throws_ok(
  $$select public.admin_recolor_jelement_family(
      (select id from public.jelement_families where slug = 'mining-neon'),
      '{"accent": "#000000"}'::jsonb)$$,
  '42501', null, 'and a member cannot repaint the library');

select * from finish();
rollback;

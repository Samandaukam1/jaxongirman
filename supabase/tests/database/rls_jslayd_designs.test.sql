begin;

create extension if not exists pgtap with schema extensions;
select plan(53);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'designer@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'reader@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"User"}', now(), now());

insert into public.user_roles (user_id, role) values
  ('a1110000-0000-0000-0000-000000000001', 'admin');

-- ------------------------------------------------------------- privileges --

select ok(not has_function_privilege('anon',
  'public.admin_save_design(text, text, public.presentation_style, text, boolean, text, jsonb, jsonb, text, integer, text, uuid)', 'EXECUTE'),
  'a signed-out caller cannot save a design');
select ok(not has_function_privilege('anon', 'public.admin_publish_design(uuid)', 'EXECUTE'),
  'a signed-out caller cannot publish a design');
select ok(not has_function_privilege('anon', 'public.admin_archive_design(uuid, text)', 'EXECUTE'),
  'a signed-out caller cannot archive a design');
select ok(not has_table_privilege('anon', 'public.presentation_designs', 'INSERT'),
  'a signed-out caller cannot insert a design row directly');
select ok(not has_table_privilege('authenticated', 'public.presentation_designs', 'UPDATE'),
  'an ordinary client cannot update a design row directly');
select ok(has_table_privilege('anon', 'public.presentation_designs', 'SELECT'),
  'the catalogue is readable so a signed-out projector can render');

-- The generator runs as the service role and reads the design it must render
-- with. Without these the JSLAYD path fails closed into the built-in blueprint,
-- silently, which is exactly how this was missed until a live run.
select ok(has_table_privilege('service_role', 'public.presentation_designs', 'SELECT'),
  'the generator can read the design catalogue');
select ok(has_table_privilege('service_role', 'public.presentation_design_versions', 'SELECT'),
  'the generator can read the pinned version of a design');
select ok(has_table_privilege('service_role', 'public.presentation_design_fonts', 'SELECT'),
  'the generator can read a design''s fonts');

-- ---------------------------------------------------------- an ordinary user

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2220000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$ select public.admin_save_design('yovuz', 'Yovuz', 'simple') $$,
  '42501', 'forbidden',
  'a non-admin is refused by the save RPC'
);

-- ------------------------------------------------------------------- admin --

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-000000000001', true);

select isnt(
  public.admin_save_design(
    'sinov-dizayn', 'Sinov dizayn', 'simple', 'Tavsif', false, 'JSLAYD-DESIGN 1.0',
    '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-v1', 92
  ),
  null,
  'an admin can save a design'
);

select is(
  (select status::text from public.presentation_designs where slug = 'sinov-dizayn'),
  'draft',
  'a saved design starts as a draft'
);

select throws_ok(
  $$ select public.admin_save_design('yomon-hujjat', 'Yomon', 'simple', '', false, '', '{"format":"PPTX"}'::jsonb) $$,
  '22023', 'not_a_jslayd_document',
  'a payload that is not a JSLAYD document is refused'
);

-- A draft is invisible to everyone but an admin.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2220000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.presentation_designs where slug = 'sinov-dizayn'),
  0,
  'a draft design is invisible to an ordinary user'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is(
  (select count(*)::integer from public.presentation_designs),
  0,
  'a draft design is invisible to a signed-out reader'
);

-- ---------------------------------------------------------------- publishing

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-000000000001', true);

select is(
  public.admin_publish_design((select id from public.presentation_designs where slug = 'sinov-dizayn')),
  1,
  'the first publish is version 1'
);

select is(
  public.admin_publish_design((select id from public.presentation_designs where slug = 'sinov-dizayn')),
  1,
  'republishing an unchanged design does not spend a version number'
);

select is(
  (select count(*)::integer from public.presentation_design_versions),
  1,
  'and records only one version row'
);

-- An edit produces a new hash, and therefore a new version.
select isnt(
  public.admin_save_design(
    'sinov-dizayn', 'Sinov dizayn', 'simple', 'Yangilangan', false, 'JSLAYD-DESIGN 1.0',
    '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-v2', 95
  ),
  null,
  'an admin can edit a published design'
);
select is(
  public.admin_publish_design((select id from public.presentation_designs where slug = 'sinov-dizayn')),
  2,
  'a changed design publishes as the next version'
);
select is(
  (select count(*)::integer from public.presentation_design_versions),
  2,
  'and the earlier version is kept so old decks still render'
);

-- ------------------------------------------------------------- renaming --
--
-- Every design is editable now, including the ones translated from the old
-- templates. Matching an existing design by slug alone meant that correcting a
-- slug wrote a second design and left the first one published under the old
-- name, with nobody told.
create temporary table renamed on commit drop as
  select id from public.presentation_designs where slug = 'sinov-dizayn';

select public.admin_save_design(
  'sinov-dizayn-yangi', 'Sinov dizayn', 'simple', 'Nomi tuzatildi', false, 'JSLAYD-DESIGN 1.0',
  '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-v3', 95, null,
  (select id from renamed)
);

select is(
  (select slug from public.presentation_designs where id = (select id from renamed)),
  'sinov-dizayn-yangi',
  'editing a design by id renames it in place'
);
select is(
  (select count(*)::integer from public.presentation_designs where slug like 'sinov-dizayn%'),
  1,
  'and does not leave a second design behind under the old slug'
);
select is(
  (select count(*)::integer from public.presentation_design_versions
     where design_id = (select id from renamed)),
  2,
  'the versions published before the rename still belong to it, so old decks render'
);

-- A rename onto a slug another design answers to must fail rather than pick one.
select public.admin_save_design(
  'band-slug', 'Band', 'simple', '', false, '',
  '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-band', 90
);
select throws_ok(
  $$ select public.admin_save_design(
       'band-slug', 'Sinov dizayn', 'simple', '', false, '',
       '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-v4', 95, null,
       (select id from renamed)
     ) $$,
  '23505',
  'slug_taken',
  'a rename onto an occupied slug is refused'
);

-- A stale editor tab naming a design that no longer exists must not quietly
-- create it again under a new id.
select throws_ok(
  $$ select public.admin_save_design(
       'arvoh', 'Arvoh', 'simple', '', false, '',
       '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-x', 90, null,
       '00000000-0000-0000-0000-0000000000ff'::uuid
     ) $$,
  '02000',
  'design_not_found',
  'saving against an unknown design id is refused'
);

-- Put the slug back so the checks below read as they always did.
select public.admin_save_design(
  'sinov-dizayn', 'Sinov dizayn', 'simple', 'Yangilangan', false, 'JSLAYD-DESIGN 1.0',
  '{"format":"JSLAYD","version":"1.0","kind":"design"}'::jsonb, '{}'::jsonb, 'hash-v2', 95, null,
  (select id from renamed)
);
select public.admin_archive_design(
  (select id from public.presentation_designs where slug = 'band-slug'), 'sinov uchun');

-- ------------------------------------------------------ the published state

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is(
  (select count(*)::integer from public.presentation_designs where slug = 'sinov-dizayn'),
  1,
  'a published design is visible to a signed-out reader'
);
select is(
  (select compiled_config->>'format' from public.presentation_designs where slug = 'sinov-dizayn'),
  'JSLAYD',
  'and carries its compiled document'
);

-- ------------------------------------------------------------------- fonts --

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-000000000001', true);

-- No client role holds INSERT on these tables at all; every write is an RPC.
select ok(not has_table_privilege('authenticated', 'public.presentation_design_fonts', 'INSERT'),
  'no client can insert a font row directly');

select isnt(
  public.admin_save_design_font(
    (select id from public.presentation_designs where slug = 'sinov-dizayn'),
    'font_1', 'Sinov Display', array['display','heading'], 'sinov-display.ttf', 'ttf', 800, false, 'League Spartan'
  ),
  null,
  'an admin can attach a font to a design'
);

select is(
  (select asset_path from public.presentation_design_fonts where font_id = 'font_1'),
  'sinov-dizayn/sinov-display.ttf',
  'the object key is rebuilt from the design slug, not taken from the caller'
);

select throws_ok(
  $$ select public.admin_save_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'),
       'font_2', 'X', array['body'], 'x.woff2', 'woff2') $$,
  '23514',
  null,
  'woff2 is refused, because the PDF exporter cannot embed it'
);

select throws_ok(
  $$ select public.admin_save_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'),
       'font_3', 'X', array['body'], '../../secret.ttf', 'ttf') $$,
  '22023', 'unsafe_asset',
  'a font file name that climbs out of its prefix is refused'
);

select throws_ok(
  $$ select public.admin_save_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'),
       'font_9', 'X', array['body'], 'x.ttf', 'ttf') $$,
  '23514',
  null,
  'a font slot outside font_1..font_4 is refused'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is(
  (select count(*)::integer from public.presentation_design_fonts),
  1,
  'a published design''s fonts are readable, so the apps can load the face'
);

-- --------------------------------------------------------------- archiving --

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$ select public.admin_archive_design((select id from public.presentation_designs where slug = 'sinov-dizayn'), 'sinov') $$,
  'an admin can archive a design'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select is(
  (select count(*)::integer from public.presentation_designs),
  0,
  'an archived design leaves the catalogue'
);
select is(
  (select count(*)::integer from public.presentation_design_versions),
  2,
  'but its versions survive, so decks built from it still render'
);

-- ------------------------------------------------------- font packages --

-- The archiving section above left this as a signed-out reader; attaching a
-- font is an admin action and a design that is archived is invisible to anon.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1110000-0000-0000-0000-000000000001', true);

--
-- A slot is a family, not a file. Regular, Medium, SemiBold, Bold and their
-- italics are separate files of one typeface, and a design that uses two
-- weights needs both present or the renderer smears one into the other.
select lives_ok(
  $$ select public.admin_save_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'), 'font_2', 'Sinov Sans', array['body'],
       'sinov-700.ttf', 'ttf', 700, false, 'Inter') $$,
  'a second weight can be added to a package that already has one');
select is(
  (select count(*)::integer from public.presentation_design_fonts
     where design_id = (select id from public.presentation_designs where slug = 'sinov-dizayn') and font_id = 'font_1'),
  1,
  'and it does not disturb another slot');

select lives_ok(
  $$ select public.admin_save_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'), 'font_2', 'Sinov Sans', array['body'],
       'sinov-700i.ttf', 'ttf', 700, true, 'Inter') $$,
  'the italic of a weight is a separate face, not a replacement');
select is(
  (select count(*)::integer from public.presentation_design_fonts
     where design_id = (select id from public.presentation_designs where slug = 'sinov-dizayn') and font_id = 'font_2'),
  2,
  'so the package now holds both');

-- Re-uploading a face replaces it. Otherwise a corrected file would sit beside
-- the wrong one and the renderer would pick whichever it found first.
select public.admin_save_design_font(
  (select id from public.presentation_designs where slug = 'sinov-dizayn'), 'font_2', 'Sinov Sans', array['body'],
  'sinov-700-tuzatilgan.ttf', 'ttf', 700, false, 'Inter');
select is(
  (select count(*)::integer from public.presentation_design_fonts
     where design_id = (select id from public.presentation_designs where slug = 'sinov-dizayn') and font_id = 'font_2'),
  2,
  'the same weight and slope replaces rather than accumulates');

-- The family's own properties stay identical across its faces: two faces of one
-- font disagreeing about their own name is not a state worth reaching.
select is(
  (select count(distinct name)::integer from public.presentation_design_fonts
     where design_id = (select id from public.presentation_designs where slug = 'sinov-dizayn') and font_id = 'font_2'),
  1,
  'every face of a package carries the same family name');

select lives_ok(
  $$ select public.admin_remove_design_font(
       (select id from public.presentation_designs where slug = 'sinov-dizayn'), 'font_2', 700, true) $$,
  'a face can be taken back without dropping the family');
select is(
  (select count(*)::integer from public.presentation_design_fonts
     where design_id = (select id from public.presentation_designs where slug = 'sinov-dizayn') and font_id = 'font_2'),
  1,
  'and only that face goes');

-- ------------------------------------------------------------------ audit --

set local role postgres;
select is(
  (select count(*)::integer from public.admin_audit_logs
     where target_type = 'presentation_design' and action = 'design.created'
       and target_id = (select id from renamed)::text),
  1,
  'creating a design is audited'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
     where target_type = 'presentation_design' and action = 'design.published'
       and target_id = (select id from renamed)::text),
  3,
  'every publish attempt is audited, including the no-op republish'
);
select is(
  (select count(*)::integer from public.admin_audit_logs
     where target_type = 'presentation_design' and action = 'design.archived'
       and target_id = (select id from renamed)::text),
  1,
  'archiving is audited'
);

-- ------------------------------------------------- existing decks untouched --

select is(
  (select count(*)::integer from public.slide_templates where is_active),
  15,
  'the built-in template catalogue is untouched by the JSLAYD migration'
);

-- ------------------------------------------------ the built-in catalogue --
--
-- Regression for a policy that read as "anon sees the active catalogue" and
-- did not: `is_admin` has no EXECUTE for `anon`, and its ACL is checked when
-- the expression is initialised, so the OR never short-circuited.
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);

select is(
  (select count(*)::integer from public.slide_templates),
  15,
  'a signed-out reader sees the active templates and no error'
);
select is(
  (select count(*)::integer from public.palette_families),
  8,
  'a signed-out reader sees the active palette families'
);
select is(
  (select count(*)::integer from public.slide_templates where not is_active),
  0,
  'and retired templates stay hidden from them'
);

reset role;
select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'cc330000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'importer@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Importer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dd440000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'onlooker@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Onlooker"}', now(), now());

-- ---------------------------------------------------------------- grants --
-- Opening an import is the user's to do; settling one is not. A client that
-- could call finish could mark an empty deck ready.
select ok(has_function_privilege('authenticated', 'public.pptx_import_start(text, text)', 'EXECUTE'),
  'a signed-in user can open an import');
select ok(not has_function_privilege('authenticated', 'public.pptx_import_finish(uuid, integer)', 'EXECUTE'),
  'a client cannot declare an import finished');
select ok(not has_function_privilege('authenticated', 'public.pptx_import_fail(uuid, text)', 'EXECUTE'),
  'a client cannot declare an import failed');
select ok(not has_function_privilege('anon', 'public.pptx_import_start(text, text)', 'EXECUTE'),
  'a signed-out caller cannot open an import');

-- The bucket has to accept the format or the upload never reaches the parser.
select ok(
  exists(
    select 1 from storage.buckets
    where id = 'user-uploads'
      and 'application/vnd.openxmlformats-officedocument.presentationml.presentation' = any(allowed_mime_types)
  ),
  'the upload bucket accepts a .pptx'
);

-- --------------------------------------------------------------- opening --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cc330000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table t_import as select public.pptx_import_start('  ', 'Yillik hisobot.pptx') as id;
grant select on t_import to authenticated;

select is(
  (select owner_id from public.presentations where id = (select id from t_import)),
  'cc330000-0000-0000-0000-000000000001'::uuid,
  'the import belongs to the caller, not to whoever writes the slides'
);
-- An empty title is the common case: a deck whose first slide has no title
-- placeholder still has to land somewhere the user can find it.
select is(
  (select title from public.presentations where id = (select id from t_import)),
  'Import qilingan taqdimot',
  'a nameless deck still gets a name'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'dd440000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::integer from public.presentations where id = (select id from t_import)),
  0, 'another signed-in user cannot see the import'
);

reset role;
select * from finish();
rollback;

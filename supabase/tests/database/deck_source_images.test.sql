begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

/*
 * The author's pictures go straight into the deck's own folder, and that is
 * the only way a phone may write to `presentation-assets`.
 *
 *   A  the author        O  somebody else
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'a@example.com', '', now(), '{}', '{"full_name":"A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '72000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'o@example.com', '', now(), '{}', '{"full_name":"O"}', now(), now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok($$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('presentation-assets', '71000000-0000-0000-0000-000000000001/73000000-0000-0000-0000-000000000003/source-1.jpg',
     '71000000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":204800}')
$$, 'the author puts a picture in their deck''s folder');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('presentation-assets', '71000000-0000-0000-0000-000000000001/73000000-0000-0000-0000-000000000003/cover.png',
     '71000000-0000-0000-0000-000000000001', '{"mimetype":"image/png","size":1024}')
$$, '42501', null, 'any other name in that folder is the server''s');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('presentation-assets', '71000000-0000-0000-0000-000000000001/73000000-0000-0000-0000-000000000003/source-7.jpg',
     '71000000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":1024}')
$$, '42501', null, 'six pictures at most');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('presentation-assets', '72000000-0000-0000-0000-000000000002/73000000-0000-0000-0000-000000000003/source-1.jpg',
     '71000000-0000-0000-0000-000000000001', '{"mimetype":"image/jpeg","size":1024}')
$$, '42501', null, 'nobody writes into another person''s folder');

select is((select count(*)::int from storage.objects where bucket_id = 'presentation-assets'
            and name like '71000000-0000-0000-0000-000000000001/%'), 1, 'the author reads back their own picture');

set local request.jwt.claims = '{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'presentation-assets'), 0,
  'and nobody else can see it');

select * from finish();
rollback;

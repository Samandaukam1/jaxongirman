begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

/*
 * Fast publishing: an untouched deck made here goes live by itself; an
 * edited, imported, legacy, file-fed or flagged one goes to a moderator; a
 * deck has one live listing; the provenance columns are the server's.
 *
 *   S  seller with a tariff that sells      O  another person      A  admin
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '5e000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'seller@example.com', '', now(), '{}', '{"full_name":"Seller"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '0f000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'other@example.com', '', now(), '{}', '{"full_name":"Other"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'ad000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'admin@example.com', '', now(), '{}', '{"full_name":"Admin"}', now(), now());
insert into public.user_roles (user_id, role) values ('ad000000-0000-0000-0000-000000000003', 'admin');

insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select '5e000000-0000-0000-0000-000000000001', id, 'active', now(), now() + interval '30 days',
       jsonb_build_object('billing_model', 'coins', 'page_multiplier', 1, 'features', jsonb_build_object(
         'marketplace_access', jsonb_build_object('enabled', true), 'marketplace_sell', jsonb_build_object('enabled', true)))
  from public.subscription_plans where code = 'bemalol';

-- Six decks of S's and one of O's. A deck the generator made has a succeeded
-- job and slides written by the service role.
insert into public.presentations (id, owner_id, title, topic, style, status, requested_slide_count) values
  ('d0000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-000000000001', 'Toza taqdimot', 'Iqlim o‘zgarishi', 'simple', 'ready', 10),
  ('d0000000-0000-0000-0000-000000000002', '5e000000-0000-0000-0000-000000000001', 'Tahrirlangan', 'Tarix', 'simple', 'ready', 10),
  ('d0000000-0000-0000-0000-000000000003', '5e000000-0000-0000-0000-000000000001', 'Eski taqdimot', 'Adabiyot', 'simple', 'ready', 10),
  ('d0000000-0000-0000-0000-000000000004', '5e000000-0000-0000-0000-000000000001', 'Import', 'PPTX', 'simple', 'ready', 1),
  ('d0000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000001', 'Fayl bilan', 'Kimyo', 'simple', 'ready', 10),
  ('d0000000-0000-0000-0000-000000000006', '5e000000-0000-0000-0000-000000000001', 'Qimor', 'Kazino strategiyalari', 'simple', 'ready', 10),
  ('d0000000-0000-0000-0000-000000000007', '0f000000-0000-0000-0000-000000000002', 'Begona', 'Fizika', 'simple', 'ready', 10);

insert into public.generation_jobs (presentation_id, owner_id, idempotency_key, status, stage, progress)
select id, owner_id, 'job-' || id, 'succeeded', 'ready', 100 from public.presentations
 where id <> 'd0000000-0000-0000-0000-000000000004' and owner_id in ('5e000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000002');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
insert into public.slides (id, presentation_id, owner_id, position, title)
select gen_random_uuid(), id, owner_id, 0, 'Muqova' from public.presentations where owner_id in ('5e000000-0000-0000-0000-000000000001', '0f000000-0000-0000-0000-000000000002');
insert into public.slide_elements (slide_id, presentation_id, owner_id, type, x, y, width, height, content, style)
select s.id, s.presentation_id, s.owner_id, 'text', 10, 10, 400, 60,
       jsonb_build_object('text', case when p.id = 'd0000000-0000-0000-0000-000000000006' then 'Kazino va stavka sirlari' else 'Kirish' end), '{}'::jsonb
  from public.slides s join public.presentations p on p.id = s.presentation_id;
insert into public.presentation_assets (presentation_id, owner_id, kind, storage_bucket, storage_path)
values ('d0000000-0000-0000-0000-000000000005', '5e000000-0000-0000-0000-000000000001', 'upload', 'user-uploads', '5e000000-0000-0000-0000-000000000001/x/kitob.pdf');
reset role;

-- The legacy deck predates the trail.
delete from public.presentation_revision_state where presentation_id = 'd0000000-0000-0000-0000-000000000003';

select is((select system_edits from public.presentation_revision_state where presentation_id = 'd0000000-0000-0000-0000-000000000001') > 0,
  true, 'the generator''s writes are on the trail as the system''s');
select is((select imported from public.presentation_revision_state where presentation_id = 'd0000000-0000-0000-0000-000000000004'),
  true, 'slides written without a generation job are an import');

-- ------------------------------------------------------------- the seller edits one deck
set local role authenticated;
set local request.jwt.claims = '{"sub":"5e000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.slide_elements set content = jsonb_build_object('text', 'O‘zgartirildi') where presentation_id = 'd0000000-0000-0000-0000-000000000002';
select is((select user_edits from public.presentation_revision_state where presentation_id = 'd0000000-0000-0000-0000-000000000002') > 0,
  true, 'an edit the seller makes straight to the table is on the trail');

select is((public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000001') ->> 'auto')::boolean, true, 'an untouched deck made here is approved automatically');
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000002') -> 'review' @> '[{"code":"manually_edited"}]', 'an edited deck goes to review');
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000003') -> 'review' @> '[{"code":"untracked"}]', 'a deck older than the trail goes to review');
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000004') -> 'review' @> '[{"code":"not_generated_in_app"}]', 'an imported deck goes to review');
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000005') -> 'review' @> '[{"code":"external_files"}]', 'a deck fed uploaded files goes to review');
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000006') -> 'review' @> '[{"code":"policy_terms"}]', 'a deck with blocked words goes to review');
select is((public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000007') ->> 'can_publish')::boolean, false, 'somebody else''s deck cannot be sold');

-- ------------------------------------------------------------- publishing
select lives_ok($$ select public.marketplace_fast_draft('d0000000-0000-0000-0000-000000000001') $$, 'the draft listing opens');
select is((public.marketplace_fast_draft('d0000000-0000-0000-0000-000000000001') ->> 'product_id'),
          (select id::text from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'),
          'opening it again is the same draft');
select is((select title from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'),
          'Toza taqdimot', 'the draft takes the deck''s own title');
select throws_ok($$ insert into public.marketplace_products (seller_id, material_type, title, status, base_price, source_presentation_id)
                    values ('5e000000-0000-0000-0000-000000000001', 'presentation', 'O‘g‘irlangan', 'draft', 0, 'd0000000-0000-0000-0000-000000000007') $$,
  '42501', null, 'a listing cannot point at somebody else''s deck');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(format('select public.marketplace_fast_publish_finish(%L, %L, %L, 500, %L, null, null, %L, 1000)',
  '5e000000-0000-0000-0000-000000000001', (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'),
  'Iqlim o‘zgarishi', '', '5e000000-0000-0000-0000-000000000001/x/deck.pptx'), '22023', null, 'a price below the floor is refused');
select is((public.marketplace_fast_publish_finish('5e000000-0000-0000-0000-000000000001',
  (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'),
  'Iqlim o‘zgarishi', 15000, 'Tavsif', null, null,
  '5e000000-0000-0000-0000-000000000001/' || (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001') || '/deck.pptx', 120000) ->> 'status'),
  'approved', 'publishing it puts it live at once');
select is((select approval_source from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'), 'auto', '...marked as approved by the rules');
select is((select decision from public.marketplace_auto_approval_events order by id desc limit 1), 'auto_approved', '...and the decision is recorded');
select is((select count(*)::int from public.marketplace_product_files where kind = 'main'
            and product_id = (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001')),
          1, 'the server-made PPTX is its file');

set local role authenticated;
set local request.jwt.claims = '{"sub":"5e000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000001') -> 'blocking' @> '[{"code":"already_listed"}]', 'a deck has one live listing');

-- The edited deck goes to review.
select lives_ok($$ select public.marketplace_fast_draft('d0000000-0000-0000-0000-000000000002') $$, 'the edited deck opens a draft too');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.marketplace_fast_publish_finish('5e000000-0000-0000-0000-000000000001',
  (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000002'),
  'Tarix darsi', 9000, '', null, null, '5e000000-0000-0000-0000-000000000001/y/deck.pptx', 9000) ->> 'status'),
  'pending_review', 'an edited deck is listed for review, not live');

-- ------------------------------------------------------------- the seller cannot rewrite provenance
set local role authenticated;
set local request.jwt.claims = '{"sub":"5e000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.marketplace_products set approval_source = 'auto', moderation_note = 'ok'
 where source_presentation_id = 'd0000000-0000-0000-0000-000000000002';
select is((select approval_source from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000002'),
          'manual', 'a seller cannot mark their own listing as approved by the rules');

update public.marketplace_product_files set storage_path = '5e000000-0000-0000-0000-000000000001/z/boshqa.pptx'
 where product_id = (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001') and kind = 'main';
select is((select status::text from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'),
          'pending_review', 'swapping the file of a live listing sends it back to review');

update public.presentations set title = 'Yangi nom' where id = 'd0000000-0000-0000-0000-000000000006';
select is((select user_edits from public.presentation_revision_state where presentation_id = 'd0000000-0000-0000-0000-000000000006') > 0,
  true, 'renaming a deck is an edit');

-- ------------------------------------------------------------- moderation
set local request.jwt.claims = '{"sub":"ad000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(format('select public.admin_moderate_product(%L, %L)', (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'), 'suspend'),
  '22023', null, 'a suspension needs a reason');
select lives_ok(format('select public.admin_moderate_product(%L, %L, %L)', (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'), 'suspend', 'Mualliflik huquqi'),
  'an admin suspends a listing');
select is((select status::text from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000001'), 'hidden', 'a suspended listing is off sale');
select lives_ok(format('select public.admin_moderate_product(%L, %L, %L)', (select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000002'), 'request_changes', 'Muqovani almashtiring'),
  'an admin asks for changes');
select is((select rejection_reason from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000002'),
          'O‘zgartirish kerak: Muqovani almashtiring', '...which the seller reads as such');
select ok(jsonb_array_length(public.admin_listing_provenance((select id from public.marketplace_products where source_presentation_id = 'd0000000-0000-0000-0000-000000000002')) -> 'trail') > 0,
  'the moderator sees the deck''s trail');

set local request.jwt.claims = '{"sub":"5e000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.marketplace_fast_publish_check('d0000000-0000-0000-0000-000000000005') -> 'review' @> '[{"code":"seller_restricted"}]',
  'after a suspension the seller''s next listings go to review');

select * from finish();
rollback;

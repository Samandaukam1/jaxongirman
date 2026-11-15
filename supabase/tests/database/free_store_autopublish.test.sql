begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1a10000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated',
   'freeowner@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Free Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated',
   'freetaker@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Free Taker"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c3c30000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated',
   'oldapp@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Old App"}', now(), now());

-- Shipped switched off: a new game stays with its owner, and nothing is said.
select is((select value ->> 'enabled' from public.app_settings where key = 'games.store_autopublish'), 'false',
  'auto-publish ships switched off');
insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-0000000000f9', 'a1a10000-0000-0000-0000-0000000000f1', 'Hali yopiq', 'draft', 0);
select is((select store_autopublish from public.games where id = 'd4d40000-0000-0000-0000-0000000000f9'), 'off',
  'switched off, a new game is not armed');
select is((select count(*)::int from public.notifications where entity_id = 'd4d40000-0000-0000-0000-0000000000f9'), 0,
  'and its owner is told nothing');

-- From here on, switched on.
update public.app_settings set value = '{"enabled": true}' where key = 'games.store_autopublish';

-- A game made before auto-publish existed: switched off by hand, as the column default leaves old rows.
insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-0000000000f0', 'a1a10000-0000-0000-0000-0000000000f1', 'Eski o‘yin', 'draft', 0);
update public.games set store_autopublish = 'off', store_autopublish_at = null where id = 'd4d40000-0000-0000-0000-0000000000f0';

-- A new game: armed on insert, owner told at once.
insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-0000000000f1', 'a1a10000-0000-0000-0000-0000000000f1', 'Tarix viktorinasi', 'draft', 0);
select is((select store_autopublish from public.games where id = 'd4d40000-0000-0000-0000-0000000000f1'), 'pending', 'a new game is set to go to the store');
select ok((select store_autopublish_at between now() + interval '59 minutes' and now() + interval '61 minutes'
           from public.games where id = 'd4d40000-0000-0000-0000-0000000000f1'), 'an hour from now');
select is((select count(*)::int from public.notifications where entity_id = 'd4d40000-0000-0000-0000-0000000000f1' and kind = 'game_store_autopublish'), 1,
  'the owner is told straight away');

insert into public.game_questions (id, game_id, owner_id, position, type, prompt, config)
values ('e5e50000-0000-0000-0000-0000000000f1', 'd4d40000-0000-0000-0000-0000000000f1', 'a1a10000-0000-0000-0000-0000000000f1',
  0, 'single_choice', 'Amir Temur qachon tug‘ilgan?', '{"options":[{"id":"a","text":"1336"},{"id":"b","text":"1405"}],"correct":"a"}');
update public.games set status = 'ready' where id = 'd4d40000-0000-0000-0000-0000000000f1';

select is(public.game_store_publish_due(), 0, 'nothing goes before its hour');
update public.games set store_autopublish_at = now() - interval '1 minute' where id in ('d4d40000-0000-0000-0000-0000000000f1', 'd4d40000-0000-0000-0000-0000000000f0');
update public.app_settings set value = '{"enabled": false}' where key = 'games.store_autopublish';
select is(public.game_store_publish_due(), 0, 'switched off again, a game whose hour is up waits');
update public.app_settings set value = '{"enabled": true}' where key = 'games.store_autopublish';
select is(public.game_store_publish_due(), 1, 'once the hour is up, the new game goes — and only it');
select is((select row(status, base_price, approval_source)::text from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1'),
  '(approved,0,auto)', 'listed, free, approved automatically');
select is((select store_autopublish from public.games where id = 'd4d40000-0000-0000-0000-0000000000f0'), 'off', 'a game from before is left alone');
select is(public.game_store_publish_due(), 0, 'and it is listed once');

-- Taking a free game: an entitlement, no purchase, no payment.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-0000000000f2', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select public.marketplace_claim_free((select id from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1')) ->> 'granted'),
  'true', 'anyone may take a free game');
reset role;
select is((select row(source, purchase_id is null)::text from public.purchase_entitlements where user_id = 'b2b20000-0000-0000-0000-0000000000f2'),
  '(free,t)', 'as a free entitlement with no purchase behind it');
select is((select count(*)::int from public.marketplace_purchases where buyer_id = 'b2b20000-0000-0000-0000-0000000000f2'), 0, 'no sale is recorded');
select ok(public.game_can_host('d4d40000-0000-0000-0000-0000000000f1', 'b2b20000-0000-0000-0000-0000000000f2'), 'and the taker may host it');
select throws_ok(
  $$insert into public.purchase_entitlements (purchase_id, user_id, product_id, source)
    values (null, 'a1a10000-0000-0000-0000-0000000000f1', (select id from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1'), 'purchase')$$,
  '23514', null, 'a bought entitlement still needs its purchase');

-- An app from before free listings only knows "Sotib olish": no 0 so‘m order or payment.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c3c30000-0000-0000-0000-0000000000f3', true);
select throws_ok(format('select public.order_create_marketplace(%L, %L, true)',
    (select id from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1'), 'android'),
  '22023', 'Bu mahsulot tekin. Uni olish uchun ilovani yangilang.', 'a free listing cannot be ordered and paid for');
reset role;
select throws_ok(format(
    $$insert into public.payment_transactions (buyer_id, product_id, seller_id, base_price, idempotency_key)
      values (%L, %L, %L, 0, 'free-1')$$,
    'c3c30000-0000-0000-0000-0000000000f3',
    (select id from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1'),
    'a1a10000-0000-0000-0000-0000000000f1'),
  '22023', 'Bu mahsulot tekin. Uni olish uchun ilovani yangilang.', 'nor can a card checkout be opened for it');

-- A paid listing cannot be taken; a stopped game stays home.
insert into public.games (id, owner_id, title, status, question_count)
values ('d4d40000-0000-0000-0000-0000000000f2', 'a1a10000-0000-0000-0000-0000000000f1', 'Pullik o‘yin', 'ready', 1),
       ('d4d40000-0000-0000-0000-0000000000f3', 'a1a10000-0000-0000-0000-0000000000f1', 'Shaxsiy o‘yin', 'ready', 1);
insert into public.marketplace_products (seller_id, material_type, title, status, base_price, content_units, game_id)
values ('a1a10000-0000-0000-0000-0000000000f1', 'game', 'Pullik o‘yin', 'approved', 5000, 1, 'd4d40000-0000-0000-0000-0000000000f2');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-0000000000f2', true);
select throws_ok(format('select public.marketplace_claim_free(%L)',
    (select id from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f2')),
  '22023', null, 'a priced listing is not free');
select set_config('request.jwt.claim.sub', 'a1a10000-0000-0000-0000-0000000000f1', true);
select is((select public.game_store_autopublish_stop('d4d40000-0000-0000-0000-0000000000f3') ->> 'state'), 'stopped', 'the owner can keep a game home');

-- Pricing the auto listing reprices it in place rather than listing the game twice.
select is((select public.game_store_reprice('d4d40000-0000-0000-0000-0000000000f1', 7000) ->> 'status'), 'pending_review',
  'a price sends the auto listing back to review');
reset role;
select is((select count(*)::int from public.marketplace_products where game_id = 'd4d40000-0000-0000-0000-0000000000f1'), 1,
  'and the game is still listed once');

select * from finish();
rollback;

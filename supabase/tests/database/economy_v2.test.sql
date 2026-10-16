begin;

create extension if not exists pgtap with schema extensions;
select plan(73);

/*
 * The second J Tanga economy, end to end in one transaction: the welcome
 * pages, a deck priced by its pages, the 10-page product, the three tariffs
 * with their month of J Tanga, rollover, expiry, PREMIUM's count carried
 * into a coin tariff, duplicate payment callbacks, transfers, and a new
 * price version that leaves old charges alone.
 *
 *   A  new account, spends its welcome, then pays per page
 *   B  re-signs up with A's address after deleting an account: no 2nd welcome
 *   C  buys OSON, spends, then MAZZA (rollover)
 *   D  holds PREMIUM, switches to OSON (count → J Tanga)
 *   E  buys BEMALOL
 *   S  super admin
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'a@example.com', '', now(), '{}', '{"full_name":"A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'c@example.com', '', now(), '{}', '{"full_name":"C"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'd@example.com', '', now(), '{}', '{"full_name":"D"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', 'e@example.com', '', now(), '{}', '{"full_name":"E"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '50000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 's@example.com', '', now(), '{}', '{"full_name":"S"}', now(), now());

insert into public.user_roles (user_id, role, granted_by) values
  ('50000000-0000-0000-0000-000000000005', 'admin', '50000000-0000-0000-0000-000000000005'),
  ('50000000-0000-0000-0000-000000000005', 'super_admin', '50000000-0000-0000-0000-000000000005');

-- ------------------------------------------------------------------ welcome
select is((select pages_remaining from public.presentation_credit_grants
            where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          30, 'a new account is given 30 welcome pages');
select is((select count(*)::int from public.presentation_credit_ledger
            where user_id = 'a0000000-0000-0000-0000-00000000000a' and kind = 'grant'),
          1, 'the welcome is written to the page ledger once');
select is(public.grant_welcome_pages('a0000000-0000-0000-0000-00000000000a', 'a@example.com', true),
          false, 'a second welcome for the same account is refused, even forced');

-- An account deleted and created again with the same address.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'A@Example.com ', '', now(), '{}', '{}', now(), now());
select is((select count(*)::int from public.presentation_credit_grants where user_id = 'b0000000-0000-0000-0000-00000000000b'),
          0, 'the same address, in another account and another case, gets no second welcome');

-- --------------------------------------------------- quoting with the welcome
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is((public.presentation_quote(10) ->> 'welcome_pages')::int, 10, 'a 10-page deck comes from welcome pages');
select is((public.presentation_quote(10) ->> 'coins')::int, 0, '...and costs no J Tanga');
select is((public.my_wallet() -> 'welcome' ->> 'decks')::int, 3, 'the wallet says three free decks');
select throws_ok($$ select public.presentation_quote(2) $$, '22023', null, 'fewer pages than the minimum are refused');

-- A free deck is at most ten pages: three ten-page decks, never one of thirty.
select throws_ok($$
  select * from public.start_generation('a0f00000-0000-0000-0000-00000000000f', 'Katta mavzu', 'Katta', 'simple', 15,
    null, null, '{}', 'a-deck-15')
$$, '22023', 'Bepul taqdimot maksimum 10 sahifali bo‘lishi mumkin.', 'a 15-page deck on welcome pages is refused');
select is((select count(*)::int from public.presentations where id = 'a0f00000-0000-0000-0000-00000000000f'), 0, '...and leaves nothing behind');

select lives_ok($$
  select * from public.start_generation('a1000000-0000-0000-0000-000000000001', 'Birinchi mavzu', 'Birinchi', 'simple', 10,
    null, null, '{}', 'a-deck-1')
$$, 'a 10-page deck starts on welcome pages');
select is((select pages_remaining from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          20, '10 pages are taken from the welcome');
select is((select pages_reserved from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          10, '...and held while the deck is made');
select is((select reserved_credits from public.generation_jobs where idempotency_key = 'a-deck-1'), 0, 'no J Tanga are reserved');
select is((public.my_wallet() -> 'welcome' ->> 'decks')::int, 2,
          'with 20 pages left the wallet promises two more free decks');

-- The same request again is the same deck.
select is((select count(*)::int from public.start_generation('a1000000-0000-0000-0000-000000000001', 'Birinchi mavzu', 'Birinchi', 'simple', 10,
    null, null, '{}', 'a-deck-1')), 1, 'a repeated start returns the first job');
select is((select pages_remaining from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          20, '...and takes nothing more');

set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.settle_generation((select id from public.generation_jobs where idempotency_key = 'a-deck-1'), 999, 0) $$,
  'the finished deck settles');
select is((select pages_reserved from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          0, 'settled pages are spent, not held');
select is((select actual_credits from public.generation_jobs where idempotency_key = 'a-deck-1'), 0,
          'a page-priced job is charged its quote, not what the generator reports');

-- A second free deck that fails gives its pages back.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$ select * from public.start_generation('a2000000-0000-0000-0000-000000000002', 'Ikkinchi mavzu', 'Ikkinchi', 'simple', 10, null, null, '{}', 'a-deck-2') $$,
  'a second free deck takes welcome pages');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.fail_generation((select id from public.generation_jobs where idempotency_key = 'a-deck-2'), 'boom', 'failed') $$,
  'the deck fails');
select is((select pages_remaining from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          20, 'a failed deck returns its welcome pages');
select lives_ok($$ select public.fail_generation((select id from public.generation_jobs where idempotency_key = 'a-deck-2'), 'boom', 'failed') $$,
  'failing it twice is harmless');
select is((select pages_remaining from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'welcome'),
          20, '...and returns nothing twice');

-- Use the rest, then pay in J Tanga at the no-tariff rate (OSON's).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$ select * from public.start_generation('a3000000-0000-0000-0000-000000000003', 'Uchinchi mavzu', 'Uchinchi', 'simple', 10, null, null, '{}', 'a-deck-3') $$,
  'the second free deck');
select lives_ok($$ select * from public.start_generation('a3100000-0000-0000-0000-000000000031', 'Uchinchi mavzu b', 'Uchinchi b', 'simple', 10, null, null, '{}', 'a-deck-3b') $$,
  'the third free deck takes the last welcome pages');
select is((public.presentation_quote(10) ->> 'coins')::int, 123, 'without a tariff a 10-page deck is 123 J Tanga (OSON''s rate, rounded up)');
select is((public.presentation_quote(10) ->> 'welcome_pages')::int, 0, '...with no welcome pages left');

set local role postgres;
update public.credit_wallets set balance = 100 where user_id = 'a0000000-0000-0000-0000-00000000000a';
set local role authenticated;
select throws_ok($$ select * from public.start_generation('a4000000-0000-0000-0000-000000000004', 'To''rtinchi', 'T', 'simple', 10, null, null, '{}', 'a-deck-4') $$,
  'P0001', 'insufficient credits', 'too few J Tanga: refused, nothing written');
select is((select count(*)::int from public.presentations where id = 'a4000000-0000-0000-0000-000000000004'), 0, 'no deck row is left behind');

set local role postgres;
update public.credit_wallets set balance = 200 where user_id = 'a0000000-0000-0000-0000-00000000000a';
set local role authenticated;
select throws_ok($$ select * from public.start_generation('a5000000-0000-0000-0000-000000000005', 'Beshinchi', 'B', 'simple', 10, null, null, '{}', 'a-deck-5', null, null, null, 100) $$,
  'P0001', null, 'a price above what was confirmed asks again instead of charging');
select lives_ok($$ select * from public.start_generation('a6000000-0000-0000-0000-000000000006', 'Oltinchi', 'O', 'simple', 10, null, null, '{}', 'a-deck-6', null, null, null, 123) $$,
  'the confirmed price starts the deck');
select is((select balance from public.credit_wallets where user_id = 'a0000000-0000-0000-0000-00000000000a'), 77, '123 J Tanga are held');

-- ---------------------------------------------------- the 10-page product
select lives_ok($$ select public.order_create_jcoin((select id from public.coin_packages where code = 'pages_10'), 'web') $$,
  'the 10-page product can be ordered');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.order_fulfil((select id from public.orders where user_id = 'a0000000-0000-0000-0000-00000000000a' and purpose = 'jcoin' order by created_at desc limit 1)) ->> 'presentation_pages_granted')::int,
          10, 'paying for it grants exactly 10 presentation pages');
select is((public.order_fulfil((select id from public.orders where user_id = 'a0000000-0000-0000-0000-00000000000a' and purpose = 'jcoin' order by created_at desc limit 1)) ->> 'already')::boolean,
          true, 'a repeated payment callback is recognised');
select is((select sum(pages_granted)::int from public.presentation_credit_grants where user_id = 'a0000000-0000-0000-0000-00000000000a' and source = 'purchase'),
          10, '...and grants nothing more');
select is((select balance from public.credit_wallets where user_id = 'a0000000-0000-0000-0000-00000000000a'), 77, 'pages are not J Tanga: the balance is unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((public.presentation_quote(12) ->> 'purchased_pages')::int, 10, 'bought pages come before J Tanga');
select is((public.presentation_quote(12) ->> 'coins')::int, 25, '...and the 2 pages left cost 25 J Tanga');

-- ---------------------------------------------------------------- tariffs
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select lives_ok($$ select public.order_create_subscription(p_plan_code => 'oson', p_platform => 'web', p_restart => false) $$, 'OSON can be ordered');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.order_fulfil((select id from public.orders where user_id = 'c0000000-0000-0000-0000-00000000000c' and purpose = 'subscription' and reference_code = 'oson')) $$,
  'and paid for');
select is((select count(*)::int from public.user_subscriptions where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active'),
          1, 'paying writes the membership (the branch 202609010900 had lost)');
select is((select remaining from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active'),
          1230, 'OSON grants a month of 1 230 J Tanga — ten 10-page decks at 123');
select is((select balance from public.credit_wallets where user_id = 'c0000000-0000-0000-0000-00000000000c'),
          100 + 1230, 'the J Tanga are in the wallet');
select is((public.order_fulfil((select id from public.orders where user_id = 'c0000000-0000-0000-0000-00000000000c' and purpose = 'subscription' and reference_code = 'oson')) ->> 'already')::boolean,
          true, 'a repeated subscription callback grants nothing');
select is((select count(*)::int from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c'), 1, '...not even a second month');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
-- Spend the welcome first so the next deck is paid in J Tanga.
set local role postgres;
update public.presentation_credit_grants set pages_remaining = 0 where user_id = 'c0000000-0000-0000-0000-00000000000c';
set local role authenticated;
select is((public.presentation_quote(10) ->> 'coins')::int, 123, 'an OSON deck of 10 pages is 123 J Tanga');
select lives_ok($$ select * from public.start_generation('c1000000-0000-0000-0000-000000000001', 'Tarif mavzu', 'T', 'simple', 10, null, null, '{}', 'c-deck-1') $$,
  'an OSON member starts a deck');
select is((select remaining from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active'),
          1230 - 123, 'it is paid from the tariff''s J Tanga first');
select throws_ok($$ select public.transfer_credits('a0000000-0000-0000-0000-00000000000a', 200, 'sovg''a', 'c-transfer') $$,
  'P0001', null, 'the tariff''s J Tanga cannot be sent to somebody else');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.settle_generation((select id from public.generation_jobs where idempotency_key = 'c-deck-1'), 0, 0) $$, 'the deck settles');

-- MAZZA bought while OSON is running: what is left of OSON comes along.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select lives_ok($$ select public.order_create_subscription(p_plan_code => 'mazza', p_platform => 'web', p_restart => false) $$, 'MAZZA can be ordered on top');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.order_fulfil((select id from public.orders where user_id = 'c0000000-0000-0000-0000-00000000000c' and reference_code = 'mazza')) $$, 'and paid for');
select is((select rolled_in from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active'),
          1107, 'OSON''s 1 107 left roll into the new month');
select is((select remaining from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active'),
          1107 + 1695, '...beside MAZZA''s 1 695');
select is((select status from public.coin_lots where user_id = 'c0000000-0000-0000-0000-00000000000c' and plan_code = 'oson'),
          'rolled', 'the OSON month is closed as rolled, not burned');

-- The month ends unrenewed.
update public.coin_lots set expires_at = now() - interval '1 second'
 where user_id = 'c0000000-0000-0000-0000-00000000000c' and status = 'active';
select is(public.expire_coin_lots('c0000000-0000-0000-0000-00000000000c'), 1, 'an unrenewed month expires');
select is((select balance from public.credit_wallets where user_id = 'c0000000-0000-0000-0000-00000000000c'),
          100, 'its J Tanga burn; what was bought or granted otherwise stays');
select is((select amount from public.credit_transactions where user_id = 'c0000000-0000-0000-0000-00000000000c' and type = 'plan_expiry'),
          -(1107 + 1695), 'the burn is on the ledger');

-- PREMIUM's weekly count, three decks unused, carried into OSON.
insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select 'd0000000-0000-0000-0000-00000000000d', id, 'active', now() - interval '5 days', now() + interval '25 days',
       jsonb_build_object('features', jsonb_build_object('presentation_weekly', jsonb_build_object('enabled', true, 'limit', 4, 'period', 'week')))
  from public.subscription_plans where code = 'premium_monthly';
insert into public.subscription_usage (user_id, feature_key, period_start, used)
values ('d0000000-0000-0000-0000-00000000000d', 'presentation_weekly',
        public.usage_period_start('d0000000-0000-0000-0000-00000000000d', 'week'), 1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select is(public.presentation_quote(10) ->> 'mode', 'quota', 'a PREMIUM member is still on the weekly count');
select lives_ok($$ select public.order_create_subscription(p_plan_code => 'oson', p_platform => 'web', p_restart => false) $$, 'and may move to OSON');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.order_fulfil((select id from public.orders where user_id = 'd0000000-0000-0000-0000-00000000000d' and reference_code = 'oson')) $$, 'paid');
select is((select rolled_in from public.coin_lots where user_id = 'd0000000-0000-0000-0000-00000000000d' and status = 'active'),
          3 * 123, 'three unused PREMIUM decks come along as 3 × 123 J Tanga');
select is((select remaining from public.coin_lots where user_id = 'd0000000-0000-0000-0000-00000000000d' and status = 'active'),
          1230 + 369, '...beside OSON''s month');

-- BEMALOL's rate.
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
select lives_ok($$ select public.order_create_subscription(p_plan_code => 'bemalol', p_platform => 'web', p_restart => false) $$, 'BEMALOL can be ordered');
set local role postgres;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ select public.order_fulfil((select id from public.orders where user_id = 'e0000000-0000-0000-0000-00000000000e' and reference_code = 'bemalol')) $$, 'paid');
update public.presentation_credit_grants set pages_remaining = 0 where user_id = 'e0000000-0000-0000-0000-00000000000e';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
select is((public.presentation_quote(10) ->> 'coins')::int, 100, 'a BEMALOL deck of 10 pages is 100 J Tanga');

-- --------------------------------------------------------- a new price
select throws_ok($$ select public.admin_publish_economy('{}', '{"presentation":{"coins_per_unit":12}}', 'test') $$,
  '42501', null, 'only a super admin publishes prices');
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((public.admin_publish_economy('{}', '{"presentation":{"coins_per_unit":12}}', 'test') ->> 'version')::int,
          2, 'a super admin publishes version 2');
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
select is((public.presentation_quote(10) ->> 'coins')::int, 120, 'new quotes use the new price');
set local role postgres;
select is((select (pricing ->> 'coins')::int from public.generation_jobs where idempotency_key = 'a-deck-6'),
          123, 'a deck already started keeps the price it was quoted');

select * from finish();
rollback;

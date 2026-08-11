begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa110000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated',
   'orderbuyer@example.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Buyer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb220000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated',
   'orderseller@example.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Seller"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cc330000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated',
   'orderstranger@example.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Stranger"}', now(), now());

insert into public.marketplace_products (
  id, seller_id, material_type, title, description, status, base_price, published_at
) values (
  'dd440000-0000-0000-0000-0000000000d4', 'bb220000-0000-0000-0000-0000000000d2',
  'essay', 'Buyurtma sinovi', 'Sinov', 'approved', 10000, now()
);

insert into public.coin_packages (id, code, label, coins, bonus_coins, price_amount)
values ('ee550000-0000-0000-0000-0000000000d5', 'sinov_50', '50 J', 50, 5, 25000);

-- The brief's worked example: 10 000 som, 20% both sides.
update public.commission_config set buyer_fee_rate = 20, seller_fee_rate = 20 where scope = 'marketplace';

-- --------------------------------------------------------- order numbering --
select matches(public.next_order_number(), '^JAX-[0-9]{4}-[0-9]{6}$',
  'an order number is JAX-YYYY-NNNNNN');
select isnt(public.next_order_number(), public.next_order_number(),
  'and two consecutive numbers never collide');

-- ------------------------------------------------------- the state machine --
select ok(public.order_transition_allowed('pending', 'processing'), 'pending may start processing');
select ok(public.order_transition_allowed('processing', 'paid'), 'processing may become paid');
select ok(public.order_transition_allowed('paid', 'refunded'), 'a paid order may be refunded');
-- The transition the brief names as impossible.
select ok(not public.order_transition_allowed('paid', 'pending'), 'paid may never go back to pending');
select ok(not public.order_transition_allowed('paid', 'failed'), 'nor to failed');
select ok(not public.order_transition_allowed('pending', 'paid'),
  'and nothing reaches paid without going through processing');
select ok(not public.order_transition_allowed('refunded', 'paid'), 'a refund is terminal');
select ok(not public.order_transition_allowed('expired', 'processing'), 'an expired order cannot resume');

-- -------------------------------------------------------- client privilege --
-- Every figure that decides what is owed is server-written. These grants are
-- the difference between "the client should not" and "the client cannot".
select ok(not has_table_privilege('authenticated', 'public.orders', 'INSERT'),
  'a client cannot create an order row directly');
select ok(not has_table_privilege('authenticated', 'public.orders', 'UPDATE'),
  'nor edit one — so no amount and no status is theirs to write');
select ok(has_table_privilege('authenticated', 'public.orders', 'SELECT'),
  'reading their own is all a client gets');
select ok(not has_function_privilege('authenticated', 'public.order_fulfil(uuid, text, text, integer)', 'EXECUTE'),
  'fulfilment is unreachable from a client: only the code holding the provider answer may grant');
select ok(not has_function_privilege('authenticated', 'public.order_advance(uuid, public.order_status, text, text)', 'EXECUTE'),
  'and so is the status writer');
select ok(not has_function_privilege('anon', 'public.order_create_marketplace(uuid, text)', 'EXECUTE'),
  'opening an order requires an account');

-- ------------------------------------------------------------ server pricing --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-0000000000d1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table t_mk as
  select public.order_create_marketplace('dd440000-0000-0000-0000-0000000000d4'::uuid, 'android') as payload;

-- The brief's expected arithmetic, checked figure by figure.
select is((select (payload ->> 'subtotal')::integer from t_mk), 10000, 'subtotal is the published price');
select is((select (payload ->> 'buyer_fee')::integer from t_mk), 2000, 'buyer fee is 20% of it');
select is((select (payload ->> 'total_amount')::integer from t_mk), 12000, 'and the buyer pays 12 000');
select is(
  (select seller_fee from public.orders where id = (select (payload ->> 'order_id')::uuid from t_mk)),
  2000, 'the seller fee is 20%');
select is(
  (select seller_net from public.orders where id = (select (payload ->> 'order_id')::uuid from t_mk)),
  8000, 'the seller nets 8 000');
select is(
  (select platform_revenue from public.orders where id = (select (payload ->> 'order_id')::uuid from t_mk)),
  4000, 'and the platform takes both fees: 4 000');
select is((select payload ->> 'purpose' from t_mk), 'marketplace_reference',
  'an essay files under the reference purpose');

-- Rates are snapshotted, so tomorrow's change cannot rewrite today's agreement.
-- Changing them requires stepping out of the client role, which is itself the
-- point: a signed-in caller has no privilege to move the platform's cut.
select throws_ok(
  $$update public.commission_config set buyer_fee_rate = 50 where scope = 'marketplace'$$,
  '42501', null,
  'a client cannot change the commission rate'
);
reset role;
update public.commission_config set buyer_fee_rate = 50 where scope = 'marketplace';
select is(
  (select buyer_fee_rate from public.orders where id = (select (payload ->> 'order_id')::uuid from t_mk)),
  20.00, 'a later rate change does not rewrite an existing order');
update public.commission_config set buyer_fee_rate = 20 where scope = 'marketplace';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-0000000000d1', true);

-- Pressing pay twice is the same order, not a second one.
select is(
  (select (public.order_create_marketplace('dd440000-0000-0000-0000-0000000000d4'::uuid, 'android')) ->> 'order_id'),
  (select payload ->> 'order_id' from t_mk),
  'a double tap reuses the open order');
select is(
  (select count(*)::integer from public.orders where user_id = 'aa110000-0000-0000-0000-0000000000d1'),
  1, 'so exactly one order exists');

-- ----------------------------------------------------------------- J Coin --
create temporary table t_coin as
  select public.order_create_jcoin('ee550000-0000-0000-0000-0000000000d5'::uuid, 'android') as payload;
select is((select (payload ->> 'total_amount')::integer from t_coin), 25000,
  'a coin order charges the published package price');
select is(
  (select buyer_fee from public.orders where id = (select (payload ->> 'order_id')::uuid from t_coin)),
  0, 'and takes no commission — there is no seller to split with');

-- ------------------------------------------------------------------- RLS --
select set_config('request.jwt.claim.sub', 'cc330000-0000-0000-0000-0000000000d3', true);
select is((select count(*)::integer from public.orders), 0,
  'a stranger sees nobody else''s orders');
select set_config('request.jwt.claim.sub', 'bb220000-0000-0000-0000-0000000000d2', true);
select is((select count(*)::integer from public.orders), 1,
  'a seller sees the order that bought their material, and only that');
select is(
  (select count(*)::integer from public.orders where purpose = 'jcoin'),
  0, 'and nothing about the buyer''s unrelated purchases');

-- ------------------------------------------------------------ fulfilment --
reset role;

select is(
  (public.order_fulfil((select (payload ->> 'order_id')::uuid from t_coin), 'receipt-1', 'txn-1', 0)) ->> 'coins_granted',
  '55', 'fulfilling a coin order grants the package plus its bonus');
select is(
  (select balance from public.credit_wallets where user_id = 'aa110000-0000-0000-0000-0000000000d1'),
  155, 'the wallet moved by exactly that, on top of the welcome credits');
select is(
  (select status::text from public.orders where id = (select (payload ->> 'order_id')::uuid from t_coin)),
  'paid', 'and the order is paid');

-- The property the whole design exists for: a retried provider callback is
-- harmless. Payme retrying, a lost response, a double-delivered webhook.
select is(
  (public.order_fulfil((select (payload ->> 'order_id')::uuid from t_coin), 'receipt-1', 'txn-1', 0)) ->> 'already',
  'true', 'a repeated fulfilment reports itself already done');
select is(
  (select balance from public.credit_wallets where user_id = 'aa110000-0000-0000-0000-0000000000d1'),
  155, 'and grants nothing a second time');
select is(
  (select count(*)::integer from public.credit_transactions
   where user_id = 'aa110000-0000-0000-0000-0000000000d1' and type = 'coin_purchase'),
  1, 'leaving exactly one ledger row for the purchase');

select is(
  (select count(*)::integer from public.notifications
   where user_id = 'aa110000-0000-0000-0000-0000000000d1' and kind = 'order_paid'),
  1, 'and one notification, not two');

-- A row that does not add up cannot be written, whichever code path tried.
select throws_ok(
  $$insert into public.orders (user_id, purpose, coin_package_id, subtotal, buyer_fee, total_amount, seller_net)
    values ('aa110000-0000-0000-0000-0000000000d1', 'jcoin', 'ee550000-0000-0000-0000-0000000000d5', 100, 20, 999, 100)$$,
  '23514', null,
  'the arithmetic is a constraint: a total that does not equal subtotal plus fee is rejected'
);

select finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(70);

/*
 * Selling in the store for J Tanga, and the fee on J Tanga transfers
 * (202611200200).
 *
 * The rules under test: the buyer pays the coin price, the seller receives it
 * less the store fee, the platform's share is its own row, and the three sum to
 * zero; a purchase is one atomic step that is idempotent, refuses one's own
 * listing, a second purchase, a blocked account, an unapproved listing and a
 * short balance, and never spends a tariff's coins. A transfer's fee comes out
 * of what the recipient receives, rounded half up, with a minimum, and 0
 * percent turns it off.
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'coinseller@example.com', '', now(), '{}', '{"full_name":"Coin Seller"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'coinbuyer@example.com', '', now(), '{}', '{"full_name":"Coin Buyer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'coinpoor@example.com', '', now(), '{}', '{"full_name":"Coin Poor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'coinblocked@example.com', '', now(), '{}', '{"full_name":"Coin Blocked"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'coinplan@example.com', '', now(), '{}', '{"full_name":"Coin Plan"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'coinsuper@example.com', '', now(), '{}', '{"full_name":"Coin Super"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'coinadmin@example.com', '', now(), '{}', '{"full_name":"Coin Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'coinbadseller@example.com', '', now(), '{}', '{"full_name":"Coin Bad Seller"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0150000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'coinfriend@example.com', '', now(), '{}', '{"full_name":"Coin Friend"}', now(), now());

insert into public.user_roles (user_id, role) values
  ('c0150000-0000-0000-0000-000000000006', 'super_admin'),
  ('c0150000-0000-0000-0000-000000000007', 'admin');

update public.profiles set status = 'blocked'
 where id in ('c0150000-0000-0000-0000-000000000004', 'c0150000-0000-0000-0000-000000000008');

update public.credit_wallets set balance = case user_id
    when 'c0150000-0000-0000-0000-000000000001' then 0
    when 'c0150000-0000-0000-0000-000000000002' then 1000
    when 'c0150000-0000-0000-0000-000000000003' then 100
    when 'c0150000-0000-0000-0000-000000000004' then 1000
    when 'c0150000-0000-0000-0000-000000000005' then 200
    else 0 end
 where user_id::text like 'c0150000-%';

-- This month's tariff: 150 of the planner's 200 J Tanga burn at the month's end.
insert into public.coin_lots (user_id, plan_code, granted, remaining, expires_at)
values ('c0150000-0000-0000-0000-000000000005', 'oson', 150, 150, now() + interval '10 days');

insert into public.marketplace_products (id, seller_id, material_type, title, status, base_price, coin_price, published_at) values
  ('c0151000-0000-0000-0000-000000000001', 'c0150000-0000-0000-0000-000000000001', 'presentation', 'Tanga taqdimoti', 'approved', 10000, 150, now()),
  ('c0151000-0000-0000-0000-000000000002', 'c0150000-0000-0000-0000-000000000001', 'presentation', 'Faqat so‘mga', 'approved', 10000, null, now()),
  ('c0151000-0000-0000-0000-000000000003', 'c0150000-0000-0000-0000-000000000001', 'presentation', 'Tekshiruvdagi', 'pending_review', 10000, 150, null),
  ('c0151000-0000-0000-0000-000000000004', 'c0150000-0000-0000-0000-000000000008', 'presentation', 'Bloklangan sotuvchi', 'approved', 10000, 150, now()),
  ('c0151000-0000-0000-0000-000000000005', 'c0150000-0000-0000-0000-000000000001', 'presentation', 'Tekin narsa', 'approved', 0, 150, now()),
  ('c0151000-0000-0000-0000-000000000006', 'c0150000-0000-0000-0000-000000000001', 'presentation', 'Arzon taqdimot', 'approved', 5000, 40, now());

-- ------------------------------------------------------------- the listing --
select is((select coin_price from public.marketplace_products where id = 'c0151000-0000-0000-0000-000000000005'), null,
  'a free listing carries no coin price: it is taken, not bought');
select throws_ok(
  $$update public.marketplace_products set coin_price = 0 where id = 'c0151000-0000-0000-0000-000000000001'$$,
  '23514', null, 'a coin price is a whole number of J Tanga above zero');

-- ---------------------------------------------------------------- the fees --
select is((public.coin_fee_quote('store', 150) ->> 'fee')::int, 30, 'the store fee ships at 20 percent of the coin price');
select is((public.coin_fee_quote('transfer', 100) ->> 'fee')::int, 0, 'the transfer fee ships switched off');

select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_set_coin_fees(true, 1, 0, 1, 0, 'ordinary admin')$$,
  '42501', 'forbidden', 'only a super admin sets what sellers and senders keep');
reset role;

select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000006","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_set_coin_fees(true, 120, 0, 1, 0, 'too much')$$,
  '22023', null, 'a fee above 100 percent is refused');
select throws_ok(
  $$select public.admin_set_coin_fees(true, 10, 5, 2.5, 1, '')$$,
  '22023', null, 'a fee change needs a reason for the audit log');
select lives_ok(
  $$select public.admin_set_coin_fees(true, 10, 5, 2.5, 1, 'Test: store 10% (min 5 J), transfers 2.5% (min 1 J)')$$,
  'a super admin sets both fees');
reset role;

select is((select (value ->> 'max_amount')::int from public.app_settings where key = 'coins.transfer'), 100000,
  'setting the fee leaves the transfer bounds as they were');
select is((select count(*)::int from public.admin_audit_logs where action = 'economy.coin_fees'
            and admin_id = 'c0150000-0000-0000-0000-000000000006'), 1, 'and is written to the audit log');

select is(public.coin_fee_quote('store', 150) - 'scope' - 'fee_min', '{"amount": 150, "fee": 15, "net": 135, "fee_percent": 10.00}'::jsonb,
  'fee math: 10 percent of 150 is 15, the seller keeps 135');
select is((public.coin_fee_quote('store', 30) ->> 'fee')::int, 5, 'the minimum fee applies when the percentage is smaller');
select is((public.coin_fee_quote('store', 155) ->> 'fee')::int, 16, 'rounding: 15.5 J rounds half up to 16');
select is((public.coin_fee_quote('store', 3) ->> 'fee')::int, 3, 'a fee never exceeds the amount it is taken from');
select is((public.coin_fee_quote('transfer', 100) ->> 'fee')::int, 3, 'rounding: 2.5 percent of 100 is 2.5, which rounds to 3');
select is((public.coin_fee_quote('transfer', 10) ->> 'fee')::int, 1, 'a transfer fee below the minimum is the minimum');

-- ----------------------------------------------------------- the purchase --
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((public.marketplace_coin_quote('c0151000-0000-0000-0000-000000000001') - 'product_id'),
  '{"coin_price": 150, "available": true, "owned": false, "own": false, "balance": 1000, "plan_coins": 0, "spendable": 1000, "balance_after": 850, "enough": true, "shortfall": 0}'::jsonb,
  'the quote shows the balance before and after');

select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-1', 150, false, 'android')$$,
  '42501', null, 'the refund policy must be agreed to, as for a so‘m purchase');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-1', 140, true, 'android')$$,
  '22023', 'J Tanga narxi o‘zgardi: endi 150 J. Qaytadan tasdiqlang.', 'a price the buyer was not shown is not charged');

select is((public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-1', 150, true, 'android') - 'purchase_id' - 'product_id'),
  '{"applied": true, "price": 150, "balance_before": 1000, "balance": 850}'::jsonb,
  'happy path: the buyer pays the coin price');
select ok(public.marketplace_has_entitlement('c0151000-0000-0000-0000-000000000001'),
  'and the listing is unlocked exactly as a so‘m purchase unlocks it');

select is((public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-1', 150, true, 'android') ->> 'applied')::boolean,
  false, 'idempotency: the same key again is the same purchase');
select is((public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-1', 150, true, 'android') ->> 'purchase_id'),
  (select id::text from public.marketplace_coin_purchases where idempotency_key = 'buy-1'),
  'and answers with the first purchase');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'buy-2', 150, true, 'android')$$,
  '22023', 'Bu mahsulot allaqachon sizda bor.', 'a second purchase of the same listing is refused');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000003', 'buy-3', 150, true, 'android')$$,
  '42501', 'Mahsulot sotuvda emas.', 'a listing still in review cannot be bought');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000002', 'buy-4', 150, true, 'android')$$,
  '22023', 'Bu mahsulot J Tangaga sotilmaydi.', 'a listing without a coin price is sold for so‘m only');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000004', 'buy-5', 150, true, 'android')$$,
  '42501', 'Mahsulot sotuvda emas.', 'a blocked seller receives no coins');
select is((select count(*)::int from public.coin_platform_fees), 0, 'the platform''s fee rows are for admins only');
reset role;

select is((select balance from public.credit_wallets where user_id = 'c0150000-0000-0000-0000-000000000002'), 850,
  'the buyer was charged once, whatever the retries');
select is((select balance from public.credit_wallets where user_id = 'c0150000-0000-0000-0000-000000000001'), 135,
  'the seller receives the price less the fee');
select is((select row(price, fee_amount, seller_net, fee_percent)::text from public.marketplace_coin_purchases where idempotency_key = 'buy-1'),
  '(150,15,135,10.00)', 'the purchase stores the fee it was made of');
select is((select array_agg(row(type, amount)::text order by amount) from public.credit_transactions
            where metadata ->> 'coin_purchase_id' = (select id::text from public.marketplace_coin_purchases where idempotency_key = 'buy-1')),
  array['(marketplace_spend,-150)', '(marketplace_earn,135)'], 'ledger: one row for the buyer, one for the seller');
select is((select row(source, amount, gross_amount)::text from public.coin_platform_fees
            where coin_purchase_id = (select id from public.marketplace_coin_purchases where idempotency_key = 'buy-1')),
  '(store_sale,15,150)', 'ledger: the platform''s share is its own row');
select is(
  (select sum(amount)::int from public.credit_transactions where metadata ->> 'coin_purchase_id' = (select id::text from public.marketplace_coin_purchases where idempotency_key = 'buy-1'))
  + (select sum(amount)::int from public.coin_platform_fees where coin_purchase_id = (select id from public.marketplace_coin_purchases where idempotency_key = 'buy-1')),
  0, 'buyer, seller and platform rows sum to zero: no coin is minted');
select is((select row(source, purchase_id is null, coin_purchase_id is not null)::text from public.purchase_entitlements
            where user_id = 'c0150000-0000-0000-0000-000000000002' and product_id = 'c0151000-0000-0000-0000-000000000001'),
  '(coins,t,t)', 'the entitlement names the coin purchase behind it');
select is((select sales_count from public.marketplace_products where id = 'c0151000-0000-0000-0000-000000000001'), 1,
  'the sale is counted once');
select is((select count(*)::int from public.notifications where kind in ('marketplace_purchase', 'marketplace_sale')
            and payload ? 'coin_purchase_id'), 2, 'both sides are told');
select throws_ok(
  $$insert into public.purchase_entitlements (user_id, product_id, source) values ('c0150000-0000-0000-0000-000000000003', 'c0151000-0000-0000-0000-000000000006', 'coins')$$,
  '23514', null, 'a coins entitlement needs the coin purchase behind it');

-- The refusals, each from its own account.
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000006', 'own-1', 40, true, 'android')$$,
  '22023', 'O‘z mahsulotingizni sotib ololmaysiz.', 'nobody buys their own listing');
select is((public.seller_earnings_summary() -> 'coins' ->> 'net_total')::int, 135, 'coin sales show in the seller''s earnings');
reset role;

select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000006', 'blocked-1', 40, true, 'android')$$,
  '42501', 'account is blocked', 'a blocked account cannot buy');
reset role;

select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select is((public.marketplace_coin_quote('c0151000-0000-0000-0000-000000000001') ->> 'shortfall')::int, 50,
  'the quote says how much is missing');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'poor-1', 150, true, 'android')$$,
  '22023', 'insufficient balance', 'a short balance is refused');
reset role;
select is((select row(w.balance, (select count(*) from public.credit_transactions t
                                   where t.user_id = w.user_id and t.type = 'marketplace_spend'))::text
             from public.credit_wallets w where w.user_id = 'c0150000-0000-0000-0000-000000000003'),
  '(100,0)', 'and leaves neither a charge nor a ledger row behind');

-- A tariff's coins are not handed to a seller, as they are not sent to anybody.
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select is((public.marketplace_coin_quote('c0151000-0000-0000-0000-000000000001') ->> 'spendable')::int, 50,
  'only what is not this month''s tariff is spendable in the store');
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000001', 'plan-1', 150, true, 'android')$$,
  'P0001', 'Tarif J Tangalarini do‘konda sarflab bo‘lmaydi. Sarflash mumkin: 50 J.', 'tariff coins cannot pay for a listing');
select lives_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000006', 'plan-2', 40, true, 'android')$$,
  'bought or earned coins beside them can');
reset role;
select is((select remaining from public.coin_lots where user_id = 'c0150000-0000-0000-0000-000000000005' and status = 'active'), 150,
  'and the tariff''s lot is left whole');
select is((select row(fee_amount, seller_net)::text from public.marketplace_coin_purchases where idempotency_key = 'plan-2'),
  '(5,35)', 'a small sale pays the minimum fee');

-- Switched off by an admin, nobody buys for coins.
update public.app_settings set value = value || '{"enabled": false}' where key = 'marketplace.coin_sales';
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.marketplace_buy_with_coins('c0151000-0000-0000-0000-000000000006', 'off-1', 40, true, 'android')$$,
  '42501', null, 'coin sales switched off are refused');
reset role;
update public.app_settings set value = value || '{"enabled": true}' where key = 'marketplace.coin_sales';

-- Editing the coin price of a live listing goes back to review; removing it does not.
update public.marketplace_products set coin_price = 45 where id = 'c0151000-0000-0000-0000-000000000006';
select is((select status::text from public.marketplace_products where id = 'c0151000-0000-0000-0000-000000000006'), 'pending_review',
  'a new coin price on a live listing is reviewed again');
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((public.marketplace_set_coin_price('c0151000-0000-0000-0000-000000000001', null) ->> 'status'), 'approved',
  'taking the coin price away leaves the listing live');
reset role;

-- ----------------------------------------------------------- transfers --
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((public.transfer_credits('c0150000-0000-0000-0000-000000000009', 100, 'rahmat', 't-1') - 'balance' - 'recipient_balance_changed'),
  '{"applied": true, "amount": 100, "fee": 3, "received": 97}'::jsonb, 'the sender sends 100; the recipient receives 97');
select is((public.transfer_credits('c0150000-0000-0000-0000-000000000009', 100, 'rahmat', 't-1') ->> 'applied')::boolean, false,
  'a replayed transfer moves nothing and charges no second fee');
select is((public.transfer_credits('c0150000-0000-0000-0000-000000000009', 10, '', 't-2') ->> 'received')::int, 9,
  'the minimum fee applies to a small transfer');
select throws_ok(
  $$select public.transfer_credits('c0150000-0000-0000-0000-000000000009', 1, '', 't-3')$$,
  '22023', null, 'a transfer the fee would swallow whole is refused');
select throws_ok(
  $$select public.transfer_credits('c0150000-0000-0000-0000-000000000004', 50, '', 't-4')$$,
  '42501', 'recipient cannot receive coins', 'a blocked recipient is still refused');
select throws_ok(
  $$select public.transfer_credits('c0150000-0000-0000-0000-000000000002', 50, '', 't-5')$$,
  '22023', 'you cannot send coins to yourself', 'sending to oneself is still refused');
reset role;

select is((select array_agg(row(type, amount)::text order by amount) from public.credit_transactions where idempotency_key = 'transfer:t-1'),
  array['(transfer_out,-100)', '(transfer_in,97)'], 'ledger: the sender''s row is the whole amount, the recipient''s the rest');
select is((select row(source, amount, gross_amount)::text from public.coin_platform_fees where idempotency_key like 'transfer-fee:%:transfer:t-1'),
  '(transfer,3,100)', 'ledger: the platform''s share of a transfer is its own row');
select is((select balance from public.credit_wallets where user_id = 'c0150000-0000-0000-0000-000000000009'), 97 + 9,
  'the recipient holds what reached them');

-- The fee is part of the amount: a balance equal to the amount is enough, one coin less is not.
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.transfer_credits('c0150000-0000-0000-0000-000000000009', 101, '', 'p-1')$$,
  '22023', 'insufficient balance', 'an amount above the balance is refused, fee or not');
select is((public.transfer_credits('c0150000-0000-0000-0000-000000000009', 100, '', 'p-2') ->> 'balance')::int, 0,
  'the whole balance can be sent: the fee comes out of what is received');
reset role;

-- Zero percent turns the fee off, minimum and all.
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000006","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.admin_set_coin_fees(true, 10, 5, 0, 5, 'Test: transfers free again')$$, 'the transfer fee is switched off');
reset role;
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((public.transfer_credits('c0150000-0000-0000-0000-000000000009', 10, '', 't-6') - 'balance' - 'recipient_balance_changed'),
  '{"applied": true, "amount": 10, "fee": 0, "received": 10}'::jsonb, 'with the fee at 0 the recipient receives every coin');
reset role;
select is((select count(*)::int from public.coin_platform_fees where source = 'transfer'), 3,
  'and no platform row is written for it');

-- ------------------------------------------------------------- the admin --
select set_config('request.jwt.claims', '{"sub":"c0150000-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;
select is((public.admin_coin_economy() -> 'periods' -> 'all_time') - 'transfers_with_fee',
  '{"sales_count": 2, "sales_coins": 190, "store_fees": 20, "transfer_fees": 7}'::jsonb,
  'admins see coin sales and the fees they brought');
reset role;

-- A coin sale names both people, so neither account is erased from under it.
select is(
  public.account_retention_reasons('c0150000-0000-0000-0000-000000000001') @> array['marketplace_coin_sales']
  and public.account_retention_reasons('c0150000-0000-0000-0000-000000000002') @> array['marketplace_coin_purchases'],
  true, 'a coin sale keeps the seller''s and the buyer''s accounts as records');

-- -------------------------------------------------------------- privileges --
select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relname in ('marketplace_coin_purchases', 'coin_platform_fees')
      and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'SELECT'))),
  null, 'no client writes a coin sale or a fee row, and nobody signed out reads one');
select ok(not has_function_privilege('anon', 'public.marketplace_buy_with_coins(uuid, text, integer, boolean, text)', 'EXECUTE'),
  'a signed-out caller cannot buy');

select * from finish();
rollback;

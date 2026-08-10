begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

-- ---------------------------------------------------------------- fixtures --
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'seller@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Seller One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'buyer@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Buyer Two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'other@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Other Three"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e4440000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'boss@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Admin Four"}', now(), now());

insert into public.user_roles (user_id, role) values ('e4440000-0000-0000-0000-000000000004', 'admin');

-- --------------------------------------------------- sensitive-column audit --
-- The partial card table must have no column that could hold, or be combined
-- into, a card number. This is the schema-level half of the security boundary.
select hasnt_column('public', 'partial_cards', 'card_number', 'no card_number column');
select hasnt_column('public', 'partial_cards', 'full_card_number', 'no full_card_number column');
select hasnt_column('public', 'partial_cards', 'missing_digits', 'no missing_digits column');
select hasnt_column('public', 'partial_cards', 'cvv', 'no cvv column');
select hasnt_column('public', 'partial_cards', 'otp', 'no otp column');
select hasnt_column('public', 'partial_cards', 'provider_token', 'no reusable provider token column');

-- A signed-out caller cannot reach the catalogue at all.
select ok(not has_table_privilege('anon', 'public.marketplace_products', 'SELECT'), 'anon cannot read products');
select ok(not has_table_privilege('anon', 'public.marketplace_purchases', 'SELECT'), 'anon cannot read purchases');
-- No client role may write money.
select ok(not has_table_privilege('authenticated', 'public.payment_transactions', 'UPDATE'), 'clients cannot update payments');
select ok(not has_table_privilege('authenticated', 'public.purchase_entitlements', 'INSERT'), 'clients cannot grant themselves entitlements');
select ok(not has_table_privilege('authenticated', 'public.seller_ledger_entries', 'INSERT'), 'clients cannot write the seller ledger');

-- The two functions that assert what the provider said are server-only.
select ok(not has_function_privilege('authenticated', 'public.marketplace_settle_payment(uuid, integer)', 'EXECUTE'),
  'settle_payment is not callable by a signed-in client');
select ok(not has_function_privilege('authenticated', 'public.payment_advance(uuid, public.payment_state, text, text, text, text)', 'EXECUTE'),
  'payment_advance is not callable by a signed-in client');

-- ------------------------------------------------------------- commission --
select is((public.marketplace_quote(10000) ->> 'buyer_total')::integer, 12000, '10 000 + 20% buyer fee = 12 000');
select is((public.marketplace_quote(10000) ->> 'seller_net')::integer, 8000, 'seller keeps 10 000 - 20% = 8 000');
select is((public.marketplace_quote(10000) ->> 'platform_gross')::integer, 4000, 'platform gross is 4 000');

-- ------------------------------------------------------------- authoring --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1110000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.marketplace_products (id, seller_id, material_type, title, base_price, status)
values ('d0000000-0000-0000-0000-000000000001', 'e1110000-0000-0000-0000-000000000001',
        'presentation', 'Alisher Navoiy hayoti', 10000, 'draft');

-- A seller cannot publish their own listing: `approved` is unreachable from here.
select throws_ok(
  $$update public.marketplace_products set status = 'approved'
    where id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'a seller cannot approve their own product'
);

select set_config('request.jwt.claim.sub', 'e4440000-0000-0000-0000-000000000004', true);
select lives_ok(
  $$select public.admin_moderate_product('d0000000-0000-0000-0000-000000000001', 'approve')$$,
  'an admin can approve a product'
);
select is(
  (select status::text from public.marketplace_products where id = 'd0000000-0000-0000-0000-000000000001'),
  'approved', 'the product is live'
);
select is(
  (select count(*)::integer from public.notifications
   where user_id = 'e1110000-0000-0000-0000-000000000001' and kind = 'product_approved'),
  1, 'the seller is told once'
);

-- ---------------------------------------------------------------- checkout --
select set_config('request.jwt.claim.sub', 'e1110000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'self-buy')$$,
  '22023', null, 'a seller cannot buy their own product'
);

select set_config('request.jwt.claim.sub', 'e2220000-0000-0000-0000-000000000002', true);
select is(
  (public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'attempt-1') ->> 'buyer_total')::integer,
  12000, 'checkout quotes the buyer 12 000'
);
-- The same key is the same attempt, not a second charge.
select is(
  (public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'attempt-1') ->> 'reused')::boolean,
  true, 'a replayed checkout returns the first transaction'
);
select is((select count(*)::integer from public.payment_transactions), 1, 'only one transaction exists');

-- ------------------------------------------------------------- settlement --
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  $$select public.marketplace_settle_payment((select id from public.payment_transactions limit 1))$$,
  '22023', null, 'a payment that never reached the provider cannot settle'
);

select lives_ok($$
  select public.payment_advance(t.id, s.state, 'test')
  from public.payment_transactions t,
       unnest(array['card_created','otp_requested','card_verified','receipt_created','processing']::public.payment_state[])
         with ordinality as s(state, ord)
  order by s.ord
$$, 'the payment walks the state machine to processing');

select is(
  (public.marketplace_settle_payment((select id from public.payment_transactions limit 1), 300) ->> 'applied')::boolean,
  true, 'a processing payment settles'
);
-- Settling twice must not create a second purchase, entitlement or ledger row.
select is(
  (public.marketplace_settle_payment((select id from public.payment_transactions limit 1)) ->> 'applied')::boolean,
  false, 'settling twice is a no-op'
);
select is((select count(*)::integer from public.purchase_entitlements), 1, 'exactly one entitlement exists');
select is(
  (select net_amount from public.seller_ledger_entries),
  8000, 'the seller is owed 8 000'
);

-- ------------------------------------------------- commission snapshot --
-- Change the platform's cut, then confirm history did not move with it.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e4440000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.admin_set_commission(15, 15, 'test change')$$,
  'an admin can change both rates'
);
select is(
  (select buyer_fee_amount from public.marketplace_purchases),
  2000, 'the completed sale keeps the 20% it was made with'
);
select is((public.marketplace_quote(10000) ->> 'buyer_total')::integer, 11500, 'new checkouts use the new rate');

reset role;
select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(68);

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
select hasnt_column('public', 'payment_card_attempts', 'card_number', 'attempt storage has no PAN column');
select hasnt_column('public', 'payment_card_attempts', 'missing_digits', 'attempt storage has no hidden digits');
select hasnt_column('public', 'payment_card_attempts', 'cvv', 'attempt storage has no CVV');
select hasnt_column('public', 'payment_card_attempts', 'otp', 'attempt storage has no SMS code');

-- A signed-out caller cannot reach the catalogue at all.
select ok(not has_table_privilege('anon', 'public.marketplace_products', 'SELECT'), 'anon cannot read products');
select ok(not has_table_privilege('anon', 'public.marketplace_purchases', 'SELECT'), 'anon cannot read purchases');
-- No client role may write money.
select ok(not has_table_privilege('authenticated', 'public.payment_transactions', 'UPDATE'), 'clients cannot update payments');
select ok(not has_table_privilege('authenticated', 'public.purchase_entitlements', 'INSERT'), 'clients cannot grant themselves entitlements');
select ok(not has_table_privilege('authenticated', 'public.seller_ledger_entries', 'INSERT'), 'clients cannot write the seller ledger');
select ok(not has_table_privilege('authenticated', 'public.payment_card_attempts', 'SELECT'),
  'clients cannot read private card attempts');
select ok(not has_table_privilege('authenticated', 'public.payment_card_attempts', 'INSERT'),
  'clients cannot create private card attempts');
select ok(not has_table_privilege('authenticated', 'public.payment_card_attempts', 'UPDATE'),
  'clients cannot replace a provider token or masked hint');
select ok(not has_table_privilege('authenticated', 'public.payment_card_attempts', 'DELETE'),
  'clients cannot interfere with an in-flight card attempt');

-- The two functions that assert what the provider said are server-only.
select ok(not has_function_privilege('authenticated', 'public.marketplace_settle_payment(uuid, integer)', 'EXECUTE'),
  'settle_payment is not callable by a signed-in client');
select ok(not has_function_privilege('authenticated', 'public.payment_advance(uuid, public.payment_state, text, text, text, text)', 'EXECUTE'),
  'payment_advance is not callable by a signed-in client');
select ok(not has_function_privilege('authenticated',
  'public.payment_card_attempt_set(text, uuid, text, text, integer, integer, integer)', 'EXECUTE'),
  'clients cannot store a provider token or card hint');
select ok(not has_function_privilege('authenticated', 'public.payment_card_attempt_take(text, uuid, uuid)', 'EXECUTE'),
  'clients cannot take a provider token');
select ok(not has_function_privilege('authenticated', 'public.remember_partial_card(uuid, text, integer, integer)', 'EXECUTE'),
  'clients cannot claim that a card completed payment');

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

/**
 * The shop is a members' economy now.
 *
 * Browsing stays open — a shop nobody may look into has nothing to sell a
 * subscription with — but buying and selling need a live plan, and the refusal
 * comes from the database rather than from a hidden button.
 */
select set_config('request.jwt.claim.sub', 'e2220000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'no-plan')$$,
  '42501', null, 'somebody without a plan cannot buy'
);
select throws_ok(
  $$select public.marketplace_save_product(null, 'presentation', 'Nomsiz')$$,
  '42501', null, 'and cannot sell'
);

-- Both buyer and seller are members from here on: the rest of this file is
-- about what the shop does, not about who may enter it.
-- Granting a membership is a privileged write, as it should be: no client role
-- holds INSERT here. The test steps out of `authenticated` to seed it and
-- steps straight back.
reset role;
insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select u.id, p.id, 'active', now(), now() + interval '30 days', jsonb_build_object('features', p.features)
  from (values ('e1110000-0000-0000-0000-000000000001'::uuid), ('e2220000-0000-0000-0000-000000000002'::uuid)) as u(id)
  cross join public.subscription_plans p
 where p.code = 'premium_monthly';
set local role authenticated;

select set_config('request.jwt.claim.sub', 'e1110000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'self-buy')$$,
  '22023', null, 'a seller cannot buy their own product'
);

select set_config('request.jwt.claim.sub', 'e2220000-0000-0000-0000-000000000002', true);
select is(
  (public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'attempt-1', null, null, true) ->> 'buyer_total')::integer,
  12000, 'checkout quotes the buyer 12 000'
);
-- The same key is the same attempt, not a second charge.
select is(
  (public.marketplace_create_checkout('d0000000-0000-0000-0000-000000000001', 'attempt-1', null, null, true) ->> 'reused')::boolean,
  true, 'a replayed checkout returns the first transaction'
);
select is((select count(*)::integer from public.payment_transactions), 1, 'only one transaction exists');

-- ------------------------------------------------------------- settlement --
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table t_card_attempt as
  select public.payment_card_attempt_set(
      'marketplace', (select id from public.payment_transactions limit 1),
      'sandbox_test_token', '86004954XXXX6478', 12, 99, 15
    ) as id;
select ok((select id is not null from t_card_attempt),
  'the server can bind a one-time token to a trusted masked hint');
select is(
  (public.payment_card_attempt_take(
    'marketplace', (select id from public.payment_transactions limit 1),
    (select id from t_card_attempt)
  ) ->> 'token'),
  'sandbox_test_token', 'taking an attempt returns its provider token once'
);
select is(
  (public.payment_card_attempt_take(
    'marketplace', (select id from public.payment_transactions limit 1),
    (select id from t_card_attempt)
  ) ->> 'code'),
  'attempt_consumed', 'a replay cannot take the same provider token'
);
select ok(
  public.payment_card_attempt_clear(
    'marketplace', (select id from public.payment_transactions limit 1), (select id from t_card_attempt)
  ),
  'the server clears the consumed masked attempt'
);

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

-- --------------------------------------------------------- partial cards --
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$select public.remember_partial_card(
    'e2220000-0000-0000-0000-000000000002', '86004954XXXX6478', 12, 99
  )$$,
  'the server remembers an already-masked hint after payment'
);
select lives_ok(
  $$select public.remember_partial_card(
    'e2220000-0000-0000-0000-000000000002', '86004954XXXX6478', 11, 99
  )$$,
  'remembering the same card refreshes it instead of inserting again'
);
select is(
  (select count(*)::integer from public.partial_cards
   where user_id = 'e2220000-0000-0000-0000-000000000002'),
  1, 'duplicate masked cards have one row'
);
select throws_ok(
  $$select public.remember_partial_card(
    'e2220000-0000-0000-0000-000000000002', '8600495473316478', 12, 99
  )$$,
  '22023', null, 'the remember RPC cannot accept a full PAN'
);
select throws_ok(
  $$select public.remember_partial_card(
    'e2220000-0000-0000-0000-000000000002', '86004954XXXX6478', 1, 24
  )$$,
  '22023', null, 'an expired card cannot be remembered'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e2220000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.partial_cards), 1,
  'a buyer sees their own masked card');
select throws_ok(
  $$update public.partial_cards set expiry_month = 1$$,
  '42501', null, 'a buyer cannot edit a saved card'
);
select set_config('request.jwt.claim.sub', 'e3330000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.partial_cards), 0,
  'another account cannot see the buyer card');
delete from public.partial_cards where display_pan = '86004954XXXX6478';
select set_config('request.jwt.claim.sub', 'e2220000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.partial_cards), 1,
  'another account cannot delete the buyer card');
delete from public.partial_cards where display_pan = '86004954XXXX6478';
select is((select count(*)::integer from public.partial_cards), 0,
  'the owner can delete a saved card');

-- ------------------------------------------------ the weekly unlock --

/**
 * Opening a paid item on the allowance rather than by buying it.
 *
 * What a member gets is the right to use the work inside Jaxongirman. What they
 * do not get is the file or the right to sell it on — they did not buy it, and
 * the seller is still its author. Those are columns on the licence, so an
 * export path can ask rather than a screen having to remember.
 */
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e3330000-0000-0000-0000-000000000003', true);

reset role;
insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select 'e3330000-0000-0000-0000-000000000003', p.id, 'active', now(), now() + interval '30 days',
       jsonb_build_object('features', p.features)
  from public.subscription_plans p where p.code = 'premium_monthly';
set local role authenticated;

select is(
  (public.marketplace_unlock_with_subscription('d0000000-0000-0000-0000-000000000001') ->> 'ok'),
  'true', 'a member opens a paid item on the weekly allowance');
select is(
  (select license_type from public.marketplace_licenses
    where user_id = 'e3330000-0000-0000-0000-000000000003'),
  'subscription_access', 'and it is recorded as access, not as a purchase');
select is(
  (select editable::text || ',' || presentable::text || ',' || download_allowed::text || ',' || resale_allowed::text
     from public.marketplace_licenses where user_id = 'e3330000-0000-0000-0000-000000000003'),
  'true,true,false,false', 'editable and presentable; not downloadable, not resellable');
select is(
  public.marketplace_may_download('d0000000-0000-0000-0000-000000000001', 'e3330000-0000-0000-0000-000000000003'),
  false, 'so no export path will hand over the file');

-- The allowance is one a week, and opening the same thing twice is not two.
select is(
  (public.marketplace_unlock_with_subscription('d0000000-0000-0000-0000-000000000001') ->> 'repeated'),
  'true', 'opening what is already open spends nothing');
select is(
  (select used from public.subscription_usage
    where user_id = 'e3330000-0000-0000-0000-000000000003' and feature_key = 'marathon_unlock'),
  1, 'so the week still shows one unlock used');

reset role;

/**
 * A preview is not the thing being sold.
 *
 * The images anyone may look at live in one bucket and the file a buyer pays
 * for lives in another, and a signed-in client holds no read policy on the
 * second at all. So the original has no URL to leak through the preview screen
 * — not because that screen is careful, but because it could not ask.
 */
select is(
  (select count(*)::integer from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
      and qual like '%marketplace-files%'),
  0, 'no client role may read the marketplace file bucket');
select ok(
  exists (select 1 from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
             and qual like '%marketplace-previews%'),
  'while previews are readable, which is what makes them previews');
select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa110000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
   'iosbuyer@example.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Buyer"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bb220000-0000-0000-0000-0000000000b2', 'authenticated', 'authenticated',
   'iosseller@example.test', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Seller"}', now(), now());

insert into public.marketplace_products (
  id, seller_id, material_type, title, description, status, base_price, published_at
) values (
  'cc330000-0000-0000-0000-0000000000c3', 'bb220000-0000-0000-0000-0000000000b2',
  'essay', 'iOS siyosati sinovi', 'Sinov mahsuloti', 'approved', 10000, now()
);

-- ---------------------------------------------------------------- default --
-- Shipping with the switch off matters: a fresh deployment must not silently
-- take payments away from anybody.
select ok(
  not (select (value -> 'review_mode')::boolean from public.app_settings where key = 'payments.ios_policy'),
  'the policy ships with review mode off'
);
select ok(
  (select public_read from public.app_settings where key = 'payments.ios_policy'),
  'and is readable by a client, because it decides what a screen may draw'
);
select is(
  (select value ->> 'review_mode' from public.app_settings where key = 'payments.ios_policy'),
  'false', 'the flag is a real boolean rather than a string'
);

select ok(not public.payments_blocked_for_platform('ios'), 'with the switch off, iOS may pay');
select ok(not public.payments_blocked_for_platform('android'), 'and so may Android');

-- --------------------------------------------------------- switched on --
update public.app_settings
  set value = jsonb_set(value, '{review_mode}', 'true')
  where key = 'payments.ios_policy';

select ok(public.payments_blocked_for_platform('ios'), 'with the switch on, iOS is blocked');

-- The whole point of the feature is that it is iOS-only. Every one of these is
-- a way somebody could have got the match wrong.
select ok(not public.payments_blocked_for_platform('android'), 'Android is never blocked');
select ok(not public.payments_blocked_for_platform('web'), 'web is never blocked');
select ok(not public.payments_blocked_for_platform('macos'), 'macOS is not iOS');
select ok(not public.payments_blocked_for_platform(null), 'a missing platform is not treated as iOS');
select ok(not public.payments_blocked_for_platform(''), 'nor is an empty one');
select ok(not public.payments_blocked_for_platform('iosx'), 'nor is a longer string that starts with ios');

-- Case and whitespace must not be a way around it: the switch can only narrow
-- iOS, so failing open on ' IOS ' would defeat the purpose.
select ok(public.payments_blocked_for_platform('iOS'), 'case does not matter');
select ok(public.payments_blocked_for_platform('  ios  '), 'surrounding whitespace does not matter');

-- ------------------------------------------------------------- the policy --
select is(
  (public.payment_policy('ios') ->> 'payments_enabled'), 'false',
  'the client policy tells an iOS build it may not purchase'
);
select is(
  (public.payment_policy('ios') ->> 'show_prices'), 'false',
  'and that it may not show prices either'
);
select is(
  (public.payment_policy('android') ->> 'payments_enabled'), 'true',
  'while Android is told nothing has changed'
);
select ok(
  (public.payment_policy('ios') -> 'copy' ->> 'marketplace') is not null,
  'and iOS is given something to say instead'
);
-- 3.1.1(a) forbids calls to action pointing at other purchasing mechanisms in
-- every storefront except the United States. The shipped copy names none.
select ok(
  (select bool_and(value not ilike '%jaxongirman.uz%' and value not ilike '%sayt%')
   from jsonb_each_text(public.payment_policy('ios') -> 'copy')),
  'the default copy steers nobody to another way to buy'
);

-- ------------------------------------------------------- the server refusal --
-- A client that ignores the policy, or a request replayed from a script, must
-- still be refused: the hide is presentation, this is enforcement.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aa110000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select public.marketplace_create_checkout('cc330000-0000-0000-0000-0000000000c3'::uuid, 'ios-key-1', null, 'ios')$$,
  '42501', null,
  'an iOS checkout is refused by the server, not merely hidden by the client'
);
select is(
  (select count(*)::integer from public.payment_transactions
   where buyer_id = 'aa110000-0000-0000-0000-0000000000a1'),
  0, 'and no transaction row is left behind to reconcile'
);

-- The same call from Android goes through, which is the other half of the claim.
select lives_ok(
  $$select public.marketplace_create_checkout('cc330000-0000-0000-0000-0000000000c3'::uuid, 'android-key-1', null, 'android')$$,
  'the identical purchase succeeds from Android'
);

select finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a9990000-0000-0000-0000-000000000009', 'authenticated', 'authenticated',
   'spender@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Spender"}', now(), now());

update public.credit_wallets set balance = 100 where user_id = 'a9990000-0000-0000-0000-000000000009';

-- ------------------------------------------------------------- privileges --

/**
 * Spending is the server's alone.
 *
 * A client that could reserve, settle or refund on its own behalf could also
 * refund what it just spent. Every one of these is reachable only from an Edge
 * function holding the service role, beside the work being paid for.
 */
select ok(not has_function_privilege('authenticated', 'public.jcoin_reserve(text, text, uuid, uuid, jsonb)', 'EXECUTE'),
  'a client cannot reserve its own coins');
select ok(not has_function_privilege('authenticated', 'public.jcoin_settle(text, uuid)', 'EXECUTE'),
  'nor settle a reservation');
select ok(not has_function_privilege('authenticated', 'public.jcoin_refund(text, text, uuid)', 'EXECUTE'),
  'nor refund itself');
select ok(not has_function_privilege('anon', 'public.jcoin_reserve(text, text, uuid, uuid, jsonb)', 'EXECUTE'),
  'and a signed-out caller reaches none of it');

-- ---------------------------------------------------------------- pricing --

-- The price comes from the one list. A caller naming something that is not on
-- it is a bug worth raising, not a free operation.
select throws_ok(
  $$ select public.jcoin_reserve('no_such_operation', 'x:1', null, 'a9990000-0000-0000-0000-000000000009') $$,
  '22023', null, 'an operation with no price is refused rather than given away');

select is(
  (public.jcoin_reserve('external_pptx_present', 'pptx:1', null, 'a9990000-0000-0000-0000-000000000009') ->> 'amount'),
  '24', 'presenting an outside PPTX costs what the price list says');

-- ------------------------------------------------------------ idempotency --

/**
 * The property the whole design exists for.
 *
 * Two presses of one button are one request. The second must return the first's
 * reservation rather than take a second one, or a slow network becomes a double
 * charge.
 */
select is(
  (public.jcoin_reserve('external_pptx_present', 'pptx:1', null, 'a9990000-0000-0000-0000-000000000009') ->> 'repeated'),
  'true', 'the same key returns the reservation that already exists');
select is(
  (select balance from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  76, 'and the balance moved exactly once');
select is(
  (select reserved from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  24, 'with the price held aside, not yet spent');
select is(
  (select count(*)::integer from public.credit_transactions
    where user_id = 'a9990000-0000-0000-0000-000000000009' and type = 'reservation'),
  1, 'one reservation row, however many times it was asked for');

-- --------------------------------------------------------------- settling --

select is(
  (public.jcoin_settle('pptx:1', 'a9990000-0000-0000-0000-000000000009') ->> 'settled'),
  'true', 'work that succeeded turns the hold into a charge');
select is(
  (select reserved from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  0, 'the hold is released');
select is(
  (select lifetime_spent from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  24, 'and recorded as spent');
select is(
  (public.jcoin_settle('pptx:1', 'a9990000-0000-0000-0000-000000000009') ->> 'code'),
  'already_finished', 'settling twice takes nothing more');
select is(
  (select balance from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  76, 'so the balance is untouched by the repeat');

-- ---------------------------------------------------------------- refunds --

select public.jcoin_reserve('game_after_free_limit', 'game:1', null, 'a9990000-0000-0000-0000-000000000009');
select is(
  (public.jcoin_refund('game:1', 'texnik xato', 'a9990000-0000-0000-0000-000000000009') ->> 'refunded'),
  'true', 'a failure that was ours gives the coins back');
select is(
  (select balance from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  76, 'the balance returns to where it was');
select is(
  (public.jcoin_refund('game:1', '', 'a9990000-0000-0000-0000-000000000009') ->> 'code'),
  'already_finished', 'and refunding twice does not pay twice');

-- Money already spent is not refundable through this door.
select is(
  (public.jcoin_refund('pptx:1', '', 'a9990000-0000-0000-0000-000000000009') ->> 'code'),
  'already_finished', 'a settled charge cannot be quietly reversed');

-- ----------------------------------------------------------- affordability --

/**
 * Refused, not overdrawn. A balance that can go negative is a balance that will.
 */
update public.credit_wallets set balance = 5 where user_id = 'a9990000-0000-0000-0000-000000000009';
select is(
  (public.jcoin_reserve('external_pptx_present', 'pptx:2', null, 'a9990000-0000-0000-0000-000000000009') ->> 'code'),
  'insufficient_jcoin', 'a purchase beyond the balance is refused');
select is(
  (select balance from public.credit_wallets where user_id = 'a9990000-0000-0000-0000-000000000009'),
  5, 'and nothing was taken on the way to refusing');

select * from finish();
rollback;

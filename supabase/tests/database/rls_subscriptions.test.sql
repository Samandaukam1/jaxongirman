begin;

create extension if not exists pgtap with schema extensions;
select plan(54);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f1110000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'member@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'outsider@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Outsider"}', now(), now());

-- ------------------------------------------------------------- privileges --

/**
 * Spending an allowance is the server's alone.
 *
 * A client that could call `quota_consume` could also decline to call it, which
 * makes the limit a suggestion. It is reachable only from an Edge function
 * holding the service role, beside the work it is paying for.
 */
select ok(not has_function_privilege('authenticated', 'public.quota_consume(text, integer, uuid)', 'EXECUTE'),
  'a signed-in client cannot spend its own quota');
select ok(not has_function_privilege('authenticated', 'public.quota_release(text, integer, uuid)', 'EXECUTE'),
  'nor hand itself one back');
select ok(not has_function_privilege('anon', 'public.my_entitlements(uuid)', 'EXECUTE'),
  'a signed-out caller has no entitlements to ask about');
select ok(has_function_privilege('authenticated', 'public.my_entitlements(uuid)', 'EXECUTE'),
  'a member can read what they are entitled to');
select ok(has_function_privilege('authenticated', 'public.quota_status(text, uuid)', 'EXECUTE'),
  'and how much of it is left');

-- No client writes any of these tables directly; every change is an RPC.
select ok(not has_table_privilege('authenticated', 'public.user_subscriptions', 'INSERT'),
  'a client cannot grant itself a membership');
select ok(not has_table_privilege('authenticated', 'public.subscription_usage', 'UPDATE'),
  'a client cannot move its own counter');
select ok(not has_table_privilege('authenticated', 'public.marketplace_licenses', 'INSERT'),
  'a client cannot mint itself a licence');
select ok(not has_table_privilege('authenticated', 'public.subscription_plans', 'UPDATE'),
  'and cannot rewrite the price it is about to be charged');

-- The catalogue is public: a price has to be readable before signing in.
select ok(has_table_privilege('anon', 'public.subscription_plans', 'SELECT'),
  'a signed-out visitor can see what a plan costs');

-- ------------------------------------------------------------- the plan --

select is((select count(*)::integer from public.subscription_plans where code = 'premium_monthly'), 1,
  'the launch plan exists');
select is((select price_amount from public.subscription_plans where code = 'premium_monthly'), 36000,
  'priced at 36 000');
select is((select period_days from public.subscription_plans where code = 'premium_monthly'), 30,
  'for thirty days');
select is(
  (select features -> 'presentation_weekly' ->> 'limit' from public.subscription_plans where code = 'premium_monthly'),
  '4', 'four presentations a week');
select is(
  (select features -> 'presentation_weekly' ->> 'period' from public.subscription_plans where code = 'premium_monthly'),
  'week', 'counted weekly, not as a monthly lump that can be spent in a day');
select is(
  (select features -> 'presentation_weekly' ->> 'rollover' from public.subscription_plans where code = 'premium_monthly'),
  'false', 'and an unused week does not carry over by default');
select is(
  (select features -> 'presentation_max_slides' ->> 'limit' from public.subscription_plans where code = 'premium_monthly'),
  '16', 'sixteen slides per presentation');
select is(
  (select features -> 'marathon_unlock' ->> 'limit' from public.subscription_plans where code = 'premium_monthly'),
  '1', 'one marathon unlock a week');
select is(
  (select features -> 'marketplace_download' ->> 'enabled' from public.subscription_plans where code = 'premium_monthly'),
  'false', 'a subscription unlock is not a download');
select is(
  (select features -> 'marketplace_resale' ->> 'enabled' from public.subscription_plans where code = 'premium_monthly'),
  'false', 'and it may not be resold');

-- The prices everyone pays sit with the other operation costs, not beside them.
select is(
  (select value -> 'external_pptx_present' ->> 'base_credits' from public.app_settings where key = 'credits.operation_costs'),
  '24', 'presenting an outside PPTX costs 24 J, from the one price list');
select is(
  (select value -> 'game_after_free_limit' ->> 'base_credits' from public.app_settings where key = 'credits.operation_costs'),
  '20', 'and a game past the free daily allowance costs 20 J');

-- --------------------------------------------------------- what a quota does

/**
 * Without a membership the answer is the free tier — a setting, not a hardcoded
 * zero — so an admin can widen the door without a deploy.
 */
select is(
  (public.my_entitlements('f1110000-0000-0000-0000-000000000001') ->> 'member'),
  'false', 'somebody with no subscription is not a member');
select is(
  (public.quota_status('game_free_daily', 'f1110000-0000-0000-0000-000000000001') ->> 'limit'),
  '3', 'but still gets three free games a day');

insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select 'f1110000-0000-0000-0000-000000000001', id, 'active', now(), now() + interval '30 days',
       jsonb_build_object('features', features)
  from public.subscription_plans where code = 'premium_monthly';

-- Four allowed, the fifth refused: the limit is the limit.
select is(
  (select count(*) filter (where (public.quota_consume('presentation_weekly', 1, 'f1110000-0000-0000-0000-000000000001') ->> 'ok')::boolean)::integer
     from generate_series(1, 4)),
  4, 'a member spends the whole week');
select is(
  (public.quota_consume('presentation_weekly', 1, 'f1110000-0000-0000-0000-000000000001') ->> 'code'),
  'quota_exhausted', 'and the fifth is refused rather than quietly allowed');

/**
 * An expired membership is not a membership.
 *
 * Nothing sweeps the table on a schedule, so this has to be true of the row as
 * it stands: a lapse must close the door the moment it lapses, not whenever a
 * job next runs.
 */
-- Backdated as a real lapse would be: the window constraint refuses a row that
-- ends before it began, which is right and means a test has to age it honestly.
update public.user_subscriptions
   set started_at = now() - interval '40 days', expires_at = now() - interval '1 day'
 where user_id = 'f1110000-0000-0000-0000-000000000001';
select is(
  (public.my_entitlements('f1110000-0000-0000-0000-000000000001') ->> 'member'),
  'false', 'a lapsed membership stops being one without anything having to run');

-- ----------------------------------------------------------- no ceiling --

/**
 * An allowance with no ceiling writes nothing.
 *
 * A member hosts games without limit, and `limit: 999999` would be a limit
 * waiting to be hit by a bug while filling `subscription_usage` with rows
 * nobody reads. Unlimited says so, and counts nothing.
 */
update public.user_subscriptions
   set started_at = now(), expires_at = now() + interval '30 days'
 where user_id = 'f1110000-0000-0000-0000-000000000001';

select is(
  (public.quota_status('game_free_daily', 'f1110000-0000-0000-0000-000000000001') ->> 'unlimited'),
  'true', 'a member hosts games without a ceiling');
select is(
  (public.quota_status('game_free_daily', 'f1110000-0000-0000-0000-000000000001') ->> 'remaining'),
  null, 'so there is no number of games left to report');
select is(
  (public.quota_consume('game_free_daily', 1, 'f1110000-0000-0000-0000-000000000001') ->> 'ok'),
  'true', 'and hosting is always allowed');
select is(
  (select count(*)::integer from public.subscription_usage
    where user_id = 'f1110000-0000-0000-0000-000000000001' and feature_key = 'game_free_daily'),
  0, 'without writing a counter row nobody would read');

-- --------------------------------------------------- generation, gated --

/**
 * The plan meeting the work.
 *
 * A member's four a week are spent by generating, their sixteen slides are a
 * ceiling the server enforces, and somebody without a plan keeps the credit
 * path the product already had — this adds a plan, it does not take away how
 * things already worked.
 */
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f1110000-0000-0000-0000-000000000001', true);

-- Seventeen slides is past the plan's ceiling, and it is refused before
-- anything is written rather than trimmed silently.
select throws_ok(
  $$ select public.start_generation(
       gen_random_uuid(), 'Mavzu matni', 'Sarlavha', 'simple'::public.presentation_style, 17,
       null, null, '{}', null, null, null, 'toza-qogoz') $$,
  '22023', null, 'a member cannot exceed the plan''s slide ceiling');

reset role;

-- The week is already spent by the four consumed above, so the next generation
-- is refused for the allowance rather than for the wallet.
select set_config('request.jwt.claim.sub', 'f1110000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$ select public.start_generation(
       gen_random_uuid(), 'Mavzu matni', 'Sarlavha', 'simple'::public.presentation_style, 8) $$,
  'P0001', null, 'and cannot generate once the week is gone');
reset role;

-- ------------------------------------------------------ hosting a game --

/**
 * Three a day free, then twenty J — and a member without a ceiling.
 *
 * The outsider here has no plan, so they are the free tier: the fourth game is
 * where the price starts. The reuse rule is checked too, because a double press
 * that made two rooms would now also pay for the second one.
 */
insert into public.games (id, owner_id, title, status, question_count)
values ('9a000000-0000-0000-0000-00000000000a', 'f2220000-0000-0000-0000-000000000002',
        'Sinov o''yin', 'ready', 5)
on conflict do nothing;

update public.credit_wallets set balance = 100
 where user_id = 'f2220000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f2220000-0000-0000-0000-000000000002', true);

-- One room per press only while it is still an empty lobby.
select is(
  (public.game_session_create('9a000000-0000-0000-0000-00000000000a') ->> 'reused'),
  'false', 'the first press opens a room');
select is(
  (public.game_session_create('9a000000-0000-0000-0000-00000000000a') ->> 'reused'),
  'true', 'and a second press returns the same one rather than opening another');
select is(
  (select count(*)::integer from public.game_sessions
    where host_user_id = 'f2220000-0000-0000-0000-000000000002'),
  1, 'so a double press cannot make two rooms');
select is(
  (select balance from public.credit_wallets where user_id = 'f2220000-0000-0000-0000-000000000002'),
  100, 'and cannot pay twice for one');

reset role;
-- Close the lobby so the next call is genuinely a new room, and use up the rest
-- of the day's free allowance.
update public.game_sessions set status = 'finished'
 where host_user_id = 'f2220000-0000-0000-0000-000000000002';
select public.quota_consume('game_free_daily', 2, 'f2220000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2220000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$ select public.game_session_create('9a000000-0000-0000-0000-00000000000a') $$,
  'the fourth game of the day still opens');
reset role;

select is(
  (select balance from public.credit_wallets where user_id = 'f2220000-0000-0000-0000-000000000002'),
  80, 'but it costs 20 J, taken from the one price list');
select is(
  (select count(*)::integer from public.credit_transactions
    where user_id = 'f2220000-0000-0000-0000-000000000002' and type = 'charge'),
  1, 'charged once, and settled once the room existed');

-- ------------------------------------------------------- buying a plan --

/**
 * The price is the server's, and the membership follows the money.
 *
 * A client names a plan and nothing else: a price that arrived in the request
 * would be a price the buyer chose. And a membership only exists once an order
 * is fulfilled, which only happens once the provider has confirmed.
 */
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f2220000-0000-0000-0000-000000000002', true);

select is(
  (public.order_create_subscription('premium_monthly', 'android') ->> 'total_amount')::integer,
  36000, 'the order is priced from the plan, not from the caller');

-- Two presses are one purchase.
select is(
  (public.order_create_subscription('premium_monthly', 'android') ->> 'reused')::boolean,
  true, 'and a second press reuses the open order rather than opening another');

reset role;

-- Nothing is a membership until the order is fulfilled.
select is(
  (public.my_entitlements('f2220000-0000-0000-0000-000000000002') ->> 'member'),
  'false', 'an unpaid order grants nothing');

select public.order_fulfil(
  (select id from public.orders
    where user_id = 'f2220000-0000-0000-0000-000000000002' and purpose = 'subscription'
    order by created_at desc limit 1));

select is(
  (public.my_entitlements('f2220000-0000-0000-0000-000000000002') ->> 'member'),
  'true', 'fulfilment is what makes somebody a member');
select is(
  (select count(*)::integer from public.user_subscriptions
    where user_id = 'f2220000-0000-0000-0000-000000000002' and status = 'active'),
  1, 'with exactly one live membership');
select is(
  (select (plan_snapshot -> 'features' -> 'presentation_weekly' ->> 'limit')
     from public.user_subscriptions where user_id = 'f2220000-0000-0000-0000-000000000002'),
  '4', 'carrying the plan as it was sold, so a later edit cannot rewrite it');

-- The dead `plan:` entitlement is gone rather than written alongside.
select is(
  (select count(*)::integer from public.module_entitlements
    where user_id = 'f2220000-0000-0000-0000-000000000002' and module_code like 'plan:%'),
  0, 'and nothing is written to the table nobody read');

/**
 * Renewing extends rather than restarting.
 *
 * Time already paid for is not forfeited by renewing early — the arithmetic the
 * replaced branch already had right, kept.
 */
select public.order_fulfil((
  select o.id from public.orders o
   where o.user_id = 'f2220000-0000-0000-0000-000000000002' and o.purpose = 'subscription'
   order by o.created_at desc limit 1));
select ok(
  (select expires_at from public.user_subscriptions
    where user_id = 'f2220000-0000-0000-0000-000000000002') < now() + interval '31 days',
  'and fulfilling the same order twice does not stack two months');


/**
 * Whose allowance is it.
 *
 * Every reader here takes a user id that defaults to the caller's. A default is
 * a convenience, not a boundary — so each one is asked for somebody else's row
 * by a signed-in person who is not an admin, and must refuse.
 */
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1110000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$select public.my_entitlements('f2220000-0000-0000-0000-000000000002')$$,
  '42501', null, 'one member may not read another member''s entitlements');
select throws_ok(
  $$select public.quota_status('presentation_weekly', 'f2220000-0000-0000-0000-000000000002')$$,
  '42501', null, 'nor how much of their allowance is left');
select throws_ok(
  $$select public.my_usage('f2220000-0000-0000-0000-000000000002')$$,
  '42501', null, 'nor all of it at once');
select throws_ok(
  $$select public.current_subscription('f2220000-0000-0000-0000-000000000002')$$,
  '42501', null, 'nor whether they are paying at all');

-- Their own is theirs to read either way, or the guard would have broken every
-- screen that passes the id it already has.
select is(
  public.my_entitlements('f1110000-0000-0000-0000-000000000001'),
  public.my_entitlements(),
  'while their own answer comes back the same whether or not they name themselves');

/**
 * `my_usage` lists allowances, not switches.
 *
 * A capability with nothing to count has no bar to draw, and a row of "✓ / ✓"
 * would push the numbers somebody opened the screen for off the bottom.
 */
select set_config('request.jwt.claim.sub', 'f2220000-0000-0000-0000-000000000002', true);
select ok(
  not exists (
    select 1 from jsonb_array_elements(public.my_usage()) line
     where line ->> 'feature' in ('marketplace_buy', 'marketplace_sell', 'marketplace_edit')),
  'a switch is not a usage line');

select * from finish();
rollback;

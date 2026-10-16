begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f3330000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'notice@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Notice"}', now(), now());

insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at, plan_snapshot)
select 'f3330000-0000-0000-0000-000000000003', id, 'active', now(), now() + interval '30 days',
       jsonb_build_object('features', features)
  from public.subscription_plans where code = 'premium_monthly';

-- Eighteen of the twenty already spent.
select public.quota_consume('presentation_weekly', 18, 'f3330000-0000-0000-0000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'f3330000-0000-0000-0000-000000000003', true);

-- The nineteenth leaves one: nothing to say yet.
select lives_ok(
  $$ select public.start_generation(gen_random_uuid(), 'Birinchi mavzu', 'Birinchi', 'simple'::public.presentation_style, 8) $$,
  'the nineteenth presentation starts');
select is(
  (select count(*)::integer from public.notifications where user_id = 'f3330000-0000-0000-0000-000000000003'),
  0, 'and with one left the inbox stays quiet');

-- The twentieth spends the period, and says so.
select lives_ok(
  $$ select public.start_generation(gen_random_uuid(), 'Ikkinchi mavzu', 'Ikkinchi', 'simple'::public.presentation_style, 8) $$,
  'the twentieth presentation starts');
select is(
  (select deep_link from public.notifications
    where user_id = 'f3330000-0000-0000-0000-000000000003'
      and payload ->> 'event' = 'presentation_quota_exhausted'),
  '/(app)/tarif', 'the last one of the period leaves a notice that leads to the tariff');

-- A refunded failure spent again is the same period: no second notice.
reset role;
select public.quota_release('presentation_weekly', 1, 'f3330000-0000-0000-0000-000000000003');
set local role authenticated;
select lives_ok(
  $$ select public.start_generation(gen_random_uuid(), 'Uchinchi mavzu', 'Uchinchi', 'simple'::public.presentation_style, 8) $$,
  'a refunded presentation can be spent again');
select is(
  (select count(*)::integer from public.notifications where user_id = 'f3330000-0000-0000-0000-000000000003'),
  1, 'without saying the same thing twice');

reset role;
select * from finish();
rollback;

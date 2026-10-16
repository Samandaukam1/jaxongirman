begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_table('public', 'presentations', 'presentations table exists');
select has_table('public', 'credit_transactions', 'credit ledger exists');
select has_function('public', 'start_generation', array['uuid', 'text', 'text', 'presentation_style', 'integer', 'text', 'text', 'text[]', 'text', 'text', 'text', 'text', 'integer', 'text'], 'generation RPC exists');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'owner@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'other@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Other"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'admin@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin"}', now(), now());

insert into public.user_roles (user_id, role, granted_by)
values ('30000000-0000-0000-0000-000000000003', 'admin', '30000000-0000-0000-0000-000000000003');

select is((select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'), 100, 'signup trigger grants configured credits');

-- The welcome pages are spent, so this deck is paid in J Tanga at the page
-- rate: 10 pages × 10 J × OSON's 1.2294… for someone with no tariff = 123.
update public.presentation_credit_grants set pages_remaining = 0
 where user_id = '10000000-0000-0000-0000-000000000001';
update public.credit_wallets set balance = 200, lifetime_granted = 200
 where user_id = '10000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(public.estimate_presentation_credits('great', 10), 123, 'a 10-page estimate is the page price, whatever the style');

-- No design is chosen when a deck is started: the Liquid Glass engine invents
-- one during generation. A slug sent by an older build — here one that was
-- never published — is accepted and ignored rather than resolved.
select lives_ok(
  $$select * from public.start_generation(
    'a0000000-0000-0000-0000-000000000001', 'Alisher Navoiy hayoti va ijodi', 'Alisher Navoiy',
    'great', 10, 'Jahongir', 'D. Karimova', array['Wikipedia', 'Darslik'], 'test-generation-1',
    null, null, 'toza-qogoz'
  )$$,
  'owner can atomically start generation'
);
select is((select design_id from public.presentations where id = 'a0000000-0000-0000-0000-000000000001'), null::uuid,
  'no retired design is pinned to a new deck');
select is((select design_engine from public.presentations where id = 'a0000000-0000-0000-0000-000000000001'), 'glass_v1',
  'the deck is recorded as a Liquid Glass deck from the start');
select is((select balance from public.credit_wallets where user_id = auth.uid()), 77, 'reservation subtracts available balance');
select is((select reserved from public.credit_wallets where user_id = auth.uid()), 123, 'reservation increases reserved balance');
select is((select count(*)::integer from public.presentation_sources where presentation_id = 'a0000000-0000-0000-0000-000000000001'), 2, 'display-only sources are stored separately');
select lives_ok(
  $$select * from public.start_generation(
    'a0000000-0000-0000-0000-000000000001', 'Alisher Navoiy hayoti va ijodi', 'Alisher Navoiy',
    'great', 10, 'Jahongir', 'D. Karimova', array['Wikipedia'], 'test-generation-1',
    null, null, null
  )$$,
  'generation start is idempotent'
);
select is((select count(*)::integer from public.credit_transactions where type = 'reservation'), 1, 'idempotent retry does not reserve twice');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.presentations), 0, 'RLS hides another user presentations');
select is((select count(*)::integer from public.credit_transactions), 1, 'RLS hides another user ledger rows');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select ok(public.is_admin(), 'admin role is resolved server-side');
-- Since 202608250004 an admin's app session sees only their own decks; other
-- people's are read through the console's own RPCs, never through RLS.
select is((select count(*)::integer from public.presentations), 0, 'an admin does not see other people''s decks through RLS');

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  format(
    'select public.settle_generation(%L, 35, 0.12)',
    (select id from public.generation_jobs where presentation_id = 'a0000000-0000-0000-0000-000000000001')
  ),
  'service role can settle actual usage'
);
reset role;

select is((select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'), 77, 'a page-priced deck is charged its quote: nothing is released');
select is((select reserved from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'), 0, 'settlement clears reserved balance');
select is((select actual_credits from public.presentations where id = 'a0000000-0000-0000-0000-000000000001'), 123, 'the presentation records what it cost');

select * from finish();
rollback;

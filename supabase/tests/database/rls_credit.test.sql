begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

select has_table('public', 'presentations', 'presentations table exists');
select has_table('public', 'credit_transactions', 'credit ledger exists');
select has_function('public', 'start_generation', array['uuid', 'text', 'text', 'presentation_style', 'integer', 'text', 'text', 'text[]', 'text', 'text', 'text'], 'generation RPC exists');

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(public.estimate_presentation_credits('great', 10), 41, 'great 10-slide estimate is configuration-driven');
select lives_ok(
  $$select * from public.start_generation(
    'a0000000-0000-0000-0000-000000000001', 'Alisher Navoiy hayoti va ijodi', 'Alisher Navoiy',
    'great', 10, 'Jahongir', 'D. Karimova', array['Wikipedia', 'Darslik'], 'test-generation-1'
  )$$,
  'owner can atomically start generation'
);
select is((select balance from public.credit_wallets where user_id = auth.uid()), 59, 'reservation subtracts available balance');
select is((select reserved from public.credit_wallets where user_id = auth.uid()), 41, 'reservation increases reserved balance');
select is((select count(*)::integer from public.presentation_sources where presentation_id = 'a0000000-0000-0000-0000-000000000001'), 2, 'display-only sources are stored separately');
select lives_ok(
  $$select * from public.start_generation(
    'a0000000-0000-0000-0000-000000000001', 'Alisher Navoiy hayoti va ijodi', 'Alisher Navoiy',
    'great', 10, 'Jahongir', 'D. Karimova', array['Wikipedia'], 'test-generation-1'
  )$$,
  'generation start is idempotent'
);
select is((select count(*)::integer from public.credit_transactions where type = 'reservation'), 1, 'idempotent retry does not reserve twice');

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select is((select count(*)::integer from public.presentations), 0, 'RLS hides another user presentations');
select is((select count(*)::integer from public.credit_transactions), 1, 'RLS hides another user ledger rows');

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000003', true);
select ok(public.is_admin(), 'admin role is resolved server-side');
select is((select count(*)::integer from public.presentations), 1, 'admin can inspect presentations through RLS');

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

select is((select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'), 65, 'unused reservation is released');
select is((select reserved from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'), 0, 'settlement clears reserved balance');
select is((select actual_credits from public.presentations where id = 'a0000000-0000-0000-0000-000000000001'), 35, 'presentation records actual credits');

select * from finish();
rollback;

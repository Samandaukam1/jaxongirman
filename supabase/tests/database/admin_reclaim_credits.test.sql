begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function(
  'public', 'admin_reclaim_credits', array['uuid', 'integer', 'text', 'text'],
  'reclaim RPC exists'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'person@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Person"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'admin@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Admin"}', now(), now());

insert into public.user_roles (user_id, role, granted_by)
values ('30000000-0000-0000-0000-000000000003', 'admin', '30000000-0000-0000-0000-000000000003');

-- Act as the administrator for everything below.
set local role authenticated;
set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}';

-- A known starting point, whatever the signup trigger granted.
set local role postgres;
update public.credit_wallets set balance = 1000, reserved = 0, lifetime_granted = 1000
 where user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;

-- ---------------------------------------------------------------- the reason
select throws_ok(
  $$ select public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 10, '   ', 'k-blank') $$,
  '22023', 'reclaim reason is required',
  'a blank reason is refused: it is the only record of why a balance fell'
);

select throws_ok(
  $$ select public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 0, 'nol', 'k-zero') $$,
  '22023', 'reclaim amount must be greater than zero',
  'zero is not a reclaim'
);

-- --------------------------------------------------------- the ordinary case
select is(
  (public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 400, 'Xato yuborildi', 'k-1') ->> 'taken')::int,
  400, 'takes what was asked when the balance covers it'
);
select is(
  (select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'),
  600, 'the balance falls by exactly that much'
);
select is(
  (select lifetime_granted from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'),
  600, 'a gift taken back was not granted'
);
select is(
  (select amount from public.credit_transactions where idempotency_key = 'reclaim:k-1'),
  -400, 'the ledger records it as a negative movement'
);
select is(
  (select description from public.credit_transactions where idempotency_key = 'reclaim:k-1'),
  'Xato yuborildi', 'the reason is the ledger description'
);
-- Read as `postgres`, not as the administrator who just did it: an inbox is
-- one person's, and `notifications_select_own` has no admin escape any more —
-- which is the point of `202608250001` and is worth this two-line detour.
set local role postgres;
select is(
  (select count(*)::int from public.notifications
    where user_id = '10000000-0000-0000-0000-000000000001' and body = 'Xato yuborildi'),
  1, 'the person is told, in the admin''s own words'
);
select is(
  (select kind::text from public.notifications
    where user_id = '10000000-0000-0000-0000-000000000001' and body = 'Xato yuborildi'),
  'system', 'not a gift: the app throws a celebration overlay for those'
);
set local role authenticated;

-- The other half of the same rule, asserted from the side that used to break
-- it: an administrator reading the table gets their own inbox and no one
-- else's, including the person they just took coins from.
select is(
  (select count(*)::int from public.notifications
    where user_id = '10000000-0000-0000-0000-000000000001'),
  0, 'an admin cannot read somebody else''s inbox through an ordinary query'
);

-- The same rule on the tables the app lists. An administrator's own app should
-- show their own work, and `request_export` refusing a deck they can see but do
-- not own is what made this visible.
set local role postgres;
insert into public.presentations (id, owner_id, title, status, style)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001',
        'Boshqa odamning taqdimoti', 'ready', 'professional');
set local role authenticated;

select is(
  (select count(*)::int from public.presentations
    where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  0, 'an admin does not see somebody else''s deck in an ordinary query'
);
select is(
  (select count(*)::int from public.credit_wallets
    where user_id = '10000000-0000-0000-0000-000000000001'),
  0, 'nor somebody else''s wallet'
);

-- ------------------------------------------------------------- the same press
select is(
  (public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 400, 'Xato yuborildi', 'k-1') ->> 'applied'),
  'false', 'the same key twice takes nothing the second time'
);
select is(
  (select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'),
  600, 'and the balance is untouched by it'
);

-- ------------------------------------------------- more than is left to take
select is(
  (public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 5000, 'Hammasini', 'k-2') ->> 'taken')::int,
  600, 'takes what is there rather than failing on the rest'
);
select is(
  (public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 100, 'Bo''sh', 'k-3') ->> 'shortfall')::int,
  100, 'an empty balance yields the whole amount as shortfall'
);
select is(
  (select balance from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'),
  0, 'and never goes below zero'
);

-- ------------------------------------------------------------ reserved funds
set local role postgres;
update public.credit_wallets set balance = 50, reserved = 200
 where user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;

select is(
  (public.admin_reclaim_credits('10000000-0000-0000-0000-000000000001', 250, 'Band emas', 'k-4') ->> 'taken')::int,
  50, 'work already in flight is paid for and is not clawed back under it'
);
select is(
  (select reserved from public.credit_wallets where user_id = '10000000-0000-0000-0000-000000000001'),
  200, 'reserved is left exactly as it was'
);

select * from finish();
rollback;

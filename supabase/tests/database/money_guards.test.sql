begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

/*
 * Nobody makes J Tanga from a phone.
 *
 * Coins enter an account in exactly three ways: a payment the provider
 * confirmed (server only), an admin's grant (admin role checked), and another
 * person's transfer (which takes them from that person). These assertions keep
 * it that way: a new function that writes balances and is open to a signed-in
 * client, or a money table a client can write, fails here before it ships.
 */

select is(
  (select array_agg(c.relname::text order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relkind = 'r'
      and c.relname in ('credit_wallets', 'credit_transactions', 'coin_lots', 'orders', 'payment_transactions',
                        'purchase_entitlements', 'user_subscriptions', 'presentation_page_grants')
      and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE'))),
  null,
  'no client can write a balance, a ledger row, an order or an entitlement directly'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prosecdef and pg_get_function_result(p.oid) <> 'trigger'
      and p.prosrc ~* 'update\s+public\.credit_wallets'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname not like 'admin\_%'),
  array['retry_generation', 'start_generation', 'transfer_credits'],
  'outside the admin functions, a signed-in client reaches balances only by spending or by sending its own coins'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prosecdef and p.proname like 'admin\_%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.prosrc !~* '(is_admin|is_super_admin|assert_admin|assert_super_admin|admin_require|require_admin|has_admin_role|admin_role)'),
  null,
  'every admin function a client can call checks the admin role'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('order_fulfil', 'order_fulfil_and_remember_card', 'jcoin_refund', 'jcoin_settle', 'jcoin_reserve',
                        'plan_lot_grant', 'grant_welcome_pages', 'game_reward_pay', 'marketplace_settle_payment', 'fail_generation', 'settle_generation')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  null,
  'fulfilling, refunding, rewarding and granting are the server''s alone'
);

-- A transfer never mints: it takes from the sender what it gives.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'm1@example.com', '', now(), '{}', '{"full_name":"M1"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'm2@example.com', '', now(), '{}', '{"full_name":"M2"}', now(), now());
update public.credit_wallets set balance = 500 where user_id = 'a1000000-0000-0000-0000-000000000001';
update public.credit_wallets set balance = 0 where user_id = 'a2000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.transfer_credits('a2000000-0000-0000-0000-000000000002', 200, 'test', 'guard-1');
select public.transfer_credits('a2000000-0000-0000-0000-000000000002', 200, 'test', 'guard-1');
reset role;
select is((select sum(balance)::int from public.credit_wallets where user_id in ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
  500, 'a transfer, even sent twice, leaves the total where it was');

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

/*
 * Anyone signed in may buy from the shop; selling still needs a plan.
 *
 *   S  a seller with a plan that lets them sell
 *   B  a buyer with no plan at all
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's@example.com', '', now(), '{}', '{"full_name":"S"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '52000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b@example.com', '', now(), '{}', '{"full_name":"B"}', now(), now());

insert into public.marketplace_products (id, seller_id, material_type, title, description, status, base_price)
values ('53000000-0000-0000-0000-000000000003', '51000000-0000-0000-0000-000000000001', 'presentation',
        'Tayyor taqdimot', 'Sinov uchun', 'approved', 10000);

select is(public.my_entitlements('52000000-0000-0000-0000-000000000002') ->> 'member', 'false', 'the buyer has no plan');

set local role authenticated;
set local request.jwt.claims = '{"sub":"52000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok($$ select public.assert_marketplace_member('buy') $$, 'buying needs no plan');
select throws_ok($$ select public.assert_marketplace_member('sell') $$,
  '42501', 'Do‘konda sotish uchun tarifni faollashtiring.', 'selling still does, and says so');

select throws_ok($$ select public.order_create_marketplace('53000000-0000-0000-0000-000000000003'::uuid, 'ios', false) $$,
  '42501', 'Xaridni tasdiqlash uchun qaytarish shartlariga rozilik bering.',
  'the refund rule is still asked for');
select lives_ok($$ select public.order_create_marketplace('53000000-0000-0000-0000-000000000003'::uuid, 'ios', true) $$,
  'a buyer without a plan opens an order on the path the app takes');
select is((select count(*)::int from public.orders where user_id = '52000000-0000-0000-0000-000000000002'
            and product_id = '53000000-0000-0000-0000-000000000003'),
  1, 'and the order is theirs');

reset role;
set local role anon;
select throws_ok($$ select public.assert_marketplace_member('buy') $$, '42501', null,
  'somebody not signed in cannot even ask');

select * from finish();
rollback;

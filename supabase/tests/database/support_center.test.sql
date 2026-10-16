begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

/*
 * The support desk, people only: a person's tickets are theirs, internal
 * notes never reach them, a reply tells them, agents and managers have the
 * powers their role names and no more.
 *
 *   U  person with a question      V  another person
 *   A  support agent               B  second agent
 *   M  support manager             S  super admin
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'u@example.com', '', now(), '{}', '{"full_name":"Umid"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'v@example.com', '', now(), '{}', '{"full_name":"Vali"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'agent@example.com', '', now(), '{}', '{"full_name":"Agent A"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'agent2@example.com', '', now(), '{}', '{"full_name":"Agent B"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', 'manager@example.com', '', now(), '{}', '{"full_name":"Manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', 'super@example.com', '', now(), '{}', '{"full_name":"Super"}', now(), now());

insert into public.user_roles (user_id, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'support_agent'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'support_agent'),
  ('cccccccc-0000-0000-0000-00000000000c', 'support_manager'),
  ('dddddddd-0000-0000-0000-00000000000d', 'super_admin');

-- An order of U's, and one of V's.
insert into public.orders (id, user_id, purpose, coin_package_id, currency, subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue)
select o.id, o.user_id, 'jcoin', (select id from public.coin_packages where code = 'jt_100'), 'UZS', 2900, 0, 2900, 0, 2900, 0
  from (values ('0e000000-0000-0000-0000-000000000001'::uuid, '11111111-0000-0000-0000-000000000001'::uuid),
               ('0e000000-0000-0000-0000-000000000002'::uuid, '22222222-0000-0000-0000-000000000002'::uuid)) as o(id, user_id);
create temp table order_numbers as select id, order_number from public.orders where id in ('0e000000-0000-0000-0000-000000000001', '0e000000-0000-0000-0000-000000000002');
grant select on order_numbers to authenticated;

-- A screenshot U uploaded, and one V uploaded.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('support-attachments', '11111111-0000-0000-0000-000000000001/t/shot.png', '11111111-0000-0000-0000-000000000001', '{"mimetype":"image/png","size":2048}'),
  ('support-attachments', '22222222-0000-0000-0000-000000000002/t/other.png', '22222222-0000-0000-0000-000000000002', '{"mimetype":"image/png","size":1024}');

select is(public.is_admin('aaaaaaaa-0000-0000-0000-00000000000a'), false, 'a support agent is not an administrator');
select is(public.is_support_staff('aaaaaaaa-0000-0000-0000-00000000000a'), true, '...but is support staff');

-- ------------------------------------------------------------- the person
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(format('select public.support_create_ticket(%L, %L, %L, %L)', 'payments', 'To''lov tushmadi', 'Pul yechildi', (select order_number from order_numbers where id = '0e000000-0000-0000-0000-000000000002')),
  'P0002', null, 'somebody else''s order cannot be named in a ticket');
select throws_ok($$ select public.support_create_ticket('payments', 'To''lov tushmadi', 'Rasm', null, null, null, array['22222222-0000-0000-0000-000000000002/t/other.png']) $$,
  '42501', null, 'somebody else''s upload cannot be attached');
select throws_ok($$ select public.support_create_ticket('payments', 'To''lov tushmadi', 'Rasm', null, null, null, array['11111111-0000-0000-0000-000000000001/t/missing.png']) $$,
  'P0002', null, 'a file that was never uploaded cannot be attached');
select lives_ok(format('select public.support_create_ticket(%L, %L, %L, %L, %L, null, array[%L])', 'payments', 'To''lov tushmadi', 'Pul yechildi, J Tanga kelmadi',
  (select order_number from order_numbers where id = '0e000000-0000-0000-0000-000000000001'), 'PAYME-123', '11111111-0000-0000-0000-000000000001/t/shot.png'),
  'the person opens a ticket naming their order and a screenshot');

select is((select status from public.support_tickets where user_id = auth.uid()), 'open', 'a new ticket is open');
select is((select staff_unread from public.support_tickets where user_id = auth.uid()), 1, '...and unread by the desk');
select is((select count(*)::int from public.support_attachments), 1, 'its screenshot is attached');
select matches((select ticket_number from public.support_tickets where user_id = auth.uid()), '^S-[0-9]{6}$', 'tickets are numbered S-000000');
select is(jsonb_array_length(public.my_support_tickets()), 1, 'the person lists their ticket');
select throws_ok($$ select public.support_inbox() $$, '42501', null, 'the person has no inbox');

-- ------------------------------------------------------------- privacy
set local request.jwt.claims = '{"sub":"22222222-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.support_tickets), 0, 'another person sees no ticket of U''s');
select is((select count(*)::int from public.support_messages), 0, '...nor its messages');
select throws_ok(format('select public.support_ticket_detail(%L)', (select id from public.support_tickets limit 1)),
  'P0002', null, '...nor can open it by id');

-- ------------------------------------------------------------- the desk
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';
select is(public.current_app_role()::text, 'support_agent', 'the console sees an agent');
select is(jsonb_array_length(public.support_inbox() -> 'tickets'), 1, 'the agent''s inbox has the ticket');
select ok((public.support_ticket_context((select id from public.support_tickets limit 1)) -> 'user') ? 'full_name', 'the desk sees the person''s name');
select ok(not ((public.support_ticket_context((select id from public.support_tickets limit 1)) -> 'user') ? 'email'), '...and not their email');
select is(public.support_ticket_context((select id from public.support_tickets limit 1)) -> 'related_order' ->> 'order_number',
  (select order_number from order_numbers where id = '0e000000-0000-0000-0000-000000000001'), '...and the order the ticket names');

select lives_ok(format('select public.support_staff_reply(%L, %L)', (select id from public.support_tickets limit 1), 'Tekshirib ko‘ramiz, iltimos kuting.'),
  'the agent answers');
select lives_ok(format('select public.support_staff_reply(%L, %L, true)', (select id from public.support_tickets limit 1), 'Payme kabinetini tekshirish kerak'),
  'the agent leaves an internal note');
select is((select assignee_id from public.support_tickets limit 1), 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid, 'answering an unassigned ticket takes it');
select is((select status from public.support_tickets limit 1), 'waiting_for_user', 'a public answer waits for the person');
select throws_ok(format('select public.support_update_ticket(%L, null, null, %L)', (select id from public.support_tickets limit 1), 'bbbbbbbb-0000-0000-0000-00000000000b'),
  '42501', null, 'an agent cannot hand a ticket to another agent');
select throws_ok($$ select public.admin_set_support_role('v@example.com', 'support_agent', true) $$, '42501', null, 'an agent cannot make staff');

set local role postgres;
select is((select count(*)::int from public.notifications where user_id = '11111111-0000-0000-0000-000000000001' and kind = 'support_reply'),
  1, 'the person is told once: the note told nobody');
set local role authenticated;

-- ------------------------------------------------------------- the person again
set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.support_unread_count(), 1, 'the person has one unread answer');
select is(jsonb_array_length(public.support_ticket_detail((select id from public.support_tickets limit 1)) -> 'messages'), 2,
  'the person sees their message and the answer, not the note');
select is((select count(*)::int from public.support_messages where is_internal), 0, 'the note is invisible to them even read directly');
select is(public.support_ticket_detail((select id from public.support_tickets limit 1)) -> 'messages' -> 1 ->> 'author_name',
  'Yordam xizmati', 'the person sees the desk, not the agent''s name');
select is(public.support_unread_count(), 0, 'reading it marks it read');
select lives_ok(format('select public.support_reply(%L, %L)', (select id from public.support_tickets limit 1), 'Kutaman, rahmat'), 'the person replies');
select is((select status from public.support_tickets limit 1), 'open', '...which opens the ticket again for the desk');

-- ------------------------------------------------------------- manager, resolve, reopen, close
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';
select lives_ok(format('select public.support_update_ticket(%L, %L, %L, %L)', (select id from public.support_tickets limit 1), 'resolved', 'high', 'bbbbbbbb-0000-0000-0000-00000000000b'),
  'a manager resolves it, raises it and hands it to another agent');
set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(format('select public.support_reopen(%L)', (select id from public.support_tickets limit 1)), 'the person reopens a resolved ticket');
select is((select reopened_count from public.support_tickets limit 1), 1, '...and it is counted');

set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';
select lives_ok(format('select public.support_update_ticket(%L, %L)', (select id from public.support_tickets limit 1), 'closed'), 'the manager closes it');
set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(format('select public.support_reply(%L, %L)', (select id from public.support_tickets limit 1), 'Yana savol'),
  'P0001', null, 'a closed ticket takes no more messages');

-- ------------------------------------------------------------- limits and roles
select lives_ok($$ select public.support_create_ticket('other', 'Ikkinchi savol', 'Matn'); select public.support_create_ticket('other', 'Uchinchi savol', 'Matn');
                   select public.support_create_ticket('other', 'To''rtinchi savol', 'Matn'); select public.support_create_ticket('other', 'Beshinchi savol', 'Matn') $$,
  'four more tickets today');
select throws_ok($$ select public.support_create_ticket('other', 'Oltinchi savol', 'Matn') $$, 'P0001', null, 'the sixth in a day is refused');

set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}';
select is((public.admin_set_support_role('V@Example.com', 'support_agent', true) ->> 'granted')::boolean, true, 'a super admin makes V an agent, by email');

select * from finish();
rollback;

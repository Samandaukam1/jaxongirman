begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function(
  'public', 'fail_stale_generations', array['integer'],
  'the watchdog exists'
);

/* A person with credits, and three jobs in different conditions. */
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'stale@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.credit_wallets (user_id, balance, reserved)
values ('90000000-0000-0000-0000-000000000001', 500, 120)
on conflict (user_id) do update set balance = 500, reserved = 120;

insert into public.presentations (id, owner_id, title, topic, style, slide_count, status)
values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Stale', 'Stale', 'super_professional', 5, 'generating'),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Fresh', 'Fresh', 'super_professional', 5, 'generating'),
  ('91000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Done',  'Done',  'super_professional', 5, 'ready');

insert into public.generation_jobs (id, presentation_id, owner_id, status, stage, reserved_credits, heartbeat_at, created_at)
values
  -- Died an hour ago, mid-stage, holding 70 credits.
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
   '90000000-0000-0000-0000-000000000001', 'running', 'writing_content', 70, now() - interval '60 minutes', now() - interval '61 minutes'),
  -- Working right now. Must not be touched: killing a live deck under its
  -- author is worse than the stall this function exists to clear.
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002',
   '90000000-0000-0000-0000-000000000001', 'running', 'writing_content', 50, now(), now() - interval '2 minutes'),
  -- Already finished long ago, and its credits were settled at the time.
  ('92000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000003',
   '90000000-0000-0000-0000-000000000001', 'succeeded', 'ready', 40, now() - interval '90 minutes', now() - interval '95 minutes');

insert into public.generation_steps (job_id, presentation_id, owner_id, sequence, key, label, status, progress, started_at)
values ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
        '90000000-0000-0000-0000-000000000001', 4, 'writing_content', 'Mazmun yozilmoqda', 'running', 5, now() - interval '60 minutes');

/* ------------------------------------------------------------- the sweep */

select is(
  (select public.fail_stale_generations(8)), 1,
  'exactly the stalled job is swept'
);

select is(
  (select status::text from public.generation_jobs where id = '92000000-0000-0000-0000-000000000001'),
  'failed', 'the stalled job is failed'
);
select is(
  (select error_code from public.generation_jobs where id = '92000000-0000-0000-0000-000000000001'),
  'stalled', 'it says why, in a code a query can group by'
);
select isnt(
  (select error_message from public.generation_jobs where id = '92000000-0000-0000-0000-000000000001'),
  null, 'and in a sentence a person can read'
);

/* The point of the whole exercise: the money comes back. */
select is(
  (select balance from public.credit_wallets where user_id = '90000000-0000-0000-0000-000000000001'),
  570, 'the reserved credits are returned to the balance'
);
select is(
  (select reserved from public.credit_wallets where user_id = '90000000-0000-0000-0000-000000000001'),
  50, 'and released from the reservation, leaving only the live job''s hold'
);
select is(
  (select count(*)::integer from public.credit_transactions
   where job_id = '92000000-0000-0000-0000-000000000001' and type = 'refund'),
  1, 'the refund is in the ledger, once'
);

/* A live deck is not collateral. */
select is(
  (select status::text from public.generation_jobs where id = '92000000-0000-0000-0000-000000000002'),
  'running', 'a job that is still moving is left alone'
);
/* A finished deck is not re-refunded. */
select is(
  (select status::text from public.generation_jobs where id = '92000000-0000-0000-0000-000000000003'),
  'succeeded', 'a job that already ended is untouched'
);
select is(
  (select count(*)::integer from public.credit_transactions
   where job_id = '92000000-0000-0000-0000-000000000003' and type = 'refund'),
  0, 'and is never refunded a second time'
);

/* The author's progress list must not keep spinning on a dead stage. */
select is(
  (select status from public.generation_steps
   where job_id = '92000000-0000-0000-0000-000000000001' and key = 'writing_content'),
  'failed', 'the step it died on stops saying it is running'
);
select is(
  (select error_code from public.generation_steps
   where job_id = '92000000-0000-0000-0000-000000000001' and key = 'writing_content'),
  'stalled', 'and carries the same code as the job'
);

/* Running it again is a no-op, which is what makes it safe to call often. */
select is(
  (select public.fail_stale_generations(8)), 0,
  'a second sweep finds nothing and refunds nothing'
);
select is(
  (select balance from public.credit_wallets where user_id = '90000000-0000-0000-0000-000000000001'),
  570, 'so the balance does not drift upward on every call'
);

select * from finish();
rollback;

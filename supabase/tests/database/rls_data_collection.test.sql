begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

-- ---------------------------------------------------------------- fixtures --
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aaaa0000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'creator@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Creator One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbb0000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'respondent@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Respondent Two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccc0000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'other@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Other Three"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'dddd0000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'moderator@example.com', crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Moderator Four"}', now(), now());

insert into public.user_roles (user_id, role) values ('dddd0000-0000-0000-0000-000000000004', 'admin');

update public.profiles set username = 'creatorone' where id = 'aaaa0000-0000-0000-0000-000000000001';
update public.profiles set username = 'respondenttwo' where id = 'bbbb0000-0000-0000-0000-000000000002';

-- ------------------------------------------------------------- structure --
select has_table('public', 'survey_forms', 'survey_forms exists');
select has_table('public', 'survey_responses', 'survey_responses exists');
select has_table('public', 'module_entitlements', 'module_entitlements exists');
select has_table('public', 'coin_packages', 'coin_packages exists');
select hasnt_table('public', 'survey_drafts', 'there is no draft table for partial answers to live in');

-- The single most important privilege in the module: a signed-in client has no
-- way to write a response except through the RPC that validates it whole.
select ok(not has_table_privilege('authenticated', 'public.survey_responses', 'INSERT'), 'clients cannot insert responses directly');
select ok(not has_table_privilege('authenticated', 'public.survey_answers', 'INSERT'), 'clients cannot insert answers directly');
select ok(not has_table_privilege('anon', 'public.survey_forms', 'SELECT'), 'anonymous callers cannot reach surveys at all');

-- ------------------------------------------------------------ text rules --
select ok(public.is_latin_text('O‘ktam G‘ulomov'), 'Uzbek Latin with apostrophe variants passes');
select ok(not public.is_latin_text('Жаҳонгир'), 'Cyrillic is rejected');
select is(public.normalize_uz_phone('90 123 45 67'), '+998901234567', 'nine digits normalize to +998');
select is(public.normalize_uz_phone('12345'), null, 'a short number is not a phone number');

-- ---------------------------------------------------------- authoring --
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- The form id is fixed rather than generated, because from here on the tests
-- read it as roles that RLS deliberately hides the row from.
insert into public.survey_forms (id, owner_id, title)
values ('f0000000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'Guruh ma''lumotlari');

select lives_ok(
  $$select public.save_survey_form(
      'f0000000-0000-0000-0000-000000000001', 'Guruh ma''lumotlari', 'Talabalar ro''yxati', now() + interval '2 days', 3, 'Faqat dekanat uchun',
      '[{"type":"short_text","label":"F.I.Sh.","is_required":true,"latin_only":true},
        {"type":"phone","label":"Telefon","is_required":true},
        {"type":"single_choice","label":"Kurs","is_required":true,"options":[{"label":"1-kurs"},{"label":"2-kurs"}]}]'::jsonb
    )$$,
  'owner creates a survey and its questions in one call'
);
select is((select count(*)::integer from public.survey_questions), 3, 'all three questions were written');
select is((select count(*)::integer from public.survey_question_options), 2, 'choice options were written');

select lives_ok(
  $$select public.set_survey_status('f0000000-0000-0000-0000-000000000001', 'open')$$,
  'owner opens the survey'
);

-- --------------------------------------------------------- responding --
select set_config('request.jwt.claim.sub', 'bbbb0000-0000-0000-0000-000000000002', true);

select ok(
  (public.open_survey('f0000000-0000-0000-0000-000000000001') -> 'form' ->> 'title') = 'Guruh ma''lumotlari',
  'a respondent can open the survey from its link'
);
select is((select count(*)::integer from public.survey_participants), 1, 'opening the link registers a participant');

-- A Cyrillic answer to a latin_only question must be refused...
select throws_ok(
  $$select public.submit_survey_response(
      'f0000000-0000-0000-0000-000000000001',
      (select jsonb_agg(case q.type
         when 'short_text' then jsonb_build_object('question_id', q.id, 'text', 'Жаҳонгир')
         when 'phone' then jsonb_build_object('question_id', q.id, 'text', '901234567')
         else jsonb_build_object('question_id', q.id, 'option_ids',
                jsonb_build_array((select o.id from public.survey_question_options o where o.question_id = q.id order by o.position limit 1)))
       end)
       from public.survey_questions q),
      'cyrillic-attempt'
    )$$,
  '22023',
  null,
  'a Cyrillic answer to a latin-only question is refused'
);

-- ...and, critically, must leave nothing behind. The response row is inserted
-- before the answers are validated, so this asserts the rollback that makes
-- "an abandoned or rejected form stores nothing" true rather than aspirational.
select is((select count(*)::integer from public.survey_responses), 0, 'a rejected submission stores no response row');
select is((select count(*)::integer from public.survey_answers), 0, 'a rejected submission stores no answers');

select ok(
  (public.submit_survey_response(
    'f0000000-0000-0000-0000-000000000001',
    (select jsonb_agg(case q.type
       when 'short_text' then jsonb_build_object('question_id', q.id, 'text', 'Jahongir Qurbonnazarov')
       when 'phone' then jsonb_build_object('question_id', q.id, 'text', '90 123 45 67')
       else jsonb_build_object('question_id', q.id, 'option_ids',
              jsonb_build_array((select o.id from public.survey_question_options o where o.question_id = q.id order by o.position limit 1)))
     end)
     from public.survey_questions q),
    'submit-1'
  ) ->> 'applied')::boolean,
  'a valid submission is accepted'
);

select is((select count(*)::integer from public.survey_answers), 3, 'every answer was written in the same transaction');
select is(
  (select value_text from public.survey_answers a join public.survey_questions q on q.id = a.question_id where q.type = 'phone'),
  '+998901234567',
  'the phone answer is stored normalized'
);
select is((select submitted_count from public.survey_forms where id = 'f0000000-0000-0000-0000-000000000001'), 1, 'the form counter follows the response');
select ok(
  (select expires_at > now() + interval '47 hours' and expires_at < now() + interval '49 hours' from public.survey_responses),
  'the response carries a 48-hour retention window'
);

-- One response per person, whatever the client does.
select is(
  (public.submit_survey_response(
    'f0000000-0000-0000-0000-000000000001', '[]'::jsonb, 'submit-2'
  ) ->> 'applied')::boolean,
  false,
  'a second submission by the same person is a no-op'
);

-- ------------------------------------------------------------------ RLS --
select set_config('request.jwt.claim.sub', 'cccc0000-0000-0000-0000-000000000003', true);
select is((select count(*)::integer from public.survey_answers), 0, 'another respondent cannot read anyone else''s answers');
select is((select count(*)::integer from public.survey_responses), 0, 'another respondent cannot see that a response exists');

select set_config('request.jwt.claim.sub', 'dddd0000-0000-0000-0000-000000000004', true);
select ok(public.is_admin(), 'the moderator holds the admin role');
select is((select count(*)::integer from public.survey_forms), 1, 'an admin can see the survey itself, for moderation');
-- Privacy-first moderation: the console can act on a survey without ever being
-- able to read what people wrote in it.
select is((select count(*)::integer from public.survey_answers), 0, 'an admin cannot read survey answers');

select set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-000000000001', true);
select is((select count(*)::integer from public.survey_answers), 3, 'the owner can read the answers to their own survey');
select throws_ok(
  $$select public.save_survey_form(
      'f0000000-0000-0000-0000-000000000001', 'Guruh ma''lumotlari', '', null, null, '',
      '[{"type":"short_text","label":"Yangi savol"}]'::jsonb)$$,
  '42501',
  null,
  'questions cannot be rewritten once a response points at them'
);

-- ------------------------------------------------------------ transfers --
select set_config('request.jwt.claim.sub', 'bbbb0000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$select public.transfer_credits('bbbb0000-0000-0000-0000-000000000002', 10, '', 'self')$$,
  '22023',
  null,
  'nobody can send coins to themselves'
);
select throws_ok(
  $$select public.transfer_credits('aaaa0000-0000-0000-0000-000000000001', 999999, '', 'overdraw')$$,
  '22023',
  null,
  'a transfer larger than the balance is refused'
);

select is(
  (public.transfer_credits('aaaa0000-0000-0000-0000-000000000001', 40, 'Rahmat', 'transfer-1') ->> 'balance')::integer,
  60,
  'a transfer leaves the sender with the remainder'
);
select is(
  (public.transfer_credits('aaaa0000-0000-0000-0000-000000000001', 40, 'Rahmat', 'transfer-1') ->> 'applied')::boolean,
  false,
  'replaying the same idempotency key does not pay twice'
);
select is(
  (select count(*)::integer from public.credit_transactions where type = 'transfer_out'),
  1,
  'the sender holds exactly one outgoing ledger row'
);

-- Read from the other side of the transfer. The sender cannot see any of the
-- three rows below — which is the point, and is why the assertions move rather
-- than the code: RLS scopes a wallet, a ledger row and an inbox to one person.
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-000000000001', true);
select is(
  (select balance from public.credit_wallets where user_id = 'aaaa0000-0000-0000-0000-000000000001'),
  140,
  'the coins land in full on the recipient'
);
select is(
  (select count(*)::integer from public.credit_transactions where type = 'transfer_in'),
  1,
  'the recipient holds exactly one incoming ledger row'
);
select is(
  (select count(*)::integer from public.notifications where kind = 'credit_received'),
  1,
  'the recipient is told once'
);

reset role;
select * from finish();
rollback;

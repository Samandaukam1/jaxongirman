begin;

create extension if not exists pgtap with schema extensions;
select plan(39);

/*
 * Three languages: a person's interface language, each deck's own language,
 * the Latin-only rule for Uzbek decks, the operator's switches, and the
 * translations of what operators write — each change audited.
 *
 *   U  an ordinary account (Uzbek, then Russian)
 *   M  an admin who is not a super admin
 *   S  super admin
 */

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'u@example.com', '', now(), '{}', '{"full_name":"U"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'm@example.com', '', now(), '{}', '{"full_name":"M"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 's@example.com', '', now(), '{}', '{"full_name":"S"}', now(), now());

insert into public.user_roles (user_id, role, granted_by) values
  ('20000000-0000-0000-0000-000000000002', 'admin', '30000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000003', 'admin', '30000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000003', 'super_admin', '30000000-0000-0000-0000-000000000003');

-- ------------------------------------------------------------- the columns
select is((select preferred_language from public.profiles where id = '10000000-0000-0000-0000-000000000001'),
  'uz', 'a new account speaks Uzbek');
select throws_ok($$ update public.profiles set preferred_language = 'de' where id = '10000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'only uz, en and ru are languages');
select ok(public.has_cyrillic('Ўзбекистон тарихи'), 'Uzbek Cyrillic is Cyrillic');
select ok(public.has_cyrillic('Navoiy ва ғазал'), 'one Cyrillic word in Latin text is found');
select ok(not public.has_cyrillic('Sun’iy intellektning ta’limdagi o‘rni — 2026'), 'Uzbek Latin with every apostrophe is not');

-- ------------------------------------------------------------ deck language
-- Enough J Tanga for the decks past the three free ones.
update public.credit_wallets set balance = 5000 where user_id = '10000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000001', 'Ўзбекистон иқтисодиёти', 'Ўзбекистон', 'simple', 10,
    null, null, '{}', 'u-uz-cyr', p_language => 'uz')
$$, '22023', 'Mavzuni lotin yozuvida kiriting.', 'an Uzbek deck refuses a Cyrillic topic');
select throws_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000002', 'Iqtisodiyot', 'Сунъий интеллект', 'simple', 10,
    null, null, '{}', 'u-uz-cyr-title', p_language => 'uz')
$$, '22023', 'Mavzuni lotin yozuvida kiriting.', '...and a Cyrillic title');
select throws_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000003', 'Topic', 'Topic', 'simple', 10,
    null, null, '{}', 'u-de', p_language => 'de')
$$, '22023', null, 'an unknown deck language is refused');

select lives_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000004', 'Экономика Узбекистана', 'Экономика', 'simple', 10,
    null, null, '{}', 'u-ru', p_language => 'ru')
$$, 'a Russian deck takes a Cyrillic topic');
select lives_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000005', 'Sun’iy intellekt va ta’lim', 'Sun’iy intellekt', 'simple', 10,
    null, null, '{}', 'u-uz', p_language => 'uz')
$$, 'an Uzbek deck takes a Latin topic with apostrophes');
select lives_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000006', 'Artificial intelligence', 'AI', 'simple', 10,
    null, null, '{}', 'u-en', p_language => 'en')
$$, 'an English deck takes an English topic');
select lives_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000007', 'Tarix', 'Tarix', 'simple', 10,
    null, null, '{}', 'u-default')
$$, 'a deck started without a language still starts');

select is((select language from public.presentations where id = '11000000-0000-0000-0000-000000000004'), 'ru', 'the Russian deck is stored as Russian');
select is((select language from public.presentations where id = '11000000-0000-0000-0000-000000000006'), 'en', 'the English deck as English');
select is((select language from public.presentations where id = '11000000-0000-0000-0000-000000000007'), 'uz', 'a deck with no language is Uzbek');

-- ---------------------------------------------------------- the switches
set local role authenticated;
set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.admin_set_language_settings('{"ui":["uz","en"],"deck":["uz","en"]}'::jsonb, 'test') $$,
  '42501', null, 'an admin who is not a super admin cannot switch languages');

set local request.jwt.claims = '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.admin_set_language_settings('{"ui":["en","ru"],"deck":["uz"]}'::jsonb, 'test') $$,
  '22023', 'Uzbek cannot be switched off', 'Uzbek cannot be switched off');
select throws_ok($$ select public.admin_set_language_settings('{"ui":["uz","de"],"deck":["uz"]}'::jsonb, 'test') $$,
  '22023', null, 'an unknown language cannot be switched on');
select lives_ok($$ select public.admin_set_language_settings('{"ui":["uz","en","ru"],"deck":["uz","en"]}'::jsonb, 'ru decks paused') $$,
  'a super admin switches Russian decks off');
select is((select value -> 'deck' from public.app_settings where key = 'i18n.languages'), '["en", "uz"]'::jsonb,
  'the setting holds the languages that stay on');
select is((select count(*)::int from public.admin_audit_logs where action = 'languages.updated' and reason = 'ru decks paused'),
  1, 'the switch is audited with its reason');

set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000008', 'История', 'История', 'simple', 10,
    null, null, '{}', 'u-ru-off', p_language => 'ru')
$$, '22023', 'Bu tilda taqdimot yaratish hozircha o‘chirilgan.', 'a switched-off deck language is refused');
select lives_ok($$
  select * from public.start_generation('11000000-0000-0000-0000-000000000009', 'Tarix fani', 'Tarix', 'simple', 10,
    null, null, '{}', 'u-uz-still', p_language => 'uz')
$$, 'Uzbek decks go on');

-- ------------------------------------------------------- the translations
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.admin_set_translation('subscription_plan', (select id::text from public.subscription_plans where code = 'oson'), 'name', '{"en":"Easy"}'::jsonb) $$,
  '42501', null, 'an ordinary account cannot translate');

set local request.jwt.claims = '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.admin_set_translation('subscription_plan', (select id::text from public.subscription_plans where code = 'oson'), 'name', '{"en":"Easy","ru":"Легко"}'::jsonb, 'launch') $$,
  'an admin translates a plan name');
select is((select name_i18n ->> 'ru' from public.subscription_plans where code = 'oson'), 'Легко', 'the Russian name is stored');
select is((select after_data -> 'values' ->> 'en' from public.admin_audit_logs where action = 'translation.updated' and target_type = 'subscription_plan'),
  'Easy', 'the audit row holds the new value');
select lives_ok($$ select public.admin_set_translation('subscription_plan', (select id::text from public.subscription_plans where code = 'oson'), 'name', '{"en":""}'::jsonb) $$,
  'an empty string clears a language');
select is((select name_i18n ? 'en' from public.subscription_plans where code = 'oson'), false, '...so the app falls back to Uzbek');
-- Rows written in one transaction share a timestamp, so the clearing is found by what it left.
select is((select before_data -> 'values' ->> 'en' from public.admin_audit_logs
            where action = 'translation.updated' and target_type = 'subscription_plan' and not (after_data -> 'values' ? 'en')),
  'Easy', 'the clearing is audited with the value before');
select throws_ok($$ select public.admin_set_translation('subscription_plan', (select id::text from public.subscription_plans where code = 'oson'), 'price_amount', '{"en":"1"}'::jsonb) $$,
  '22023', null, 'only words are translatable, never a price');
select throws_ok($$ select public.admin_set_translation('subscription_plan', (select id::text from public.subscription_plans where code = 'oson'), 'name', '{"uz":"Oson"}'::jsonb) $$,
  '22023', null, 'Uzbek is the source and is not edited here');

select lives_ok($$ select public.admin_set_translation('setting', 'marketplace.refund_policy', 'checkbox_label', '{"ru":"Я понимаю, что цифровой товар не возвращается."}'::jsonb) $$,
  'the refund policy is translated');
select lives_ok($$ select public.admin_set_translation('setting', 'payments.ios_policy', 'copy.jcoin', '{"en":"J Tanga is not available in the iOS app."}'::jsonb) $$,
  'the iOS notice is translated');
select is((public.payment_policy('ios') -> 'copy_i18n' -> 'en' ->> 'jcoin'), 'J Tanga is not available in the iOS app.',
  'the payment policy carries the translation');
select ok((public.admin_language_overview() -> 'coverage' ->> 'total')::int > 0, 'the overview counts translatable content');
select is((public.admin_language_overview() -> 'decks' -> 'ru' ->> 'total')::int, 1, 'the overview counts decks per language');

-- The buyer agrees to the words they read.
set local role postgres;
update public.profiles set preferred_language = 'ru' where id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.marketplace_refund_ack(true) ->> 'accepted_text'), 'Я понимаю, что цифровой товар не возвращается.',
  'a Russian reader agrees to the Russian sentence');
select is((public.marketplace_refund_ack(true) ->> 'language'), 'ru', '...and the language is recorded with it');

select * from finish();
rollback;

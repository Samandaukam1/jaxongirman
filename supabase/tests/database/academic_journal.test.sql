begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000a9', 'authenticated', 'authenticated',
   'journal-a@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-0000000000b9', 'authenticated', 'authenticated',
   'journal-b@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a9', true);

insert into public.academic_works (id, owner_id, kind, topic, structure, citation_style, authors, udc)
values ('c3000000-0000-0000-0000-0000000000c9', 'a1000000-0000-0000-0000-0000000000a9', 'article', 'Talabalar media savodxonligi',
        'ilmrad', 'apa', '[{"name": "Karimov Alisher", "affiliation": "O‘zMU", "orcid": "0000-0002-1825-0097", "email": ""}]', '070.1');
select is((select language || '/' || citation_style || '/' || structure from public.academic_works where id = 'c3000000-0000-0000-0000-0000000000c9'),
  'uz/apa/ilmrad', 'an article keeps its language, style and structure');

select throws_ok($$insert into public.academic_works (owner_id, kind, topic, structure)
  values ('a1000000-0000-0000-0000-0000000000a9', 'referat', 'X', 'imrad')$$, '23514', null, 'only an article has a structure');
select throws_ok($$insert into public.academic_works (owner_id, kind, topic, citation_style)
  values ('a1000000-0000-0000-0000-0000000000a9', 'article', 'X', 'harvard')$$, '23514', null, 'and only the six styles');
select throws_ok($$insert into public.academic_works (owner_id, kind, topic, authors)
  values ('a1000000-0000-0000-0000-0000000000a9', 'article', 'X', (select jsonb_agg(jsonb_build_object('name', n)) from generate_series(1, 11) n))$$,
  '23514', null, 'up to ten authors');
select lives_ok($$update public.academic_works set layout = '{"preset": "journal", "fontSize": 12}', funding = 'Grant F-2021'
  where id = 'c3000000-0000-0000-0000-0000000000c9'$$, 'the author sets the layout and the funding');

-- The server writes two sections; one is finished.
reset role;
insert into public.academic_sections (id, work_id, owner_id, position, key, heading, status, body, words) values
  ('d4000000-0000-0000-0000-0000000000d9', 'c3000000-0000-0000-0000-0000000000c9', 'a1000000-0000-0000-0000-0000000000a9', 0, 'introduction', 'Kirish', 'ready', 'Eski matn [1].', 3),
  ('d5000000-0000-0000-0000-0000000000d9', 'c3000000-0000-0000-0000-0000000000c9', 'a1000000-0000-0000-0000-0000000000a9', 1, 'methods', 'Usullar', 'pending', '', 0);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000a9', true);

select throws_ok($$update public.academic_sections set body = 'x' where id = 'd4000000-0000-0000-0000-0000000000d9'$$,
  '42501', null, 'a section is not written to directly');
select is((public.academic_section_edit('d4000000-0000-0000-0000-0000000000d9', 'Kirish qismi', 'Yangi matn uch so‘z [1] bilan.')) ->> 'words', '6',
  'the author corrects a written section, and its words are counted again');
select is((select heading from public.academic_sections where id = 'd4000000-0000-0000-0000-0000000000d9'), 'Kirish qismi', 'heading and all');
select ok((select edited_at is not null from public.academic_sections where id = 'd4000000-0000-0000-0000-0000000000d9'), 'and the edit is dated');
select throws_ok($$select public.academic_section_edit('d5000000-0000-0000-0000-0000000000d9', 'Usullar', 'O‘zim yozdim')$$,
  '22023', null, 'a section not yet written is the generator''s to fill');
select throws_ok($$select public.academic_section_edit('d4000000-0000-0000-0000-0000000000d9', 'Kirish', '   ')$$,
  '22023', null, 'and a written one cannot be emptied');

select is(jsonb_array_length(public.academic_section_figures('d4000000-0000-0000-0000-0000000000d9',
  '[{"path": "a1000000-0000-0000-0000-0000000000a9/ilmiy/c3000000-0000-0000-0000-0000000000c9/f1.jpg", "caption": "Sxema", "width": 800, "height": 600}]')), 1,
  'the author adds a figure from the work''s own folder');
select throws_ok($$select public.academic_section_figures('d4000000-0000-0000-0000-0000000000d9',
  '[{"path": "b2000000-0000-0000-0000-0000000000b9/ilmiy/x/f.jpg", "caption": "", "width": 1, "height": 1}]')$$,
  '42501', null, 'but not someone else''s picture');
select throws_ok(format('select public.academic_section_figures(%L, %L)', 'd4000000-0000-0000-0000-0000000000d9',
  (select jsonb_agg(jsonb_build_object('path', 'a1000000-0000-0000-0000-0000000000a9/ilmiy/c3000000-0000-0000-0000-0000000000c9/' || n || '.jpg', 'width', 1, 'height', 1)) from generate_series(1, 7) n)),
  '22023', null, 'six figures to a section at most');

select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-0000000000b9', true);
select throws_ok($$select public.academic_section_edit('d4000000-0000-0000-0000-0000000000d9', 'Begona', 'Begona matn')$$,
  'P0002', null, 'nobody else edits it');

select * from finish();
rollback;

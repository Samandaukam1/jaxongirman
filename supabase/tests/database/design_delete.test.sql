begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

/**
 * Deleting a design, as opposed to withdrawing one.
 *
 * Archiving is the right answer almost always: a design a deck was made with
 * has to stay, because `presentations.design_id` is the only record of what
 * that deck was laid out by. What archiving is wrong for is the design that
 * never became anything — a draft, a template imported to see what it looked
 * like — and those accumulate with no honest reason to keep them.
 */

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated',
   'design-admin@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated',
   'design-member@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{}', now(), now());

insert into public.user_roles (user_id, role)
values ('d0000000-0000-0000-0000-00000000000a', 'admin')
on conflict (user_id) do update set role = 'admin';

insert into public.presentation_designs (id, slug, name, tier, status)
values
  ('d1000000-0000-0000-0000-000000000001', 'delete-unused', 'Unused', 'great', 'draft'),
  ('d1000000-0000-0000-0000-000000000002', 'delete-used', 'Used', 'great', 'draft');

insert into public.presentation_design_fonts (design_id, font_id, name, asset_path, weight, italic)
values ('d1000000-0000-0000-0000-000000000001', 'font_1', 'Inter', 'delete-unused/font_1-400.ttf', 400, false);

insert into public.presentations (id, owner_id, topic, title, style, design_id)
values ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000b',
        'Mavzu', 'Sarlavha', 'great', 'd1000000-0000-0000-0000-000000000002');

-- ------------------------------------------------------------- not an admin --

set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select throws_ok(
  $$select public.admin_delete_design('d1000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member cannot delete a design'
);

-- ------------------------------------------------------------------ an admin --

set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select throws_ok(
  $$select public.admin_delete_design('d1000000-0000-0000-0000-000000000002')$$,
  '22023',
  null,
  'a design a presentation was made with is refused, not deleted'
);

select is(
  (select count(*)::int from public.presentation_designs where id = 'd1000000-0000-0000-0000-000000000002'),
  1,
  'and it is still there afterwards'
);

/**
 * The objects come back rather than being removed here: a function cannot
 * reach the bucket, and the row has to go first anyway — an object with no row
 * is litter, while a row pointing at a deleted object renders a missing font.
 */
select is(
  public.admin_delete_design('d1000000-0000-0000-0000-000000000001')->'fonts'->>0,
  'delete-unused/font_1-400.ttf',
  'the files the design owned are handed back to be swept'
);

select is(
  (select count(*)::int from public.presentation_designs where id = 'd1000000-0000-0000-0000-000000000001'),
  0,
  'a design nothing points at is deleted'
);

select is(
  (select count(*)::int from public.presentation_design_fonts where design_id = 'd1000000-0000-0000-0000-000000000001'),
  0,
  'its faces went with it'
);

select is(
  (select count(*)::int from public.admin_audit_logs
   where action = 'design.deleted' and target_id = 'd1000000-0000-0000-0000-000000000001'),
  1,
  'and the removal is recorded with what was removed'
);

select * from finish();
rollback;

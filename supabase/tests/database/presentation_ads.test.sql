begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

-- Where ad pages go: after each fifth page that more of the deck follows, one per ad.
select is(public.presentation_ad_pages(10, 1), 1, '10 pages, 1 ad: page 6 only (11 pages)');
select is(public.presentation_ad_pages(20, 1), 1, '20 pages, 1 ad: still once');
select is(public.presentation_ad_pages(20, 3), 3, '20 pages, 3 ads: pages 6, 12, 18 (23 pages)');
select is(public.presentation_ad_pages(10, 3), 1, '10 pages, 3 ads: one — nothing follows page 10');
select is(public.presentation_ad_pages(5, 3), 0, 'a deck of five never ends on an ad');
select is(public.presentation_ad_pages(6, 3), 1, 'six pages: the ad sits between 5 and 6');
select is(public.presentation_ad_pages(0, 3), 0, 'no deck, no ads');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a1a10000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated',
   'adadmin@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Ad Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000c2', 'authenticated', 'authenticated',
   'adfree@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Free"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000c3', 'authenticated', 'authenticated',
   'adoson@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Oson"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b2b20000-0000-0000-0000-0000000000c4', 'authenticated', 'authenticated',
   'adbemalol@example.com', crypt('x', gen_salt('bf')), now(), '{"provider":"email"}', '{"full_name":"Bemalol"}', now(), now());
insert into public.user_roles (user_id, role) values ('a1a10000-0000-0000-0000-0000000000c1', 'admin');
insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at)
select 'b2b20000-0000-0000-0000-0000000000c3', id, 'active', now(), now() + interval '20 days' from public.subscription_plans where code = 'oson';
insert into public.user_subscriptions (user_id, plan_id, status, started_at, expires_at)
select 'b2b20000-0000-0000-0000-0000000000c4', id, 'active', now(), now() + interval '20 days' from public.subscription_plans where code = 'bemalol';

-- The console sets three ad pages and a banner; a fourth live ad page is refused.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1a10000-0000-0000-0000-0000000000c1', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok($$select public.admin_save_presentation_ad(null, 'slide', 'slides/a.png', null, 1)$$, 'first ad page');
select lives_ok($$select public.admin_save_presentation_ad(null, 'slide', 'slides/b.png', 'https://example.com/b', 2)$$, 'second');
select lives_ok($$select public.admin_save_presentation_ad(null, 'slide', 'slides/c.png', null, 3)$$, 'third');
select throws_ok($$select public.admin_save_presentation_ad(null, 'slide', 'slides/d.png', null, 4)$$, '22023', null,
  'a fourth live ad page is refused');
select lives_ok($$select public.admin_save_presentation_ad(null, 'banner', 'banners/x.png', null, 0)$$, 'a banner');
reset role;

-- By plan.
select is((select jsonb_array_length(public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c2') -> 'slides')), 3,
  'no plan: ad pages');
select is((select jsonb_array_length(public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c3') -> 'slides')
         + 10 * jsonb_array_length(public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c3') -> 'banners')), 10,
  'the cheapest plan: the banner, no ad pages');
select is((select public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c4') -> 'slides'
               || (public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c4') -> 'banners')), '[]'::jsonb,
  'a higher plan: nothing');

-- Ad pages are counted on the session only for a phone that places them; an
-- app from before 2.0 steps through slides, so its talk carries none.
insert into public.presentations (id, owner_id, title, topic, style, status, requested_slide_count, generated_slide_count)
values ('cad00000-0000-0000-0000-0000000000d1', 'b2b20000-0000-0000-0000-0000000000c2', 'Reklamali taqdimot', 'Mavzu', 'simple', 'ready', 7, 7);
insert into public.slides (presentation_id, owner_id, position, title)
select 'cad00000-0000-0000-0000-0000000000d1', 'b2b20000-0000-0000-0000-0000000000c2', n, 'Slayd ' || n from generate_series(0, 6) n;
create temporary table t_screen as select public.presentation_session_open() as payload;
grant select on t_screen to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-0000000000c2', true);
select public.presentation_pairing_claim((select payload ->> 'token' from t_screen), 'cad00000-0000-0000-0000-0000000000d1');
select is((public.presentation_session_set_deck((select (payload ->> 'session_id')::uuid from t_screen),
            'cad00000-0000-0000-0000-0000000000d1')).slide_count, 7,
  'an older phone: seven slides, seven pages');
select is((public.presentation_session_set_deck((select (payload ->> 'session_id')::uuid from t_screen),
            'cad00000-0000-0000-0000-0000000000d1', true)).slide_count, 8,
  'a phone that places ad pages: one after page five');
reset role;

-- Somebody else's plan is not anybody's business.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2b20000-0000-0000-0000-0000000000c2', true);
select throws_ok($$select public.presentation_ads_for('b2b20000-0000-0000-0000-0000000000c3')$$, '42501', null,
  'an owner reads only their own');

select * from finish();
rollback;

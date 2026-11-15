begin;
select plan(3);

select is(
  (select value ->> 'version' from public.app_settings where key = 'app.latest_version'),
  '2.0.0',
  'the published version is recorded'
);

set local role anon;
select is(
  (select value ->> 'url' from public.app_settings where key = 'app.latest_version'),
  'https://jaxongirman.app/ilova',
  'a signed-out phone can read where to update'
);
select is(
  (select count(*)::int from public.app_settings where key = 'payments.ios_policy' and not public_read),
  0,
  'and still sees no private setting'
);
reset role;

select * from finish();
rollback;

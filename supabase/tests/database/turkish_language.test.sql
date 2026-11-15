begin;
select plan(6);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_preferred_language') like '%''tr''%',
  'a person may use the app in Turkish'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'presentations_language') like '%''tr''%',
  'a deck may be written in Turkish'
);
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'games_language_check') like '%''tr''%',
  'a game may be written in Turkish'
);
select ok(
  (select (value -> 'ui') ? 'tr' and (value -> 'deck') ? 'tr' from public.app_settings where key = 'i18n.languages'),
  'Turkish is offered in the interface and for decks'
);
select ok(public.is_i18n_object('{"uz": "Oson", "tr": "Kolay"}'::jsonb), 'an operator text may carry Turkish');
select ok(not public.is_i18n_object('{"uz": "Oson", "de": "Einfach"}'::jsonb), 'but not a language the app does not speak');

select * from finish();
rollback;

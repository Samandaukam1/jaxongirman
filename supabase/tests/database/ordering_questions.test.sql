begin;
select plan(7);

create temporary table q on commit drop as
  select jsonb_populate_record(null::public.game_questions, jsonb_build_object(
    'id', gen_random_uuid(), 'type', 'ordering', 'time_limit_seconds', 20, 'base_points', 1000, 'prompt', 'Tartiblang',
    'config', jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('id', 'a', 'text', 'Birinchi'),
        jsonb_build_object('id', 'b', 'text', 'Ikkinchi'),
        jsonb_build_object('id', 'c', 'text', 'Uchinchi')),
      'order', jsonb_build_array('a', 'b', 'c'))
  )) as question;

create function pg_temp.grade(p_order jsonb)
returns table (is_correct boolean, score integer) language sql as $$
  select g.is_correct, g.score from q, public.game_grade_answer(q.question, jsonb_build_object('order', p_order), 0) as g;
$$;

select is((select row(is_correct, score)::text from pg_temp.grade('["a","b","c"]')), '(t,1000)', 'the right order is correct and scores');
select is((select row(is_correct, score)::text from pg_temp.grade('["c","b","a"]')), '(f,0)', 'a wrong order scores nothing');
select is((select row(is_correct, score)::text from pg_temp.grade('["a","b"]')), '(f,0)', 'a missing item is wrong');
select is((select row(is_correct, score)::text from pg_temp.grade('"abc"')), '(f,0)', 'a malformed answer is graded, not an error');

-- Over two hundred sessions, the deal is never the answer and always the same items.
select is(
  (select count(*)::int from generate_series(1, 200) as n, q,
     lateral (select public.game_sanitized_question(q.question, gen_random_uuid()) -> 'config' -> 'items' as items) as dealt
   where (select jsonb_agg(item.value ->> 'id' order by item.ordinality) from jsonb_array_elements(dealt.items) with ordinality as item) = '["a","b","c"]'::jsonb),
  0,
  'no session is dealt the answer'
);
select is(
  (select count(*)::int from generate_series(1, 50) as n, q,
     lateral (select public.game_sanitized_question(q.question, gen_random_uuid()) -> 'config' -> 'items' as items) as dealt
   where jsonb_array_length(dealt.items) <> 3
      or not (dealt.items @> '[{"id":"a"},{"id":"b"},{"id":"c"}]'::jsonb)),
  0,
  'every deal holds all three items'
);
select ok(
  (select public.game_sanitized_question(q.question, gen_random_uuid()) -> 'config' ? 'order' from q) = false,
  'the answer itself never reaches a phone'
);

select * from finish();
rollback;

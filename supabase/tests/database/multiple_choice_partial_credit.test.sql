begin;
select plan(10);

-- A question as the grader sees it: three correct options out of five, 1000 points, 20 seconds.
create temporary table q on commit drop as
  select jsonb_populate_record(null::public.game_questions, jsonb_build_object(
    'type', 'multiple_choice', 'time_limit_seconds', 20, 'base_points', 1000,
    'config', jsonb_build_object('correct', jsonb_build_array('a', 'b', 'c'))
  )) as question;

create function pg_temp.pick(p_choices jsonb, p_ms integer default 0)
returns table (is_correct boolean, score integer) language sql as $$
  select g.is_correct, g.score from q, public.game_grade_answer(q.question, jsonb_build_object('choices', p_choices), p_ms) as g;
$$;

select is((select row(is_correct, score)::text from pg_temp.pick('["a","b","c"]')), '(t,1000)', 'every correct option and no other: full points, correct');
select is((select row(is_correct, score)::text from pg_temp.pick('["c","a","b"]')), '(t,1000)', 'the order of the ticks does not matter');
select is((select row(is_correct, score)::text from pg_temp.pick('["a","b"]')), '(f,667)', 'two of three: two shares, not correct');
select is((select row(is_correct, score)::text from pg_temp.pick('["a","b","d"]')), '(f,333)', 'a wrong tick takes one share back');
select is((select row(is_correct, score)::text from pg_temp.pick('["a","d","e"]')), '(f,0)', 'more wrong than right: nothing, never below zero');
select is((select row(is_correct, score)::text from pg_temp.pick('["a","b","c","d"]')), '(f,667)', 'ticking everything is not a way round it');
select is((select row(is_correct, score)::text from pg_temp.pick('["a","a","b"]')), '(f,667)', 'the same option twice counts once');
select is((select row(is_correct, score)::text from pg_temp.pick('[]')), '(f,0)', 'no ticks: nothing');
select is((select score from pg_temp.pick('["a","b"]', 10000)), 500, 'the speed bonus applies to what was earned');
select is((select row(is_correct, score)::text from pg_temp.pick('"a"')), '(f,0)', 'a malformed answer is graded, not an error');

select * from finish();
rollback;

-- "Bir nechtasini tanlash": credit by the option.
--
-- A multiple-choice question used to pay only for the exact set — two of three
-- right answers scored the same as none. Now each correct option ticked earns
-- its share of the points (base ÷ number of correct options), each wrong option
-- ticked takes one share back, and the total never goes below zero. The speed
-- bonus applies to what was earned, as before. The answer still counts as
-- correct (streaks, the correct/incorrect split) only when the set is exact.
--
--   3 correct options, 1000 points, answered instantly:
--     a b c → 1000 (correct)   a b → 667   a b d → 333   a d e → 0   a b c d → 667
--
-- Every other question type is graded exactly as before.

/**
 * The verdict and the score, in one deterministic place.
 *
 * Speed pays: an answer earns base × (0.5 + 0.5 × remaining/limit), so an
 * instant answer is worth double a buzzer-beater. A multiple-choice answer
 * earns its share of base first (see above). Questions with no key
 * (word_cloud, poll) return null correctness and zero points; open_answer
 * returns null and waits for the host.
 */
create or replace function public.game_grade_answer(
  p_question public.game_questions,
  p_payload jsonb,
  p_response_ms integer
)
returns table (is_correct boolean, score integer)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_correct boolean;
  v_limit_ms integer := p_question.time_limit_seconds * 1000;
  v_x numeric;
  v_y numeric;
  v_region jsonb;
  -- multiple_choice only: the share of the points earned, 0..1.
  v_share numeric;
  v_keys integer;
  v_right integer;
  v_wrong integer;
begin
  case p_question.type
    when 'single_choice', 'image_quiz' then
      v_correct := (p_payload ->> 'choice') is not distinct from (v_config ->> 'correct');
    when 'true_false' then
      v_correct := (p_payload ->> 'value')::boolean is not distinct from (v_config ->> 'correct')::boolean;
    when 'multiple_choice' then
      -- Credit by the option: each right tick earns its share, each wrong tick
      -- takes one share back, never below nothing. Correct only when exact.
      select count(*) into v_keys
        from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end);
      select
        count(*) filter (where chosen.value in (
          select key from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end) as key
        )),
        count(*) filter (where chosen.value not in (
          select key from jsonb_array_elements_text(case when jsonb_typeof(v_config -> 'correct') = 'array' then v_config -> 'correct' else '[]'::jsonb end) as key
        ))
        into v_right, v_wrong
        from (
          select distinct value
          from jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'choices') = 'array' then p_payload -> 'choices' else '[]'::jsonb end)
        ) as chosen;
      v_correct := v_keys > 0 and v_right = v_keys and v_wrong = 0;
      v_share := case when v_keys > 0 then greatest(v_right - v_wrong, 0)::numeric / v_keys else 0 end;
    when 'ordering' then
      v_correct := coalesce(p_payload -> 'order', 'null'::jsonb) = coalesce(v_config -> 'order', '[]'::jsonb);
    when 'matching' then
      v_correct := coalesce(p_payload -> 'pairs', 'null'::jsonb) = coalesce(v_config -> 'pairs', '{}'::jsonb);
    when 'fill_blank' then
      v_correct := exists (
        select 1 from jsonb_array_elements_text(coalesce(v_config -> 'answers', '[]'::jsonb)) as accepted
        where public.game_normalize_text(accepted) = public.game_normalize_text(p_payload ->> 'text')
      );
    when 'hotspot' then
      v_x := (p_payload ->> 'x')::numeric;
      v_y := (p_payload ->> 'y')::numeric;
      v_region := v_config -> 'region';
      if v_x is null or v_y is null or v_region is null then
        v_correct := false;
      elsif coalesce(v_config ->> 'shape', 'rect') = 'circle' then
        v_correct := sqrt(
          power(v_x - ((v_region ->> 'x')::numeric + (v_region ->> 'w')::numeric / 2), 2)
          + power(v_y - ((v_region ->> 'y')::numeric + (v_region ->> 'h')::numeric / 2), 2)
        ) <= (v_region ->> 'w')::numeric / 2;
      else
        v_correct := v_x between (v_region ->> 'x')::numeric and (v_region ->> 'x')::numeric + (v_region ->> 'w')::numeric
          and v_y between (v_region ->> 'y')::numeric and (v_region ->> 'y')::numeric + (v_region ->> 'h')::numeric;
      end if;
    when 'word_cloud', 'poll', 'open_answer' then
      return query select null::boolean, 0;
      return;
  end case;

  if p_question.base_points > 0 and (coalesce(v_correct, false) or coalesce(v_share, 0) > 0) then
    return query select coalesce(v_correct, false), greatest(
      round(p_question.base_points * coalesce(v_share, 1)
        * (0.5 + 0.5 * greatest(v_limit_ms - p_response_ms, 0)::numeric / greatest(v_limit_ms, 1)))::integer,
      1
    );
    return;
  end if;
  return query select coalesce(v_correct, false), 0;
end;
$$;

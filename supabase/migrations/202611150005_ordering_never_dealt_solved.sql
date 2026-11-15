-- "Tartibga soling": never dealt already in order.
--
-- An ordering question reaches the phones (and the board) with its items
-- shuffled by a per-session seed, so every screen agrees on the same deal. With
-- three items one deal in six was the answer itself, and a player who pressed
-- "send" without touching anything scored full points. Such a deal is now
-- turned by one place. Nothing else about the sanitised question changes.

/**
 * The question as the room may see it. Everything that decides correctness is
 * stripped; option order is kept, but matching's right column is shuffled with
 * a per-session seed so every phone and the projector agree on the same
 * scrambled order without ever being told the pairs.
 */
create or replace function public.game_sanitized_question(
  p_question public.game_questions,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_question.config, '{}'::jsonb);
  v_public jsonb := '{}'::jsonb;
  v_items jsonb;
begin
  case p_question.type
    when 'single_choice', 'multiple_choice', 'image_quiz', 'poll' then
      v_public := jsonb_build_object('options', coalesce(v_config -> 'options', '[]'::jsonb));
    when 'true_false' then
      v_public := '{}'::jsonb;
    when 'ordering' then
      -- The items arrive shuffled: presenting them in the authored order would
      -- hand out the answer. A shuffle that lands on the answer anyway — one
      -- time in six with three items — is turned by one place.
      select coalesce(jsonb_agg(item order by md5(p_session_id::text || p_question.id::text || (item ->> 'id'))), '[]'::jsonb)
        into v_items
        from jsonb_array_elements(coalesce(v_config -> 'items', '[]'::jsonb)) as item;
      if jsonb_array_length(v_items) > 1
        and (select jsonb_agg(dealt.value ->> 'id' order by dealt.ordinality) from jsonb_array_elements(v_items) with ordinality as dealt)
          = coalesce(v_config -> 'order', '[]'::jsonb) then
        v_items := (v_items - 0) || jsonb_build_array(v_items -> 0);
      end if;
      v_public := jsonb_build_object('items', v_items);
    when 'matching' then
      select jsonb_build_object(
        'left', coalesce(v_config -> 'left', '[]'::jsonb),
        'right', coalesce((
          select jsonb_agg(item order by md5(p_session_id::text || p_question.id::text || (item ->> 'id')))
          from jsonb_array_elements(coalesce(v_config -> 'right', '[]'::jsonb)) as item
        ), '[]'::jsonb)
      ) into v_public;
    when 'fill_blank' then
      v_public := jsonb_build_object('kind', 'text');
    when 'word_cloud' then
      v_public := jsonb_build_object('max_length', 40);
    when 'open_answer' then
      v_public := jsonb_build_object('max_length', 300);
    when 'hotspot' then
      -- The image is the question; the region is the answer.
      v_public := '{}'::jsonb;
  end case;

  return jsonb_build_object(
    'id', p_question.id,
    'type', p_question.type,
    'prompt', p_question.prompt,
    'time_limit_seconds', p_question.time_limit_seconds,
    'base_points', p_question.base_points,
    'media_path', p_question.media_path,
    'config', v_public
  );
end;
$$;

-- The projector could not tell whether a host had claimed it yet.
--
-- `game_screen_snapshot()` returned `join_token` unconditionally — the token is
-- minted when the session opens, long before anybody claims it — so the browser
-- had nothing to distinguish "waiting for a phone" from "the match is mine".
-- It guessed from the token being present, which is always, so the pairing QR
-- never appeared: the projector jumped straight to an empty lobby showing a join
-- code nobody was meant to scan yet.
--
-- `paired` is that missing bit. `game_selected` is the second one the lobby
-- needs, because a host may claim the screen before choosing which game to run.
--
-- Forward-only: 202608110004 is already applied on the remote.

create or replace function public.game_screen_snapshot(
  p_session_id uuid,
  p_screen_token text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_game public.games%rowtype;
  v_state jsonb;
begin
  select * into v_session from public.game_sessions
    where id = p_session_id
      and screen_token_hash = encode(extensions.digest(coalesce(p_screen_token, ''), 'sha256'), 'hex');
  if not found then
    raise exception 'screen token is not valid for this session' using errcode = '42501';
  end if;

  if v_session.game_id is not null then
    select * into v_game from public.games where id = v_session.game_id;
  end if;

  v_state := jsonb_build_object(
    'status', v_session.status,
    -- The two facts the projector renders its own state machine from: has a
    -- phone taken this screen over, and has that phone chosen a game yet.
    -- Neither reveals who the host is.
    'paired', v_session.host_user_id is not null,
    'game_selected', v_session.game_id is not null,
    'game_title', coalesce(v_game.title, ''),
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'current_index', v_session.current_index,
    'question_count', coalesce(array_length(v_session.question_ids, 1),
                               case when v_session.game_id is null then 0
                                    else (select count(*)::integer from public.game_questions q where q.game_id = v_session.game_id) end),
    'phase_deadline', v_session.phase_deadline,
    'question_started_at', v_session.question_started_at,
    'team_mode', v_session.team_mode,
    'sound_enabled', v_session.sound_enabled,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gp.id, 'nickname', gp.nickname, 'avatar_id', gp.avatar_id, 'team', gp.team,
        'total_score', gp.total_score
      ) order by gp.joined_at)
      from public.game_players gp
      where gp.session_id = p_session_id and gp.status <> 'kicked'
    ), '[]'::jsonb)
  );

  if v_session.status in ('question'::public.game_session_status,
                          'question_result'::public.game_session_status)
     and v_session.current_index >= 0 then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_state := v_state || jsonb_build_object(
        'question', public.game_sanitized_question(v_question, p_session_id),
        'answered_count', (
          select count(*) from public.game_answers
          where session_id = p_session_id and question_index = v_session.current_index
        )
      );
      if v_session.status = 'question_result'::public.game_session_status then
        v_state := v_state || jsonb_build_object(
          'reveal', jsonb_build_object(
            'config', v_question.config,
            'explanation', v_question.explanation,
            'stats', public.game_question_stats(p_session_id, v_session.current_index)
          )
        );
      end if;
    end if;
  end if;

  if v_session.status in ('leaderboard'::public.game_session_status,
                          'finished'::public.game_session_status) then
    v_state := v_state || jsonb_build_object('leaderboard', public.game_leaderboard_rows(p_session_id));
  end if;

  return v_state;
end;
$$;

revoke all on function public.game_screen_snapshot(uuid, text) from public;
grant execute on function public.game_screen_snapshot(uuid, text) to anon, authenticated, service_role;

/**
 * The games a person may put in front of a room, for the picker the host sees
 * straight after scanning a projector.
 *
 * Their own ready games, every free one, and everything they have bought —
 * exactly the set `game_can_host()` will accept, so the picker cannot offer a
 * choice that the next call refuses. `source` is what the list groups by.
 */
create or replace function public.game_hostable_list()
returns table (
  id uuid,
  title text,
  question_count integer,
  category_label text,
  difficulty text,
  source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  return query
    select g.id, g.title, g.question_count, c.label, g.difficulty,
           case
             when g.owner_id = v_user and g.source_presentation_id is not null then 'presentation'
             when g.owner_id = v_user then 'mine'
             when exists (
               select 1 from public.purchase_entitlements e
               join public.marketplace_products p on p.id = e.product_id
               where p.game_id = g.id and e.user_id = v_user and e.revoked_at is null
             ) then 'purchased'
             else 'free'
           end as source
    from public.games g
    left join public.game_categories c on c.id = g.category_id
    where g.status = 'ready'::public.game_status
      and (
        g.owner_id = v_user
        or g.is_free
        or exists (
          select 1 from public.purchase_entitlements e
          join public.marketplace_products p on p.id = e.product_id
          where p.game_id = g.id and e.user_id = v_user and e.revoked_at is null
        )
      )
    order by (g.owner_id = v_user) desc, g.updated_at desc
    limit 100;
end;
$$;

revoke all on function public.game_hostable_list() from public, anon;
grant execute on function public.game_hostable_list() to authenticated, service_role;

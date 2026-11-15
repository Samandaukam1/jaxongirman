-- Mafia (Jaxongirman.app 2.0, §5.5).
--
-- The host is the narrator: they make the room, the players join it by QR or
-- code, and the host chooses which characters are in the deck — how many
-- mafiosi, and whether there is a Don, a Komissar, a Doktor, a Ma'shuqa, a
-- Manyak; everyone else is a Fuqaro. The cards are dealt at random. Each
-- player's phone shows their own card and nobody else's (a mafioso also sees
-- who the other mafiosi are, as they would on the first night); the host
-- sees every card. The narration — eyes closed, the night's choices, the
-- day's vote — happens in the room, as it always has; the host marks on the
-- phone what it led to: night or day, who is out and how, and who won.
--
-- The cards live in their own table no client can read. Every screen asks
-- for its own picture through the state functions below, so a card can only
-- reach the phone it was dealt to, the host, and — once a game is over — the
-- whole room. Because the deal is on the server, a phone that locks, or an
-- app that is closed and opened again, finds its card where it left it.
--
-- A session plays as many games as the room wants: when one is over the
-- doors open again for latecomers, and the host deals the next.

alter table public.games drop constraint if exists games_kind;
alter table public.games add constraint games_kind check (kind in ('quiz', 'crossword', 'grid', 'mafia'));

alter table public.game_sessions add column if not exists mafia jsonb;
comment on column public.game_sessions.mafia is
  'A Mafia game, the public part only: {game_no, roles: {role: count}, phase night|day, round, over, winner}. The cards are in game_mafia_cards.';

-- `session_id` carries no foreign key of its own: the card goes with its
-- player, who goes with the session. A second key would make this table a
-- bridge between sessions and players in PostgREST's eyes, and every query
-- that embeds one in the other ambiguous.
create table if not exists public.game_mafia_cards (
  session_id uuid not null,
  player_id uuid not null references public.game_players (id) on delete cascade,
  role text not null,
  alive boolean not null default true,
  out_reason text,
  out_round integer,
  seen_at timestamptz,
  dealt_at timestamptz not null default now(),
  primary key (session_id, player_id),
  constraint game_mafia_cards_role check (role in ('don', 'mafia', 'sheriff', 'doctor', 'lover', 'maniac', 'civilian')),
  constraint game_mafia_cards_out check (
    (alive and out_reason is null and out_round is null)
    or (not alive and out_reason in ('night', 'vote', 'host'))
  )
);
comment on table public.game_mafia_cards is
  'Who holds which Mafia card. Never read by a client: game_mafia_view hands each viewer what they may see.';
alter table public.game_mafia_cards enable row level security;
revoke all on public.game_mafia_cards from public, anon, authenticated;

/** The mafia's own side: they win together and know each other. */
create or replace function public.game_mafia_is_mafia(p_role text)
returns boolean
language sql
immutable
set search_path = ''
as $$ select p_role in ('don', 'mafia'); $$;

/**
 * A Mafia game as one viewer may see it.
 *
 * `p_viewer` is 'host' (every card, who has looked at theirs, and who has won
 * if the table says so), 'screen' (who is in and who is out, never a card
 * until the game is over) or 'player' with `p_player` (the same, plus their
 * own card — and, for a mafioso, the other mafiosi).
 */
create or replace function public.game_mafia_view(p_session public.game_sessions, p_viewer text, p_player uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mafia jsonb := p_session.mafia;
  v_over boolean;
  v_reveal boolean;
  v_card public.game_mafia_cards%rowtype;
  v_view jsonb;
  v_side integer;
  v_maniac integer;
  v_alive integer;
begin
  if v_mafia is null then return null; end if;
  v_over := coalesce((v_mafia ->> 'over')::boolean, false) or p_session.status = 'finished'::public.game_session_status;
  v_reveal := p_viewer = 'host' or v_over;

  v_view := jsonb_build_object(
    'game_no', v_mafia -> 'game_no',
    'roles', v_mafia -> 'roles',
    'phase', v_mafia -> 'phase',
    'round', v_mafia -> 'round',
    'over', v_over,
    'winner', v_mafia -> 'winner',
    -- Everyone in the room, dealt in or not; a card's face only where it may be seen.
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gp.id, 'nickname', gp.nickname, 'avatar_id', gp.avatar_id,
        'in_game', c.player_id is not null,
        'alive', coalesce(c.alive, false),
        'out_reason', c.out_reason,
        'out_round', c.out_round,
        'role', case when v_reveal then c.role end,
        'seen', case when p_viewer = 'host' then c.seen_at is not null end
      ) order by c.player_id is null, gp.joined_at)
      from public.game_players gp
      left join public.game_mafia_cards c on c.session_id = gp.session_id and c.player_id = gp.id
      where gp.session_id = p_session.id and gp.status <> 'kicked'
        and gp.user_id is distinct from p_session.host_user_id
    ), '[]'::jsonb)
  );

  if p_viewer = 'player' and p_player is not null then
    select * into v_card from public.game_mafia_cards where session_id = p_session.id and player_id = p_player;
    if found then
      v_view := v_view || jsonb_build_object(
        'me', jsonb_build_object('role', v_card.role, 'alive', v_card.alive, 'out_reason', v_card.out_reason,
                                 'out_round', v_card.out_round, 'seen', v_card.seen_at is not null),
        'team', case when public.game_mafia_is_mafia(v_card.role) then coalesce((
          select jsonb_agg(jsonb_build_object('id', gp.id, 'nickname', gp.nickname, 'avatar_id', gp.avatar_id,
                                              'role', c.role, 'alive', c.alive) order by c.role, gp.joined_at)
          from public.game_mafia_cards c
          join public.game_players gp on gp.id = c.player_id
          where c.session_id = p_session.id and c.player_id <> p_player and public.game_mafia_is_mafia(c.role)
        ), '[]'::jsonb) end
      );
    end if;
  end if;

  -- The host is told when the table has decided the game; ending it stays theirs.
  if p_viewer = 'host' and not v_over then
    select count(*) filter (where alive and public.game_mafia_is_mafia(role)),
           count(*) filter (where alive and role = 'maniac'),
           count(*) filter (where alive)
      into v_side, v_maniac, v_alive
      from public.game_mafia_cards where session_id = p_session.id;
    v_view := v_view || jsonb_build_object('verdict',
      case
        when v_alive = 0 then null
        when v_side = 0 and v_maniac = 0 then 'town'
        when v_maniac = 0 and v_side * 2 >= v_alive then 'mafia'
        when v_side = 0 and v_maniac > 0 and v_alive <= 2 then 'maniac'
      end);
  end if;

  return v_view;
end;
$$;
revoke all on function public.game_mafia_view(public.game_sessions, text, uuid) from public, anon, authenticated;

/**
 * The caller's Mafia "game": the row a session hangs from. One per account,
 * made on first use, never listed, never sent to the store.
 */
create or replace function public.game_mafia_game(p_language text default 'uz')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_language text := case when p_language in ('uz', 'en', 'ru', 'tr') then p_language else 'uz' end;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if exists (select 1 from public.profiles where id = v_user and status = 'blocked') then
    raise exception 'account is blocked' using errcode = '42501';
  end if;
  select id into v_id from public.games where owner_id = v_user and kind = 'mafia' order by created_at limit 1;
  if found then
    -- The board speaks the language the host is using today.
    update public.games set language = v_language, status = 'ready'::public.game_status
     where id = v_id and (language <> v_language or status <> 'ready'::public.game_status);
    return v_id;
  end if;
  insert into public.games (owner_id, title, status, kind, language)
  values (v_user, 'Mafia', 'ready'::public.game_status, 'mafia', v_language)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.game_mafia_game(text) from public, anon;
grant execute on function public.game_mafia_game(text) to authenticated;

/** The session, when it is the caller's and holds a Mafia game; locked for the change. */
create or replace function public.game_mafia_session(p_session_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.host_user_id is distinct from auth.uid() then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if (select g.kind from public.games g where g.id = v_session.game_id) is distinct from 'mafia' then
    raise exception 'Bu Mafia o‘yini emas.' using errcode = '22023';
  end if;
  if v_session.expires_at <= now()
     or v_session.status in ('finished'::public.game_session_status, 'cancelled'::public.game_session_status,
                             'expired'::public.game_session_status) then
    raise exception 'Sessiya yakunlangan.' using errcode = '22023';
  end if;
  return v_session;
end;
$$;
revoke all on function public.game_mafia_session(uuid) from public, anon, authenticated;

/** A game under way: dealt, and not over yet. */
create or replace function public.game_mafia_running(p_session public.game_sessions)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_session.mafia is null or p_session.status <> 'question'::public.game_session_status then
    raise exception 'Kartalar hali tarqatilmagan.' using errcode = '22023';
  end if;
  if coalesce((p_session.mafia ->> 'over')::boolean, false) then
    raise exception 'Bu o‘yin tugagan. Yangisini boshlang.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.game_mafia_running(public.game_sessions) from public, anon, authenticated;

/**
 * Deals the cards: in the lobby, or for the next game once one is over.
 *
 * `p_roles` is how many of each card: {"mafia": n, "don": 0|1, "sheriff": 0|1,
 * "doctor": 0|1, "lover": 0|1, "maniac": 0|1}; whoever is left is a Fuqaro.
 * The mafia (with the Don) must be fewer than half the table, or the game
 * would be over before it began. The host is the narrator and is never dealt
 * a card, even if their own account joined.
 */
create or replace function public.game_mafia_deal(p_session_id uuid, p_roles jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_mafia_session(p_session_id);
  v_players uuid[];
  v_count integer;
  v_mafia integer;
  v_one jsonb := '{}'::jsonb;
  v_role text;
  v_value integer;
  v_side integer;
  v_special integer;
  v_deck text[] := '{}';
begin
  if not (v_session.status = 'lobby'::public.game_session_status
          or (v_session.status = 'question'::public.game_session_status and coalesce((v_session.mafia ->> 'over')::boolean, false))) then
    raise exception 'O‘yin davom etmoqda. Avval uni yakunlang.' using errcode = '22023';
  end if;
  if p_roles is null or jsonb_typeof(p_roles) <> 'object' then
    raise exception 'Rollarni tanlang.' using errcode = '22023';
  end if;

  select array_agg(gp.id order by random()) into v_players
    from public.game_players gp
   where gp.session_id = v_session.id and gp.status <> 'kicked'
     and gp.user_id is distinct from v_session.host_user_id;
  v_count := coalesce(array_length(v_players, 1), 0);
  if v_count < 4 then
    raise exception 'Mafia uchun kamida 4 o‘yinchi kerak.' using errcode = '22023';
  end if;

  v_mafia := coalesce((p_roles ->> 'mafia')::integer, 0);
  if v_mafia < 0 then raise exception 'Mafiyalar soni noto‘g‘ri.' using errcode = '22023'; end if;
  foreach v_role in array array['don', 'sheriff', 'doctor', 'lover', 'maniac'] loop
    v_value := coalesce((p_roles ->> v_role)::integer, 0);
    if v_value not in (0, 1) then raise exception 'Har bir maxsus rol bitta bo‘ladi.' using errcode = '22023'; end if;
    v_one := v_one || jsonb_build_object(v_role, v_value);
  end loop;

  v_side := v_mafia + (v_one ->> 'don')::integer;
  if v_side < 1 then
    raise exception 'Kamida bitta mafiya bo‘lsin.' using errcode = '22023';
  end if;
  if v_side * 2 >= v_count then
    raise exception 'Mafiyalar o‘yinchilarning yarmidan kam bo‘lsin.' using errcode = '22023';
  end if;
  v_special := v_side + (v_one ->> 'sheriff')::integer + (v_one ->> 'doctor')::integer
             + (v_one ->> 'lover')::integer + (v_one ->> 'maniac')::integer;
  if v_special > v_count then
    raise exception 'Rollar o‘yinchilardan ko‘p.' using errcode = '22023';
  end if;

  -- The deck in a fixed order; the players were shuffled, so the deal is random.
  foreach v_role in array array['don', 'sheriff', 'doctor', 'lover', 'maniac'] loop
    if (v_one ->> v_role)::integer = 1 then v_deck := v_deck || v_role; end if;
  end loop;
  v_deck := v_deck || array_fill('mafia'::text, array[v_mafia]) || array_fill('civilian'::text, array[v_count - v_special]);

  delete from public.game_mafia_cards where session_id = v_session.id;
  insert into public.game_mafia_cards (session_id, player_id, role)
  select v_session.id, v_players[at], v_deck[at] from generate_series(1, v_count) as at;

  update public.game_sessions set
    status = 'question'::public.game_session_status,
    -- Nobody walks in on a game being played; the doors open again when it ends.
    allow_late_join = false,
    started_at = coalesce(started_at, now()),
    mafia = jsonb_build_object(
      'game_no', coalesce((mafia ->> 'game_no')::integer, 0) + 1,
      'roles', v_one || jsonb_build_object('mafia', v_mafia, 'civilian', v_count - v_special),
      'phase', 'night', 'round', 1, 'over', false, 'winner', null),
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id
    returning * into v_session;
  return public.game_mafia_view(v_session, 'host');
end;
$$;

/** Night or day. Night after a day is the next round. */
create or replace function public.game_mafia_phase(p_session_id uuid, p_phase text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_mafia_session(p_session_id);
begin
  perform public.game_mafia_running(v_session);
  if p_phase is null or p_phase not in ('night', 'day') then
    raise exception 'Tun yoki kun.' using errcode = '22023';
  end if;
  if v_session.mafia ->> 'phase' <> p_phase then
    update public.game_sessions set
      mafia = mafia || jsonb_build_object(
        'phase', p_phase,
        'round', (mafia ->> 'round')::integer + case when p_phase = 'night' then 1 else 0 end),
      state_version = state_version + 1, last_advance_at = now()
      where id = v_session.id
      returning * into v_session;
  end if;
  return public.game_mafia_view(v_session, 'host');
end;
$$;

/**
 * Takes a player out of the game — killed in the night, voted out by day, or
 * removed by the host — or, with `p_alive`, brings them back after a wrong tap.
 */
create or replace function public.game_mafia_mark(p_session_id uuid, p_player_id uuid, p_alive boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_mafia_session(p_session_id);
begin
  perform public.game_mafia_running(v_session);
  if p_alive is null or (not p_alive and (p_reason is null or p_reason not in ('night', 'vote', 'host'))) then
    raise exception 'Qanday chiqqanini tanlang.' using errcode = '22023';
  end if;
  update public.game_mafia_cards set
    alive = p_alive,
    out_reason = case when p_alive then null else p_reason end,
    out_round = case when p_alive then null else (v_session.mafia ->> 'round')::integer end
    where session_id = v_session.id and player_id = p_player_id;
  if not found then
    raise exception 'Bu o‘yinchida karta yo‘q.' using errcode = 'P0002';
  end if;
  update public.game_sessions set state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id returning * into v_session;
  return public.game_mafia_view(v_session, 'host');
end;
$$;

/**
 * Ends the game with its winner — 'town', 'mafia', 'maniac', or null when the
 * host stops it undecided. Every card is shown, and latecomers may come in
 * for the next game.
 */
create or replace function public.game_mafia_end(p_session_id uuid, p_winner text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_mafia_session(p_session_id);
begin
  perform public.game_mafia_running(v_session);
  if p_winner is not null and p_winner not in ('town', 'mafia', 'maniac') then
    raise exception 'G‘olibni tanlang.' using errcode = '22023';
  end if;
  update public.game_sessions set
    mafia = mafia || jsonb_build_object('over', true, 'winner', p_winner),
    allow_late_join = true,
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id
    returning * into v_session;
  return public.game_mafia_view(v_session, 'host');
end;
$$;

/** Closes the room: whatever game was on is over and every card is shown. */
create or replace function public.game_mafia_close(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.game_sessions%rowtype := public.game_mafia_session(p_session_id);
begin
  update public.game_sessions set
    mafia = case when mafia is null then null else mafia || '{"over": true}'::jsonb end,
    status = 'finished'::public.game_session_status, ended_at = now(), allow_late_join = false,
    state_version = state_version + 1, last_advance_at = now()
    where id = v_session.id
    returning * into v_session;
  return public.game_mafia_view(v_session, 'host');
end;
$$;

/** A player has turned their card over: the host sees who has not yet. */
create or replace function public.game_mafia_seen(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select id into v_player from public.game_players where session_id = p_session_id and user_id = auth.uid();
  if not found then raise exception 'Siz bu o‘yinda emassiz.' using errcode = '42501'; end if;
  update public.game_mafia_cards set seen_at = now()
   where session_id = p_session_id and player_id = v_player and seen_at is null;
  if found then
    update public.game_sessions set state_version = state_version + 1 where id = p_session_id;
  end if;
end;
$$;

revoke all on function public.game_mafia_deal(uuid, jsonb) from public, anon;
revoke all on function public.game_mafia_phase(uuid, text) from public, anon;
revoke all on function public.game_mafia_mark(uuid, uuid, boolean, text) from public, anon;
revoke all on function public.game_mafia_end(uuid, text) from public, anon;
revoke all on function public.game_mafia_close(uuid) from public, anon;
revoke all on function public.game_mafia_seen(uuid) from public, anon;
grant execute on function public.game_mafia_deal(uuid, jsonb) to authenticated;
grant execute on function public.game_mafia_phase(uuid, text) to authenticated;
grant execute on function public.game_mafia_mark(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.game_mafia_end(uuid, text) to authenticated;
grant execute on function public.game_mafia_close(uuid) to authenticated;
grant execute on function public.game_mafia_seen(uuid) to authenticated;

-- A Mafia game is a room, not content: never sent to the store.
create or replace function public.game_store_autopublish_arm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.game_store_autopublish_enabled()
     or new.kind in ('crossword', 'mafia') or current_setting('jaxongirman.copying', true) = 'on' then
    new.store_autopublish := 'off';
    new.store_autopublish_at := null;
    return new;
  end if;
  new.store_autopublish := 'pending';
  new.store_autopublish_at := now() + interval '1 hour';
  return new;
end;
$$;


-- Mafia is started from its own screen; the picker lists games with questions.
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
      and g.kind <> 'mafia'
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


create or replace function public.game_session_advance(p_session_id uuid, p_action text DEFAULT 'next'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_next integer;
  v_settlement jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if v_session.expires_at <= now() then
    raise exception 'Sessiya muddati tugagan.' using errcode = '22023';
  end if;
  -- A team grid game and Mafia are moved by their own buttons (game_grid_*,
  -- game_mafia_*); only leaving them is shared.
  if p_action <> 'cancel' and (select g.kind from public.games g where g.id = v_session.game_id) in ('grid', 'mafia') then
    raise exception 'Bu o‘yin o‘z tugmalari bilan boshqariladi.' using errcode = '22023';
  end if;

  if p_action = 'cancel' then
    if v_session.status in ('finished'::public.game_session_status,
                            'cancelled'::public.game_session_status) then
      raise exception 'O‘yin allaqachon yakunlangan.' using errcode = '22023';
    end if;
    perform public.game_rewards_refund(p_session_id);
    update public.game_sessions set
      status = 'cancelled'::public.game_session_status,
      ended_at = now(), phase_deadline = null,
      state_version = state_version + 1, last_advance_at = now()
      where id = p_session_id;
    return jsonb_build_object('status', 'cancelled');
  end if;

  if p_action = 'finish' or (
    p_action = 'next'
    and v_session.status = 'leaderboard'::public.game_session_status
    and v_session.current_index + 1 >= coalesce(array_length(v_session.question_ids, 1), 0)
  ) then
    if v_session.status in ('finished'::public.game_session_status,
                            'cancelled'::public.game_session_status,
                            'lobby'::public.game_session_status) then
      raise exception 'O‘yin bu holatdan yakunlanmaydi.' using errcode = '22023';
    end if;

    -- Final ranks are written once, before settlement reads them.
    with ranked as (
      select gp.id, rank() over (order by gp.total_score desc, gp.joined_at) as place
      from public.game_players gp
      where gp.session_id = p_session_id and gp.status <> 'kicked'
    )
    update public.game_players gp set rank = ranked.place
    from ranked where gp.id = ranked.id;

    update public.game_sessions set
      status = 'finished'::public.game_session_status,
      ended_at = now(), phase_deadline = null,
      state_version = state_version + 1, last_advance_at = now()
      where id = p_session_id;

    v_settlement := public.game_rewards_settle(p_session_id);

    -- Podium news goes out whether or not coins were configured.
    insert into public.notifications (user_id, kind, title, body, payload, entity_id)
    select gp.user_id, 'game_result',
      case gp.rank when 1 then 'O‘yinda 1-o‘rinni egalladingiz 🥇'
                   when 2 then 'O‘yinda 2-o‘rinni egalladingiz 🥈'
                   else 'O‘yinda 3-o‘rinni egalladingiz 🥉' end,
      'Natijalar O‘yingoh tarixida saqlanadi.',
      jsonb_build_object('game_session_id', p_session_id, 'rank', gp.rank, 'score', gp.total_score),
      p_session_id
    from public.game_players gp
    where gp.session_id = p_session_id and gp.rank between 1 and 3 and gp.status <> 'kicked';

    return jsonb_build_object('status', 'finished', 'settlement', v_settlement);
  end if;

  if p_action <> 'next' then
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;

  case v_session.status
    when 'lobby'::public.game_session_status then
      if v_session.game_id is null then
        raise exception 'Avval o‘yinni tanlang.' using errcode = '22023';
      end if;
      if v_session.player_count < 1 then
        raise exception 'Hech kim qo‘shilmadi. Kamida bitta ishtirokchi kerak.' using errcode = '22023';
      end if;
      if not public.game_can_host(v_session.game_id, v_user) then
        raise exception 'O‘yinni boshlash huquqingiz yo‘q.' using errcode = '42501';
      end if;

      -- The deck snapshot: edits to the game after this moment change nothing
      -- for this room.
      select coalesce(array_agg(q.id order by q.position, q.created_at), '{}')
        into v_session.question_ids
        from public.game_questions q where q.game_id = v_session.game_id;
      if coalesce(array_length(v_session.question_ids, 1), 0) < 1 then
        raise exception 'Bu o‘yinda hali savol yo‘q.' using errcode = '22023';
      end if;

      -- The coin hold happens here, before anything is shown to the room.
      perform public.game_rewards_reserve(v_session);

      update public.games set sessions_count = sessions_count + 1 where id = v_session.game_id;

      update public.game_sessions set
        status = 'countdown'::public.game_session_status,
        question_ids = v_session.question_ids,
        current_index = -1,
        started_at = now(),
        phase_deadline = now() + interval '4 seconds',
        state_version = state_version + 1, last_advance_at = now()
        where id = p_session_id;

    when 'countdown'::public.game_session_status,
         'question_result'::public.game_session_status,
         'leaderboard'::public.game_session_status then
      if v_session.status = 'question_result'::public.game_session_status then
        -- Result → leaderboard, always: the scoreboard is part of the rhythm.
        update public.game_sessions set
          status = 'leaderboard'::public.game_session_status,
          phase_deadline = null,
          state_version = state_version + 1, last_advance_at = now()
          where id = p_session_id;
      else
        v_next := v_session.current_index + 1;
        if v_next >= coalesce(array_length(v_session.question_ids, 1), 0) then
          -- Countdown with an empty snapshot cannot happen (checked at start);
          -- leaderboard past the last question is handled by the finish branch.
          raise exception 'Savollar tugadi.' using errcode = '22023';
        end if;
        select * into v_question from public.game_questions where id = v_session.question_ids[v_next + 1];
        if not found then
          raise exception 'Savol topilmadi — o‘yin o‘zgartirilgan.' using errcode = 'P0002';
        end if;
        update public.game_sessions set
          status = 'question'::public.game_session_status,
          current_index = v_next,
          question_started_at = now(),
          phase_deadline = now() + make_interval(secs => v_question.time_limit_seconds),
          state_version = state_version + 1, last_advance_at = now()
          where id = p_session_id;
      end if;

    when 'question'::public.game_session_status then
      perform public.game_to_result(v_session);

    else
      raise exception 'O‘yin bu holatdan davom etmaydi.' using errcode = '22023';
  end case;

  select * into v_session from public.game_sessions where id = p_session_id;
  return jsonb_build_object(
    'status', v_session.status,
    'current_index', v_session.current_index,
    'phase_deadline', v_session.phase_deadline,
    'state_version', v_session.state_version
  );
end;
$function$;


create or replace function public.game_screen_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.game_sessions%rowtype;
  v_question public.game_questions%rowtype;
  v_game public.games%rowtype;
  v_state jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
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
    'game_kind', coalesce(v_game.kind, 'quiz'),
    -- A team grid game: the board's own picture of it, never an answer the host has not shown.
    'grid', public.game_grid_view(v_session, false),
    -- Mafia: who is in and who is out; the cards only once a game is over.
    'mafia', public.game_mafia_view(v_session, 'screen'),
    -- The projector prints its own words (true/false, answers, results) in the
    -- language the questions are written in, not the website's.
    'game_language', coalesce(v_game.language, 'uz'),
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'current_index', v_session.current_index,
    'question_count', coalesce(array_length(v_session.question_ids, 1),
                               case when v_session.game_id is null then 0
                                    else (select count(*)::integer from public.game_questions q where q.game_id = v_session.game_id) end),
    'phase_deadline', v_session.phase_deadline,
    'question_started_at', v_session.question_started_at,
    'team_mode', v_session.team_mode,
    'allow_late_join', v_session.allow_late_join,
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
            -- A crossword counts the players who finished it.
            and (v_question.type <> 'crossword'::public.game_question_type or payload ->> 'done' = 'true')
        )
      );
      if v_question.type = 'crossword'::public.game_question_type then
        v_state := v_state || jsonb_build_object(
          'crossword_progress', public.game_crossword_progress(p_session_id, v_session.current_index));
      end if;
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
$function$;


create or replace function public.game_host_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_answered integer := 0;
  v_question public.game_questions%rowtype;
  v_current jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found or v_session.host_user_id is distinct from v_user then
    raise exception 'session not found' using errcode = 'P0002';
  end if;

  -- Only meaningful while a question is open, and only counted then: on a
  -- leaderboard this is a scan of every answer in the game for no reason.
  if v_session.status = 'question'::public.game_session_status then
    select count(*) into v_answered
      from public.game_answers a
     where a.session_id = p_session_id
       and a.question_index = v_session.current_index
       -- A crossword counts the players who finished it.
       and coalesce(a.payload ->> 'done', 'true') <> 'false';  -- compared as text: a player's payload is not trusted to be a boolean
  end if;

  -- The host sees the open question with its answer: the room does not, but
  -- the person running it should, to explain and to keep an eye on answers.
  if v_session.status in ('question'::public.game_session_status, 'question_result'::public.game_session_status)
     and v_session.question_ids is not null then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_current := jsonb_build_object(
        'id', v_question.id, 'type', v_question.type, 'prompt', v_question.prompt,
        'media_path', v_question.media_path, 'config', v_question.config,
        'explanation', v_question.explanation);
      if v_question.type = 'crossword'::public.game_question_type then
        v_current := v_current || jsonb_build_object(
          'crossword_progress', public.game_crossword_progress(p_session_id, v_session.current_index));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'game_id', v_session.game_id,
    'game_kind', coalesce((select g.kind from public.games g where g.id = v_session.game_id), 'quiz'),
    'grid', public.game_grid_view(v_session, true),
    'mafia', public.game_mafia_view(v_session, 'host'),
    'join_token', v_session.join_token,
    'join_code', v_session.join_code,
    'realtime_token', v_session.realtime_token,
    'current_index', v_session.current_index,
    'team_mode', v_session.team_mode,
    'teams', v_session.teams,
    'show_on_phones', v_session.show_on_phones,
    'allow_late_join', v_session.allow_late_join,
    'current_question', v_current,
    'sound_enabled', v_session.sound_enabled,
    'reward_plan', v_session.reward_plan,
    'reward_state', v_session.reward_state,
    'reward_reserved', v_session.reward_reserved,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    -- When this phase ends, so the host can advance without being told to.
    'phase_deadline', v_session.phase_deadline,
    'answered_count', v_answered
  );
end;
$function$;


create or replace function public.game_player_state(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions%rowtype;
  v_player public.game_players%rowtype;
  v_question public.game_questions%rowtype;
  v_state jsonb;
  v_answer public.game_answers%rowtype;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_session from public.game_sessions where id = p_session_id;
  if not found then raise exception 'session not found' using errcode = 'P0002'; end if;
  select * into v_player from public.game_players
    where session_id = p_session_id and user_id = v_user;
  if not found then raise exception 'Siz bu o‘yinda emassiz.' using errcode = '42501'; end if;

  v_state := jsonb_build_object(
    'status', v_session.status,
    'current_index', v_session.current_index,
    'question_count', coalesce(array_length(v_session.question_ids, 1),
                               (select count(*)::integer from public.game_questions q where q.game_id = v_session.game_id)),
    'phase_deadline', v_session.phase_deadline,
    'show_on_phones', v_session.show_on_phones,
    'team_mode', v_session.team_mode,
    'player_count', v_session.player_count,
    'state_version', v_session.state_version,
    'game_kind', coalesce((select g.kind from public.games g where g.id = v_session.game_id), 'quiz'),
    -- Mafia: this player's own card, and nobody else's until the game is over.
    'mafia', public.game_mafia_view(v_session, 'player', v_player.id),
    'me', jsonb_build_object(
      'player_id', v_player.id, 'nickname', v_player.nickname, 'avatar_id', v_player.avatar_id,
      'team', v_player.team, 'total_score', v_player.total_score, 'rank', v_player.rank
    )
  );

  if v_session.status in ('question'::public.game_session_status,
                          'question_result'::public.game_session_status)
     and v_session.current_index >= 0 then
    select * into v_question from public.game_questions
      where id = v_session.question_ids[v_session.current_index + 1];
    if found then
      v_state := v_state || jsonb_build_object('question', public.game_sanitized_question(v_question, p_session_id));
      select * into v_answer from public.game_answers
        where session_id = p_session_id and player_id = v_player.id and question_id = v_question.id;
      if v_question.type = 'crossword'::public.game_question_type then
        -- Where this player left the grid, so a phone that reopens picks it
        -- up; "answered" is having finished it.
        v_state := v_state || jsonb_build_object(
          'answered', coalesce((v_answer.payload ->> 'done')::boolean, false),
          'progress', jsonb_build_object(
            'words', coalesce(v_answer.payload -> 'words', '{}'::jsonb),
            'solved_ids', coalesce(v_answer.payload -> 'solved_ids', '[]'::jsonb),
            'score', coalesce(v_answer.score_awarded, 0)
          )
        );
      else
        v_state := v_state || jsonb_build_object('answered', v_answer.id is not null);
      end if;

      if v_session.status = 'question_result'::public.game_session_status then
        v_state := v_state || jsonb_build_object(
          'reveal', jsonb_build_object(
            'config', v_question.config,
            'explanation', v_question.explanation,
            'stats', public.game_question_stats(p_session_id, v_session.current_index),
            'my_answer', case when v_answer.id is null then null else jsonb_build_object(
              'is_correct', v_answer.is_correct,
              'score_awarded', v_answer.score_awarded,
              'response_ms', v_answer.response_ms
            ) end
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
$function$;


-- A Mafia room is not a game anyone made: it does not count on a profile.
create or replace function public.chat_profile(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'full_name', coalesce(p.full_name, ''), 'username', p.username,
    'avatar_url', p.avatar_url, 'bio', coalesce(p.bio, ''),
    'study', concat_ws(' · ', nullif(btrim(coalesce(p.organization, '')), ''), nullif(btrim(coalesce(p.field_of_study, '')), '')),
    -- What their card counts, as one's own does; the balance is theirs alone.
    'decks', (select count(*) from public.presentations d where d.owner_id = p.id and d.status = 'ready'),
    'games', (select count(*) from public.games g where g.owner_id = p.id and g.status = 'ready' and g.kind <> 'mafia'),
    'contact_name', c.display_name, 'muted', coalesce(c.muted, false), 'saved', c.contact_id is not null
  )
  from public.profiles p
  left join public.chat_contacts c on c.owner_id = auth.uid() and c.contact_id = p.id
  where p.id = p_user and auth.uid() is not null and p.status = 'active';
$$;

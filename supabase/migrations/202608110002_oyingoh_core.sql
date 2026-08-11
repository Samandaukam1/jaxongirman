-- O‘yingoh: the tables under a live knowledge match.
--
-- The shape of the problem is the presentation-remote one again, with a crowd:
-- a projector that is signed out, a host phone that is signed in, and now a
-- room full of player phones that must never learn a correct answer before the
-- host reveals it. Three rules hold everything below together:
--
--   * `game_questions.config` carries the correct answers, so no player-facing
--     path ever selects that table. Players receive a *sanitised* question
--     through an RPC that strips the secrets; the projector receives the same
--     through its bearer capability.
--   * The server owns the clock. `phase_deadline` is written by the advance
--     RPC, answers past it are rejected, and the score bonus is computed from
--     `now()` against `question_started_at` — never from a client's stopwatch.
--   * Every mutation is an RPC. Clients hold INSERT/UPDATE on none of these
--     tables; RLS below is entirely about who may *read* what.

-- ------------------------------------------------------------- categories --
/**
 * The subject tree the O‘yingoh home screen browses. One level of nesting,
 * exactly like marketplace_categories, and admin-managed the same way.
 */
create table public.game_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  parent_id uuid references public.game_categories(id) on delete set null,
  icon text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_categories_code_format check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint game_categories_label_length check (char_length(btrim(label)) between 1 and 80),
  constraint game_categories_icon_length check (char_length(icon) <= 40)
);

create index game_categories_parent_idx on public.game_categories (parent_id, sort_order) where is_active;

create trigger game_categories_set_updated_at
  before update on public.game_categories
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ games --
/**
 * One quiz. Owned like a presentation, sold like a marketplace listing,
 * launched like a remote session — the row itself is just the content.
 *
 * `is_free` is the admin's curation switch: a free game appears on everyone's
 * O‘yingoh home and anybody may host it. Ownership never moves — a purchase
 * grants an entitlement, not a copy.
 */
create table public.games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  category_id uuid references public.game_categories(id) on delete set null,
  /** Who the questions are pitched at. Free text from a fixed client list. */
  audience text not null default 'umumiy',
  difficulty text not null default 'aralash',
  cover_path text,
  source_type public.game_source not null default 'manual',
  source_presentation_id uuid references public.presentations(id) on delete set null,
  status public.game_status not null default 'draft',
  /** Why a generation failed, in words an operator can act on. Safe to show. */
  failure_reason text,
  is_free boolean not null default false,
  featured_at timestamptz,
  question_count integer not null default 0,
  sessions_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_title_length check (char_length(title) <= 160),
  constraint games_description_length check (char_length(description) <= 2000),
  constraint games_audience check (audience in (
    'maktab_1_4', 'maktab_5_9', 'maktab_10_11', 'universitet_bakalavr',
    'universitet_magistr', 'universitet', 'maktab', 'umumiy'
  )),
  constraint games_difficulty check (difficulty in ('oson', 'ortacha', 'qiyin', 'aralash')),
  constraint games_counters check (question_count >= 0 and sessions_count >= 0)
  -- "ready implies at least one question" is enforced by game_set_status():
  -- a table check would also fire inside the question-count trigger and turn
  -- an ordinary question delete into a constraint violation.
);

create index games_owner_idx on public.games (owner_id, updated_at desc);
create index games_free_idx on public.games (featured_at desc nulls last, created_at desc)
  where is_free and status = 'ready'::public.game_status;
create index games_category_idx on public.games (category_id, created_at desc)
  where status = 'ready'::public.game_status;
create index games_presentation_idx on public.games (source_presentation_id)
  where source_presentation_id is not null;

create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- questions --
/**
 * One question. `config` is the whole answer key — options, the correct ids,
 * the accepted spellings, the hotspot region — which is why this table is the
 * most protected thing in the module. Its shape depends on `type`:
 *
 *   single_choice / image_quiz: { options: [{id, text}], correct: id }
 *   true_false:                 { correct: boolean }
 *   multiple_choice:            { options: [{id, text}], correct: [id, …] }
 *   ordering:                   { items: [{id, text}], order: [id, …] }
 *   matching:                   { left: [{id, text}], right: [{id, text}], pairs: {leftId: rightId} }
 *   fill_blank:                 { answers: [text, …] }        (case/space-normalised)
 *   word_cloud:                 { }                           (no key, no default points)
 *   poll:                       { options: [{id, text}] }     (no key, no points)
 *   open_answer:                { reference: text, ai_grading: boolean }
 *   hotspot:                    { region: {x, y, w, h}, shape: 'rect'|'circle' } (normalised 0–1)
 *
 * `owner_id` is denormalised and pinned to the game's owner by the composite
 * foreign key, the same owner-consistency trick slides use: a question cannot
 * be attached across owners, and RLS gets a one-column check.
 */
create table public.game_questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null,
  owner_id uuid not null,
  position integer not null default 0,
  type public.game_question_type not null,
  prompt text not null default '',
  explanation text not null default '',
  time_limit_seconds integer not null default 20,
  base_points integer not null default 1000,
  media_path text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_questions_prompt_length check (char_length(prompt) <= 600),
  constraint game_questions_explanation_length check (char_length(explanation) <= 1000),
  constraint game_questions_time check (time_limit_seconds between 5 and 300),
  constraint game_questions_points check (base_points between 0 and 5000),
  constraint game_questions_position check (position >= 0)
);

-- The composite target the children point at, so game_id and owner_id can
-- never disagree with the games table.
create unique index games_id_owner_idx on public.games (id, owner_id);
alter table public.game_questions
  add constraint game_questions_game_owner_fkey
  foreign key (game_id, owner_id) references public.games (id, owner_id) on delete cascade;

create index game_questions_game_idx on public.game_questions (game_id, position);

create trigger game_questions_set_updated_at
  before update on public.game_questions
  for each row execute function public.set_updated_at();

/** Keeps games.question_count honest without an aggregate on every list. */
create or replace function public.game_sync_question_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.games set question_count = question_count + 1 where id = new.game_id;
    return new;
  end if;
  update public.games set question_count = greatest(question_count - 1, 0) where id = old.game_id;
  return old;
end;
$$;

create trigger game_questions_count_insert
  after insert on public.game_questions
  for each row execute function public.game_sync_question_count();
create trigger game_questions_count_delete
  after delete on public.game_questions
  for each row execute function public.game_sync_question_count();

-- --------------------------------------------------------------- sessions --
/**
 * One live match: the shared state a projector renders, a host drives and a
 * room of phones answers against.
 *
 * Same capability model as presentation_sessions: the raw screen token is
 * returned exactly once and only its SHA-256 digest is stored; the realtime
 * token names a private broadcast channel; the pairing QR is handled by the
 * same rotating single-use tokens. Two things are new:
 *
 *   * `join_token` — the code the *room* scans. It is public to everyone
 *     physically present (it is on the projector), so it is not a secret in
 *     the pairing sense; it is unguessable so that nobody *outside* the room
 *     can join, and it dies with the session.
 *   * `question_ids` — the deck snapshot taken at start. Editing a game
 *     mid-match must not reorder anybody's questions.
 *
 * The reward plan is priced before the countdown: `game_rewards_reserve` holds
 * the host's maximum liability in their wallet, and the session cannot start
 * with a plan it cannot pay.
 */
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  status public.game_session_status not null default 'lobby',
  game_id uuid references public.games(id) on delete set null,
  host_user_id uuid references auth.users(id) on delete cascade,
  /** Set while a projector is attached; phone-only matches leave it null. */
  screen_token_hash text,
  realtime_token text not null,
  join_token text not null unique,
  join_code text not null,
  team_mode boolean not null default false,
  /** Team names when team_mode; players are dealt into them round-robin. */
  teams jsonb not null default '[]'::jsonb,
  /** The deck snapshot. Order is play order. Empty until the match starts. */
  question_ids uuid[] not null default '{}',
  current_index integer not null default -1,
  question_started_at timestamptz,
  /** The server clock every answer is judged against. */
  phase_deadline timestamptz,
  show_on_phones boolean not null default true,
  sound_enabled boolean not null default true,
  /**
   * {first, second, third, participant} in whole coins, all optional.
   * Snapshotted liability lives in reward_reserved once the hold is taken.
   */
  reward_plan jsonb not null default '{}'::jsonb,
  reward_state text not null default 'none',
  reward_reserved integer not null default 0,
  player_count integer not null default 0,
  /** Bumped by every state change; clients refetch when they see it move. */
  state_version bigint not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  last_advance_at timestamptz,
  expires_at timestamptz not null default now() + interval '6 hours',
  created_at timestamptz not null default now(),
  constraint game_sessions_screen_token_hash_shape
    check (screen_token_hash is null or screen_token_hash ~ '^[0-9a-f]{64}$'),
  constraint game_sessions_realtime_token_shape check (realtime_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint game_sessions_join_token_shape check (join_token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint game_sessions_join_code_shape check (join_code ~ '^[0-9]{6}$'),
  constraint game_sessions_current_index check (current_index >= -1),
  constraint game_sessions_reward_state check (reward_state in ('none', 'reserved', 'settled', 'refunded')),
  constraint game_sessions_reward_reserved check (reward_reserved >= 0),
  constraint game_sessions_counters check (player_count >= 0 and state_version >= 0),
  -- A match that is running has a host and a game; a lobby may still be
  -- waiting for either (a projector opens the shell before anyone signs in).
  constraint game_sessions_running_is_bound check (
    status in ('lobby'::public.game_session_status,
               'cancelled'::public.game_session_status,
               'expired'::public.game_session_status)
    or (host_user_id is not null and game_id is not null)
  )
);

create index game_sessions_live_idx on public.game_sessions (expires_at)
  where status not in ('finished'::public.game_session_status,
                       'cancelled'::public.game_session_status,
                       'expired'::public.game_session_status);
create index game_sessions_host_idx on public.game_sessions (host_user_id, created_at desc);
create index game_sessions_game_idx on public.game_sessions (game_id, created_at desc);
-- One live session per join code. Finished codes recycle.
create unique index game_sessions_join_code_live_idx on public.game_sessions (join_code)
  where status not in ('finished'::public.game_session_status,
                       'cancelled'::public.game_session_status,
                       'expired'::public.game_session_status);

-- ---------------------------------------------------------------- players --
/**
 * One person inside one match. `unique (session_id, user_id)` is the
 * reconnect story: scanning the QR twice, or coming back after a tunnel,
 * lands on the same row — never a duplicate player.
 */
create table public.game_players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  avatar_id integer not null default 0,
  team text,
  status public.game_player_status not null default 'joined',
  /**
   * False for anyone who joined after the reward hold was taken: the hold was
   * sized on the lobby, and a late joiner must not be able to outgrow it.
   */
  reward_eligible boolean not null default true,
  total_score integer not null default 0,
  correct_count integer not null default 0,
  rank integer,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, user_id),
  constraint game_players_nickname_length check (char_length(btrim(nickname)) between 1 and 30),
  constraint game_players_avatar check (avatar_id between 0 and 39),
  constraint game_players_score check (total_score >= 0 and correct_count >= 0)
);

create index game_players_session_idx on public.game_players (session_id, total_score desc, joined_at);
create index game_players_user_idx on public.game_players (user_id, joined_at desc);

/** Keeps the lobby's participant counter on the session row itself. */
create or replace function public.game_sync_player_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.game_sessions
      set player_count = player_count + 1, state_version = state_version + 1
      where id = new.session_id;
    return new;
  end if;
  update public.game_sessions
    set player_count = greatest(player_count - 1, 0), state_version = state_version + 1
    where id = old.session_id;
  return old;
end;
$$;

create trigger game_players_count_insert
  after insert on public.game_players
  for each row execute function public.game_sync_player_count();
create trigger game_players_count_delete
  after delete on public.game_players
  for each row execute function public.game_sync_player_count();

-- ---------------------------------------------------------------- answers --
/**
 * One accepted answer. The unique key *is* the anti-cheat rule "one player,
 * one question, one answer" — a second submit updates nothing and returns the
 * first verdict, because the insert is `on conflict do nothing` inside the RPC.
 *
 * `is_correct` is null where the question has no key (word_cloud, poll) or the
 * verdict is pending host review (open_answer).
 */
create table public.game_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.game_players(id) on delete cascade,
  question_id uuid not null references public.game_questions(id) on delete cascade,
  question_index integer not null,
  payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  response_ms integer not null default 0,
  is_correct boolean,
  score_awarded integer not null default 0,
  /** Confidence of an AI verdict on open_answer; null when a human decided. */
  ai_confidence numeric(4,3),
  reviewed_by_host boolean not null default false,
  unique (session_id, player_id, question_id),
  constraint game_answers_response check (response_ms >= 0),
  constraint game_answers_score check (score_awarded >= 0),
  constraint game_answers_confidence check (ai_confidence is null or (ai_confidence between 0 and 1))
);

create index game_answers_session_question_idx on public.game_answers (session_id, question_index);
create index game_answers_player_idx on public.game_answers (player_id);

-- -------------------------------------------------------------------- RLS --
-- Membership checks run as the definer: a policy on game_players that asked
-- game_players who else is in the room would recurse into itself, and the
-- sessions and players policies would otherwise recurse into each other.
create or replace function public.game_is_participant(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_players gp
    where gp.session_id = p_session_id and gp.user_id = p_user_id
  );
$$;

create or replace function public.game_is_host(p_session_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_sessions gs
    where gs.id = p_session_id and gs.host_user_id = p_user_id
  );
$$;

-- Policies evaluate these as the querying user, so `authenticated` must be
-- able to execute them. They answer one boolean and nothing else.
revoke all on function public.game_is_participant(uuid, uuid) from public, anon;
revoke all on function public.game_is_host(uuid, uuid) from public, anon;
grant execute on function public.game_is_participant(uuid, uuid) to authenticated, service_role;
grant execute on function public.game_is_host(uuid, uuid) to authenticated, service_role;

alter table public.game_categories enable row level security;
alter table public.games enable row level security;
alter table public.game_questions enable row level security;
alter table public.game_sessions enable row level security;
alter table public.game_players enable row level security;
alter table public.game_answers enable row level security;

-- Categories are the one public reference table: everyone browses them.
create policy game_categories_select on public.game_categories for select
  using (is_active or (select public.is_admin()));

-- A game is visible to its owner, and to everyone once the admin marks it
-- free. Marketplace visibility goes through the product listing, not here.
create policy games_owner_select on public.games for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy games_free_select on public.games for select
  using (is_free and status = 'ready'::public.game_status);
create policy games_owner_insert on public.games for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy games_owner_update on public.games for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy games_owner_delete on public.games for delete to authenticated
  using (owner_id = (select auth.uid()));

-- The answer key. Owner only — a player, an entitled buyer browsing a listing,
-- and the projector all receive questions through RPCs that decide what to
-- strip. There is deliberately no path from "I am in this session" to this table.
create policy game_questions_owner_select on public.game_questions for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()));
create policy game_questions_owner_insert on public.game_questions for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy game_questions_owner_update on public.game_questions for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy game_questions_owner_delete on public.game_questions for delete to authenticated
  using (owner_id = (select auth.uid()));

-- The projector follows its session row while signed out, exactly like a
-- presentation screen. The column grant below keeps the tokens, the host and
-- the reward plan out of what `anon` may even ask for.
create policy game_sessions_screen_select on public.game_sessions for select to anon
  using (
    status not in ('cancelled'::public.game_session_status, 'expired'::public.game_session_status)
    and expires_at > now()
  );
create policy game_sessions_participant_select on public.game_sessions for select to authenticated
  using (
    host_user_id = (select auth.uid())
    or public.game_is_participant(id, (select auth.uid()))
    or (select public.is_admin())
  );

-- Players see the room they are in: the lobby list and the leaderboard are
-- these rows. The projector reads the same through its bearer RPC.
create policy game_players_participant_select on public.game_players for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.game_is_host(session_id, (select auth.uid()))
    or public.game_is_participant(session_id, (select auth.uid()))
    or (select public.is_admin())
  );

-- A player reads their own verdicts; the host reviews everybody's.
create policy game_answers_select on public.game_answers for select to authenticated
  using (
    exists (
      select 1 from public.game_players gp
      where gp.id = game_answers.player_id and gp.user_id = (select auth.uid())
    )
    or public.game_is_host(session_id, (select auth.uid()))
    or (select public.is_admin())
  );

-- Sessions, players and answers are written only by RPCs. Games and questions
-- are content — the editor writes them directly under RLS — but the columns an
-- owner may touch are listed one by one: curation (is_free, featured_at),
-- counters, and lifecycle status stay with the server, so nobody promotes
-- their own game onto everyone's home screen.
revoke all on public.game_categories, public.games, public.game_questions,
  public.game_sessions, public.game_players, public.game_answers
  from anon, authenticated;

grant select on public.game_categories to anon, authenticated;

grant select on public.games to anon, authenticated;
grant insert (
  id, owner_id, title, description, category_id, audience, difficulty,
  cover_path, source_type, source_presentation_id
) on public.games to authenticated;
grant update (
  title, description, category_id, audience, difficulty, cover_path,
  source_presentation_id
) on public.games to authenticated;
grant delete on public.games to authenticated;

grant select, insert, update, delete on public.game_questions to authenticated;

-- The projector may follow the public shape of a match and nothing else: no
-- tokens, no host identity, no reward plan.
grant select (
  id, status, game_id, current_index, question_started_at, phase_deadline,
  team_mode, teams, show_on_phones, sound_enabled, player_count, state_version,
  started_at, ended_at, expires_at, created_at
) on public.game_sessions to anon;
-- A signed-in participant additionally sees the join code (it is on the wall
-- of the room they are in), the host, and the reward plan. The realtime token
-- and the screen token hash are deliberately absent: the private broadcast
-- channel belongs to the host and the projector, and players must not be able
-- to listen on it. The host recovers the token through game_host_state().
grant select (
  id, status, game_id, host_user_id, join_code, join_token, current_index,
  question_started_at, phase_deadline, team_mode, teams, show_on_phones,
  sound_enabled, reward_plan, reward_state, reward_reserved, player_count,
  state_version, started_at, ended_at, expires_at, created_at
) on public.game_sessions to authenticated;
grant select on public.game_players to authenticated;
grant select on public.game_answers to authenticated;
grant select on public.game_categories, public.games, public.game_questions,
  public.game_sessions, public.game_players, public.game_answers to service_role;

-- --------------------------------------------------------------- realtime --
-- Phones and projectors follow the session row; every state change bumps
-- state_version and arrives as one UPDATE. Player rows are deliberately not
-- published: the join animation refetches on player_count moving, which keeps
-- payloads small at a hundred players.
alter publication supabase_realtime add table public.game_sessions;

-- ---------------------------------------------------------------- storage --
-- Public on purpose, unlike every other bucket: a question image is quiz
-- content shown to a whole room, including a signed-out projector, and paths
-- are unguessable UUIDs under the owner's folder. Nothing personal lands here —
-- private user documents keep living in the private buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-assets', 'game-assets', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Covers and question images follow the same <uid>/... write convention as
-- every other bucket: only the owner manages their own folder.
create policy game_assets_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'game-assets' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));
create policy game_assets_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'game-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy game_assets_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'game-assets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'game-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy game_assets_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'game-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

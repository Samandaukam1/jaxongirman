-- Enum labels the O‘yingoh module needs. They live alone in this file because
-- Postgres refuses to *use* an enum value in the same transaction that adds it —
-- the migrations that follow are what put them to work. Same shape as
-- 202608090001_home_foundation_enums.sql.

-- The twelve ways a question can ask. The user-facing names are Uzbek
-- ("Bosh qotirma", "Rostmi, yolg‘onmi?" …); these are their internal codes.
create type public.game_question_type as enum (
  'single_choice',    -- Bosh qotirma
  'true_false',       -- Rostmi, yolg‘onmi?
  'multiple_choice',  -- Bir nechtasini tanlang
  'ordering',         -- Tartibga soling
  'matching',         -- Juftini toping
  'fill_blank',       -- Bo‘sh joyni to‘ldiring
  'word_cloud',       -- So‘zlar buluti
  'poll',             -- Ovoz berish
  'open_answer',      -- Erkin javob
  'image_quiz',       -- Rasmni toping
  'hotspot'           -- Rasmdan joyni toping
  -- Jamoaviy bellashuv is a session mode, not a question shape: any of the
  -- above can be played in teams, so it lives on game_sessions.team_mode.
);

-- Where a game came from. 'presentation' is the one the product is really
-- about: a deck that finishes and turns into a match.
create type public.game_source as enum ('manual', 'ai', 'text', 'file', 'presentation');

-- A game's shelf life. Drafts are being edited; 'ready' can be hosted;
-- 'archived' is the soft delete that keeps sold copies and history working.
create type public.game_status as enum ('generating', 'draft', 'ready', 'archived', 'failed');

/**
 * The live match state machine. Transitions are enforced by game_session_advance:
 * lobby → countdown → question ⇄ question_result → leaderboard → question …
 * → finished. cancelled/expired are terminal. finished → question is impossible.
 */
create type public.game_session_status as enum (
  'lobby', 'countdown', 'question', 'question_result', 'leaderboard',
  'finished', 'cancelled', 'expired'
);

/** A player's presence inside one session. */
create type public.game_player_status as enum ('joined', 'disconnected', 'left', 'kicked');

-- The reward ledger speaks in its own words. Reserve holds the host's coins
-- before the first question; the other two are how the hold resolves.
alter type public.credit_transaction_type add value if not exists 'game_reward_reserve';
alter type public.credit_transaction_type add value if not exists 'game_reward';
alter type public.credit_transaction_type add value if not exists 'game_reward_refund';

-- The inbox learns what a match can announce.
alter type public.notification_kind add value if not exists 'game_reward';
alter type public.notification_kind add value if not exists 'game_result';

import type { GameQuestionType, GameRewardPlan, GameSessionStatus, Json, Tables } from "@jaxongirman/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { withNetworkRetry } from "./retry";
import { supabase } from "./supabase";

/**
 * The O‘yingoh client surface: every server conversation a screen needs, typed
 * once. Nothing in here computes a score, holds a correct answer or trusts a
 * clock — those live in the database; this file just names the calls.
 */

export type Game = Tables<"games">;
export type GameQuestion = Tables<"game_questions">;
export type GameCategory = Tables<"game_categories">;

export type HostState = {
  session_id: string;
  status: GameSessionStatus;
  game_id: string | null;
  join_token: string;
  join_code: string;
  realtime_token: string;
  current_index: number;
  team_mode: boolean;
  teams: string[];
  show_on_phones: boolean;
  sound_enabled: boolean;
  reward_plan: GameRewardPlan;
  reward_state: string;
  reward_reserved: number;
  player_count: number;
  state_version: number;
  /** When the current phase runs out, so the host can advance itself. */
  phase_deadline: string | null;
  /** How many have answered the open question. Zero outside one. */
  answered_count: number;
};

export type SanitizedQuestion = {
  id: string;
  type: GameQuestionType;
  prompt: string;
  time_limit_seconds: number;
  base_points: number;
  media_path: string | null;
  config: {
    options?: { id: string; text: string }[];
    items?: { id: string; text: string }[];
    left?: { id: string; text: string }[];
    right?: { id: string; text: string }[];
    kind?: string;
    max_length?: number;
  };
};

export type QuestionStats = {
  answers: number;
  correct: number;
  incorrect: number;
  pending: number;
  choices: Record<string, number>;
  words: Record<string, number>;
};

export type LeaderboardPayload = {
  players: { id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; correct_count: number; rank: number }[];
  teams: { team: string; total_score: number; players: number }[];
};

export type PlayerState = {
  status: GameSessionStatus;
  current_index: number;
  question_count: number;
  phase_deadline: string | null;
  show_on_phones: boolean;
  team_mode: boolean;
  player_count: number;
  state_version: number;
  me: { player_id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; rank: number | null };
  question?: SanitizedQuestion;
  answered?: boolean;
  reveal?: {
    config: Json;
    explanation: string;
    stats: QuestionStats;
    my_answer: { is_correct: boolean | null; score_awarded: number; response_ms: number } | null;
  };
  leaderboard?: LeaderboardPayload;
};

/**
 * Every O‘yingoh call, with a dropped connection asked again.
 *
 * These are the calls made in a room full of people on one overloaded cell:
 * joining, answering, advancing. A lost packet used to end the attempt and
 * show a Swift stack trace; now the question is simply asked again, and only a
 * server that actually answered is treated as final.
 */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  return withNetworkRetry(async () => {
    const { data, error } = await supabase.rpc(name as never, args as never);
    if (error) throw error;
    return data as T;
  });
}

// ---------------------------------------------------------------- sessions --
export const createSession = (gameId: string) =>
  rpc<{ session_id: string; join_token: string; join_code: string; realtime_token: string }>(
    "game_session_create", { p_game_id: gameId });

export const claimPairing = (token: string, gameId?: string) =>
  rpc<{ session_id: string; game_id: string | null; join_token: string; join_code: string; realtime_token: string }>(
    "game_pairing_claim", { p_token: token, p_game_id: gameId ?? null });

export const hostState = (sessionId: string) =>
  rpc<HostState>("game_host_state", { p_session_id: sessionId });

export const configureSession = (sessionId: string, config: {
  gameId?: string; teamMode?: boolean; teams?: string[];
  showOnPhones?: boolean; soundEnabled?: boolean; rewardPlan?: GameRewardPlan;
}) =>
  rpc<HostState>("game_session_configure", {
    p_session_id: sessionId,
    p_game_id: config.gameId ?? null,
    p_team_mode: config.teamMode ?? null,
    p_teams: config.teams ?? null,
    p_show_on_phones: config.showOnPhones ?? null,
    p_sound_enabled: config.soundEnabled ?? null,
    p_reward_plan: config.rewardPlan ?? null,
  });

export const advanceSession = (sessionId: string, action: "next" | "finish" | "cancel" = "next") =>
  rpc<{ status: GameSessionStatus; current_index?: number; phase_deadline?: string | null; state_version?: number }>(
    "game_session_advance", { p_session_id: sessionId, p_action: action });

export const joinGame = (joinToken: string, nickname: string, avatarId: number) =>
  rpc<{ session_id: string; player_id: string; status: GameSessionStatus }>(
    "game_join", { p_join_token: joinToken, p_nickname: nickname, p_avatar_id: avatarId });

export const joinGameByCode = (code: string, nickname: string, avatarId: number) =>
  rpc<{ session_id: string; player_id: string; status: GameSessionStatus }>(
    "game_join_by_code", { p_code: code, p_nickname: nickname, p_avatar_id: avatarId });

export const submitAnswer = (sessionId: string, questionIndex: number, payload: Record<string, unknown>) =>
  rpc<{ accepted: boolean; locked: boolean }>(
    "game_submit_answer", { p_session_id: sessionId, p_question_index: questionIndex, p_payload: payload });

export const playerState = (sessionId: string) =>
  rpc<PlayerState>("game_player_state", { p_session_id: sessionId });

export const reviewAnswer = (answerId: string, isCorrect: boolean) =>
  rpc<{ is_correct: boolean; score_awarded: number }>(
    "game_host_review_answer", { p_answer_id: answerId, p_is_correct: isCorrect });

export const setGameStatus = (gameId: string, status: "draft" | "ready" | "archived") =>
  rpc<{ id: string; status: string; question_count: number }>(
    "game_set_status", { p_game_id: gameId, p_status: status });

export const myGameStats = () =>
  rpc<{ played: number; wins: number; top3: number; average_score: number; coins_won: number }>("game_my_stats", {});

export const launchPresentationGame = (presentationSessionId: string) =>
  rpc<{ game_session_id: string; game_id: string; game_title: string; screen_token: string; realtime_token: string; join_token: string; join_code: string }>(
    "presentation_launch_game", { p_presentation_session_id: presentationSessionId });

export const presentationHasGame = (presentationId: string) =>
  rpc<boolean>("presentation_has_game", { p_presentation_id: presentationId });

// -------------------------------------------------------------- generation --
export type GenerateGameInput = {
  mode: "topic" | "text" | "presentation" | "regenerate";
  topic?: string;
  text?: string;
  presentationId?: string;
  gameId?: string;
  questionId?: string;
  difficulty?: string;
  audience?: string;
  questionCount?: number;
  types?: GameQuestionType[];
  categoryId?: string | null;
};

export async function generateGame(input: GenerateGameInput): Promise<{ gameId: string; status: string }> {
  // Creating a game is one request that starts a background job; a request that
  // never arrived started nothing, so asking again is free.
  const { data, error } = await withNetworkRetry(() =>
    supabase.functions.invoke("generate-game", { body: input }));
  if (error) {
    // The function wraps its refusals in a JSON body worth surfacing verbatim —
    // but `context` is only sometimes a `Response`, and calling `.json()` on
    // whatever else it may be throws a TypeError that reaches the screen as the
    // error. Checked before it is used, for the same reason as in `orders.ts`.
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const body = await (context as Response).json().catch(() => null) as { error?: string } | null;
      if (body?.error) throw new Error(body.error);
    }
    throw error;
  }
  return data as { gameId: string; status: string };
}

// ---------------------------------------------------------------- realtime --
/**
 * Follows one match and calls back on every state change. The session row is
 * the only thing published; every screen refetches its own sanitised state
 * when state_version moves, which keeps payloads identical for 3 players and
 * 100.
 */
export function subscribeToSession(sessionId: string, onChange: () => void): RealtimeChannel {
  return supabase
    .channel(`game-session-${sessionId}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
      onChange)
    .subscribe();
}

// ------------------------------------------------------------------ shelves --
export const listCategories = async (): Promise<GameCategory[]> => {
  const { data, error } = await supabase
    .from("game_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
};

/**
 * Filtered by owner, always.
 *
 * These tables' select policies end in `or is_admin()`, which the admin console
 * needs and which applies just as well to an administrator using the ordinary
 * app — so an unfiltered "my things" query hands them everybody's things. The
 * app states whose list it is asking for; the policy is the floor, not the plan.
 */
export const listMyGames = async (ownerId: string): Promise<Game[]> => {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
};

export const listFreeGames = async (): Promise<Game[]> => {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("is_free", true)
    .eq("status", "ready")
    .order("featured_at", { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
};

export const listQuestions = async (gameId: string): Promise<GameQuestion[]> => {
  const { data, error } = await supabase
    .from("game_questions")
    .select("*")
    .eq("game_id", gameId)
    .order("position");
  if (error) throw error;
  return data ?? [];
};

/** Recently finished matches this account took part in, newest first. */
export const listMyMatches = async (): Promise<{ session_id: string; joined_at: string; total_score: number; rank: number | null; game_title: string }[]> => {
  const { data, error } = await supabase
    .from("game_players")
    .select("session_id, joined_at, total_score, rank, game_sessions!inner(status, ended_at, games(title))")
    .order("joined_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? [])
    .filter((row) => (row.game_sessions as unknown as { status: string }).status === "finished")
    .map((row) => ({
      session_id: row.session_id,
      joined_at: row.joined_at,
      total_score: row.total_score,
      rank: row.rank,
      game_title: ((row.game_sessions as unknown as { games: { title: string } | null }).games?.title) ?? "O‘yin",
    }));
};

/** The games this account may put in front of a room, for the host's picker. */
export const listHostable = () =>
  rpc<{ id: string; title: string; question_count: number; category_label: string | null; difficulty: string; source: string }[]>(
    "game_hostable_list", {});

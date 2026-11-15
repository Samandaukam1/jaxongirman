import type { GameQuestionType, GameRewardPlan, GameSessionStatus, Json, Tables } from "@jaxongirman/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { i18n } from "../i18n";

import { DEFAULT_HOST } from "./marathon-link-core";
import { withNetworkRetry } from "./retry";
import { changesChannel, supabase } from "./supabase";
import { isWeb, WEB_BASE } from "./web";

/**
 * The O‘yingoh client surface: every server conversation a screen needs, typed
 * once. Nothing in here computes a score, holds a correct answer or trusts a
 * clock — those live in the database; this file just names the calls.
 */

export type Game = Tables<"games">;
export type GameQuestion = Tables<"game_questions">;
export type GameCategory = Tables<"game_categories">;

/** A team grid game as the host sees it (`game_grid_view`). */
export type GridView = {
  teams: string[];
  scores: number[];
  turn: number;
  cells: { points: number; state: "closed" | "won" | "missed"; team: number | null }[];
  open: null | { cell: number; points: number; prompt: string; media_path: string | null; answer: string | null; revealed: boolean };
};

/** The Mafia cards, in the order a deck is laid out: the mafia's side first. */
export const MAFIA_ROLES = ["don", "mafia", "sheriff", "doctor", "lover", "maniac", "civilian"] as const;
export type MafiaRole = (typeof MAFIA_ROLES)[number];
export type MafiaSpecial = Exclude<MafiaRole, "mafia" | "civilian">;
export type MafiaWinner = "town" | "mafia" | "maniac";
/** How many of each card the host wants: the rest of the table are Fuqaro. */
export type MafiaSetup = { mafia: number } & Record<MafiaSpecial, 0 | 1>;

/** One person in the Mafia room. `role` is there only where it may be seen. */
export type MafiaPlayer = {
  id: string;
  nickname: string;
  avatar_id: number;
  /** Dealt into the game on now; false for someone waiting for the next one. */
  in_game: boolean;
  alive: boolean;
  out_reason: "night" | "vote" | "host" | null;
  out_round: number | null;
  role: MafiaRole | null;
  /** The host only: has this player turned their card over yet. */
  seen?: boolean | null;
};

/** A Mafia game as one screen sees it (`game_mafia_view`). */
export type MafiaView = {
  game_no: number;
  roles: Record<MafiaRole, number>;
  phase: "night" | "day";
  round: number;
  over: boolean;
  winner: MafiaWinner | null;
  players: MafiaPlayer[];
  /** A player's own card. */
  me?: { role: MafiaRole; alive: boolean; out_reason: MafiaPlayer["out_reason"]; out_round: number | null; seen: boolean };
  /** A mafioso's partners; null for everyone else. */
  team?: { id: string; nickname: string; avatar_id: number; role: MafiaRole; alive: boolean }[] | null;
  /** The host only: who the table says has won, when it says so. */
  verdict?: MafiaWinner | null;
};

export const isMafiaSide = (role: MafiaRole | null | undefined) => role === "don" || role === "mafia";

export type HostState = {
  session_id: string;
  status: GameSessionStatus;
  game_id: string | null;
  /** quiz, crossword, grid or mafia: what the chosen game is. */
  game_kind?: string;
  grid?: GridView | null;
  mafia?: MafiaView | null;
  join_token: string;
  join_code: string;
  realtime_token: string;
  current_index: number;
  team_mode: boolean;
  teams: string[];
  show_on_phones: boolean;
  /** Whether latecomers may join once the match has started ("O‘rtadan qo‘shilish"). */
  allow_late_join?: boolean;
  /** The open question with its answer key — the host's eyes only. Null outside a question. */
  current_question?: HostQuestion | null;
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

/** A question as the host sees it: the answer key included. */
export type CrosswordRacer = {
  player_id: string; nickname: string; avatar_id: number; team: string | null;
  solved: number; done: boolean; score: number;
};

export type HostQuestion = {
  id: string;
  type: GameQuestionType;
  prompt: string;
  media_path: string | null;
  config: Record<string, unknown>;
  explanation: string;
  /** A crossword only: who has how many words, best first. */
  crossword_progress?: CrosswordRacer[];
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
  game_kind?: string;
  mafia?: MafiaView | null;
  me: { player_id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; rank: number | null };
  question?: SanitizedQuestion;
  answered?: boolean;
  /** A crossword only: where this player left the grid, and which of their words are right. */
  progress?: { words: Record<string, string>; solved_ids: string[]; score: number };
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

/**
 * The universal join link a match's QR carries: `https://<site>/join/<token>`.
 *
 * The same link the projector draws (`web/lib/public-url.ts`), so a phone's own
 * camera opens the app on "pick a face, type a name", and the in-app scanner
 * reads it too. The configured site first; in a browser served by the site,
 * that site; otherwise the production domain.
 */
export function gameJoinUrl(joinToken: string): string {
  const configured = (process.env.EXPO_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  const origin = configured || (isWeb && WEB_BASE ? window.location.origin : DEFAULT_HOST);
  return `${origin}/join/${joinToken}`;
}

// ---------------------------------------------------------------- sessions --
export const createSession = (gameId: string) =>
  rpc<{ session_id: string; join_token: string; join_code: string; realtime_token: string }>(
    "game_session_create", { p_game_id: gameId });

export const gridStart = (sessionId: string, teams: string[]) =>
  rpc<GridView>("game_grid_start", { p_session_id: sessionId, p_teams: teams });
export const gridOpen = (sessionId: string, cell: number) =>
  rpc<GridView>("game_grid_open", { p_session_id: sessionId, p_cell: cell });
export const gridReveal = (sessionId: string) => rpc<GridView>("game_grid_reveal", { p_session_id: sessionId });
export const gridClose = (sessionId: string) => rpc<GridView>("game_grid_close", { p_session_id: sessionId });
export const gridJudge = (sessionId: string, correct: boolean) =>
  rpc<GridView>("game_grid_judge", { p_session_id: sessionId, p_correct: correct });
export const gridFinish = (sessionId: string) => rpc<GridView>("game_grid_finish", { p_session_id: sessionId });

/** The account's Mafia room-maker: one game row, made on first use, never listed. */
export const mafiaGame = (language: string) => rpc<string>("game_mafia_game", { p_language: language });
export const mafiaDeal = (sessionId: string, setup: MafiaSetup) =>
  rpc<MafiaView>("game_mafia_deal", { p_session_id: sessionId, p_roles: setup });
export const mafiaPhase = (sessionId: string, phase: "night" | "day") =>
  rpc<MafiaView>("game_mafia_phase", { p_session_id: sessionId, p_phase: phase });
export const mafiaMark = (sessionId: string, playerId: string, alive: boolean, reason?: "night" | "vote" | "host") =>
  rpc<MafiaView>("game_mafia_mark", { p_session_id: sessionId, p_player_id: playerId, p_alive: alive, p_reason: reason ?? null });
export const mafiaEnd = (sessionId: string, winner: MafiaWinner | null) =>
  rpc<MafiaView>("game_mafia_end", { p_session_id: sessionId, p_winner: winner });
export const mafiaClose = (sessionId: string) => rpc<MafiaView>("game_mafia_close", { p_session_id: sessionId });
export const mafiaSeen = (sessionId: string) => rpc<null>("game_mafia_seen", { p_session_id: sessionId });

/**
 * The match this account is still in — as a player or as its host — so a
 * phone that was closed in the middle of one finds its way back. Newest first;
 * null when there is none.
 */
export async function liveMatch(userId: string): Promise<{ sessionId: string; host: boolean; title: string; kind: string } | null> {
  const live: GameSessionStatus[] = ["lobby", "countdown", "question", "question_result", "leaderboard"];
  const now = new Date().toISOString();
  const [hosted, played] = await Promise.all([
    supabase.from("game_sessions").select("id, created_at, games(title, kind)")
      .eq("host_user_id", userId).in("status", live).gt("expires_at", now).not("game_id", "is", null)
      .order("created_at", { ascending: false }).limit(1),
    supabase.from("game_players").select("session_id, joined_at, game_sessions!inner(status, expires_at, host_user_id, games(title, kind))")
      .eq("user_id", userId).neq("status", "kicked").in("game_sessions.status", live).gt("game_sessions.expires_at", now)
      .order("joined_at", { ascending: false }).limit(1),
  ]);
  type GameBit = { title: string; kind: string } | null;
  const host = (hosted.data ?? [])[0] as unknown as { id: string; created_at: string; games: GameBit } | undefined;
  const player = (played.data ?? [])[0] as unknown as
    { session_id: string; joined_at: string; game_sessions: { host_user_id: string | null; games: GameBit } } | undefined;
  const asPlayer = player && player.game_sessions.host_user_id !== userId ? player : undefined;
  if (asPlayer && (!host || asPlayer.joined_at > host.created_at)) {
    return { sessionId: asPlayer.session_id, host: false, title: asPlayer.game_sessions.games?.title ?? "", kind: asPlayer.game_sessions.games?.kind ?? "quiz" };
  }
  if (host) return { sessionId: host.id, host: true, title: host.games?.title ?? "", kind: host.games?.kind ?? "quiz" };
  return null;
}

/** The teams' colours, the same on the board and on the host's phone. */
export const TEAM_COLORS = ["#8B54E8", "#17B283", "#E8A13A"] as const;

export const claimPairing = (token: string, gameId?: string) =>
  rpc<{ session_id: string; game_id: string | null; join_token: string; join_code: string; realtime_token: string }>(
    "game_pairing_claim", { p_token: token, p_game_id: gameId ?? null });

export const hostState = (sessionId: string) =>
  rpc<HostState>("game_host_state", { p_session_id: sessionId });

export const configureSession = (sessionId: string, config: {
  gameId?: string; teamMode?: boolean; teams?: string[];
  showOnPhones?: boolean; soundEnabled?: boolean; rewardPlan?: GameRewardPlan; allowLateJoin?: boolean;
}) =>
  rpc<HostState>("game_session_configure", {
    p_session_id: sessionId,
    p_game_id: config.gameId ?? null,
    p_team_mode: config.teamMode ?? null,
    p_teams: config.teams ?? null,
    p_show_on_phones: config.showOnPhones ?? null,
    p_sound_enabled: config.soundEnabled ?? null,
    p_reward_plan: config.rewardPlan ?? null,
    // Sent only when set, so a server without the switch is still spoken to.
    ...(config.allowLateJoin === undefined ? {} : { p_allow_late_join: config.allowLateJoin }),
  });

export const advanceSession = (sessionId: string, action: "next" | "finish" | "cancel" = "next") =>
  rpc<{ status: GameSessionStatus; current_index?: number; phase_deadline?: string | null; state_version?: number }>(
    "game_session_advance", { p_session_id: sessionId, p_action: action });

/** What a player is about to join: the teams it offers and whether it still takes newcomers. */
export type JoinPreview = { status: GameSessionStatus; team_mode: boolean; teams: string[]; allow_late_join: boolean; joinable: boolean };

export const previewJoin = (target: { token?: string | null; code?: string | null }) =>
  rpc<JoinPreview>("game_join_preview", target.token ? { p_join_token: target.token } : { p_code: target.code ?? "" });

// The team is sent only when one was chosen, so a server that predates teams
// a player picks is still joined the way it expects.
export const joinGame = (joinToken: string, nickname: string, avatarId: number, team?: string | null) =>
  rpc<{ session_id: string; player_id: string; status: GameSessionStatus }>(
    "game_join", { p_join_token: joinToken, p_nickname: nickname, p_avatar_id: avatarId, ...(team ? { p_team: team } : {}) });

export const joinGameByCode = (code: string, nickname: string, avatarId: number, team?: string | null) =>
  rpc<{ session_id: string; player_id: string; status: GameSessionStatus }>(
    "game_join_by_code", { p_code: code, p_nickname: nickname, p_avatar_id: avatarId, ...(team ? { p_team: team } : {}) });

export const submitAnswer = (sessionId: string, questionIndex: number, payload: Record<string, unknown>) =>
  rpc<{ accepted: boolean; locked: boolean; solved_ids?: string[]; score?: number }>(
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
  /** uz, en or ru. Left out for a quiz about a deck: the server takes the deck's. */
  language?: string;
  /** "crossword" makes a crossword, "grid" a team grid game, from the same sources. */
  kind?: "quiz" | "crossword" | "grid";
  /** Crossword only: how many words the grid holds. */
  wordCount?: number;
  /** Crossword only: minutes a match gives to solve it. */
  minutes?: number;
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
  return changesChannel(`game-session-${sessionId}`)
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
    // The Mafia room-maker is not a game anyone made (see mafiaGame).
    .neq("kind", "mafia")
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
      game_title: ((row.game_sessions as unknown as { games: { title: string } | null }).games?.title) ?? i18n.t("games:fallbackTitle"),
    }));
};

/** The games this account may put in front of a room, for the host's picker. */
export const listHostable = () =>
  rpc<{ id: string; title: string; question_count: number; category_label: string | null; difficulty: string; source: string }[]>(
    "game_hostable_list", {});

/** Where a game stands with the store: auto-publish's state and the listing, if any. */
export type StorePublish = {
  title: string;
  state: "off" | "pending" | "published" | "stopped";
  publishAt: string | null;
  product: { id: string; status: string; base_price: number } | null;
};

export async function loadStorePublish(gameId: string): Promise<StorePublish> {
  const [game, product] = await Promise.all([
    supabase.from("games").select("title, store_autopublish, store_autopublish_at").eq("id", gameId).single(),
    supabase.from("marketplace_products").select("id, status, base_price").eq("game_id", gameId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (game.error) throw game.error;
  return {
    title: game.data.title,
    state: game.data.store_autopublish as StorePublish["state"],
    publishAt: game.data.store_autopublish_at,
    product: product.data ?? null,
  };
}

export const stopStorePublish = (gameId: string) => rpc<{ state: string }>("game_store_autopublish_stop", { p_game_id: gameId });
export const priceStoreListing = (gameId: string, price: number) =>
  rpc<{ product_id: string; status: string }>("game_store_reprice", { p_game_id: gameId, p_price: price });

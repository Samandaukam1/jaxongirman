import type { GameRewardPlan } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check, ChevronRight, ExternalLink, Gift, Minus, Play, Plus, Square, SquareCheck, Users, Volume2, VolumeX, X,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { GameLeaderboardList } from "@/components/GameAnswerInput";
import { GameAvatar } from "@/components/GameAvatar";
import { GridHost } from "@/components/GridHost";
import { HostablePicker } from "@/components/HostablePicker";
import { MafiaHost } from "@/components/Mafia";
import { HostQuestionCard } from "@/components/HostQuestionCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { QrCode } from "@/components/QrCode";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  advanceSession, configureSession, gameJoinUrl, hostState, isNewerState, reviewAnswer, subscribeToSession,
  type HostState, type LeaderboardPayload, type MatchPhase, type ShownState,
} from "@/lib/games";
import { formatNumber } from "@/lib/money";
import { isTransport, withNetworkRetry } from "@/lib/retry";
import { supabase } from "@/lib/supabase";
import { useRoom } from "@/lib/useDesktop";
import { isOpenMatch, useMatchScreen } from "@/lib/useMatchScreen";
import { siteGameScreenUrl } from "@/lib/web";
import { useAccount } from "@/providers/AccountProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Player = { id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; correct_count: number; rank: number | null };
type OpenAnswer = { id: string; text: string; nickname: string; is_correct: boolean | null };

/** The reward plan's steps, in order; named in the `play` table under `host.reward`. */
const REWARD_STEPS: (keyof GameRewardPlan & ("first" | "second" | "third" | "participant"))[] = ["first", "second", "third", "participant"];

/**
 * The host's remote. It never renders a question — the room is looking at the
 * projector — it renders the one decision available at each step: start, next,
 * finish, and while an open answer is on screen, whose answer counted.
 *
 * The reward plan is set here, and the coins are held when the match starts.
 * A plan the wallet cannot cover refuses to start rather than failing at the
 * podium.
 *
 * In a browser on a computer the remote is also the big screen: the site's
 * arena for this match (`/oyingoh/ekran/<id>`, read as the host) fills the
 * window beside the controls, and opens in a window of its own for a
 * projector. Without a projector, the lobby's code card carries the join QR
 * itself — on a phone, the room scans the host's phone.
 */
/**
 * How long a finished question and a leaderboard stay on screen.
 *
 * Long enough to read the answer and find your own name, short enough that a
 * room of twenty starts talking. Named here because it is a pacing decision
 * rather than an implementation detail.
 */
const RESULT_SECONDS = 6;
/** A crossword's answers on the board: longer than one question's. */
const CROSSWORD_RESULT_SECONDS = 20;
const LEADERBOARD_SECONDS = 8;

/**
 * How often the remote reads the room while it is open.
 *
 * Realtime says when the session row changes, but a socket that dropped says
 * nothing (a phone left on a desk, a hand-over between towers), and a
 * crossword's race is not a row change at all. The lobby is read too: its
 * count is what "start" waits for, and it used to sit at nobody.
 */
const POLL_MS = 4000;

/** How long the clock waits before trying again a step of its own that failed. */
const AUTO_RETRY_MS = 5000;

/**
 * The board: the room's players, best first.
 *
 * The host is not a player, so game_player_state is not theirs to call; these
 * rows are, and RLS already lets the host read them in full. A failed read is
 * a failure, not an empty room: it used to wipe the lobby on screen.
 */
const readBoard = (sessionId: string) => withNetworkRetry(async () => {
  const { data, error } = await supabase
    .from("game_players")
    .select("id, nickname, avatar_id, team, total_score, correct_count, rank")
    .eq("session_id", sessionId)
    .order("total_score", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Player[];
});

function HostGameScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["play", "games", "common"]);
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { balance, refresh: refreshWallet } = useAccount();
  const [state, setState] = useState<HostState | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardPayload | null>(null);
  const [openAnswers, setOpenAnswers] = useState<OpenAnswer[]>([]);
  const [plan, setPlan] = useState<GameRewardPlan>({});
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A host who wants to talk over a question turns the clock off. The game is
  // theirs; running itself is the default, not the rule.
  const [autoPaused, setAutoPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why the last read of the room failed. Before the first read it is the
  // whole screen; after it, a strip over controls that keep working. It used
  // to be the whole screen either way, so one failed poll took the start,
  // next and cancel buttons away from a host with a room waiting.
  const [readError, setReadError] = useState<{ offline: boolean; message: string } | null>(null);
  // When the clock may try a step of its own again after one failed: until
  // then it waits, instead of asking the server again in a tight loop.
  const [autoRetryAt, setAutoRetryAt] = useState(0);
  const shown = useRef<ShownState>(null);
  // The arena beside the controls needs the site beside the app and a window
  // wide enough for both; anywhere else it is a window of its own, if any.
  const room = useRoom();
  const screenUrl = sessionId ? siteGameScreenUrl(sessionId) : null;
  const beside = room === "desktop" && screenUrl !== null;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [next, list] = await Promise.all([hostState(sessionId), readBoard(sessionId)]);
      setReadError(null);
      // Reads overlap; one older than the screen is dropped (see isNewerState).
      if (!isNewerState(shown.current, sessionId, next.state_version)) return;
      shown.current = { sessionId, version: next.state_version };
      setState(next);
      setPlan((current) => Object.keys(current).length === 0 ? next.reward_plan ?? {} : current);
      setPlayers(list);
      setLeaderboard({
        players: list.map((player, index) => ({
          ...player,
          correct_count: player.correct_count ?? 0,
          rank: player.rank ?? index + 1,
        })),
        teams: [],
      });
    } catch (failure) {
      setReadError({ offline: isTransport(failure), message: asErrorMessage(failure) });
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = subscribeToSession(sessionId, () => { void refresh(); });
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, sessionId]);

  // Awake while the room is open, read again on return to the app, and a
  // started match is not left by one stray edge swipe: this phone is the
  // room's clock (see below), and leaving it leaves the room waiting.
  useMatchScreen({
    status: state?.status ?? null,
    onResume: refresh,
    leave: { title: t("leave.title"), body: t("leave.host"), stay: t("leave.stay"), go: t("leave.go") },
  });

  const open = isOpenMatch(state?.status);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  /**
   * One step of the match, sent with the phase it was meant for (`from`).
   * `automatic` marks the clock's own steps, which wait a little after a
   * failure before the clock tries again.
   */
  const advance = useCallback(async (action: "next" | "finish" | "cancel", from: MatchPhase, automatic = false) => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Null when the match had already left `from`: nothing to move, only
      // the room to read again (see advanceSession).
      await advanceSession(sessionId, action, from);
      await refresh();
      if (action === "finish" || action === "cancel") await refreshWallet();
    } catch (failure) {
      setError(asErrorMessage(failure));
      if (automatic) setAutoRetryAt(Date.now() + AUTO_RETRY_MS);
      // A refusal usually means this screen was behind the room.
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, refreshWallet, sessionId]);

  /**
   * The game runs itself.
   *
   * Every phase used to wait for a tap, so the person running the room watched
   * a phone instead of the players — and with one player answering instantly,
   * everybody sat looking at a finished question until somebody noticed.
   *
   * Three rules, and all of them are things a host would have done anyway:
   * close a question when its time is up or when everyone has answered, and
   * move on from a result after long enough to read it. The lobby is left
   * alone — starting is a decision, not a timeout — and so are open answers,
   * which need a human verdict before anyone's score is right.
   *
   * The timer follows the phase, not each read of it: the room is read every
   * few seconds, and a result's six seconds started again on every read would
   * never run out. Each step carries the phase it was meant for, so a late tap
   * and this timer firing together, or a burst of timers on a phone that woke
   * up, move the match once and do not skip a question.
   */
  const status = state?.status ?? null;
  const index = state?.current_index ?? 0;
  const deadline = state?.phase_deadline ?? null;
  const playerCount = state?.player_count ?? 0;
  const everyoneAnswered = status === "question" && playerCount > 0 && (state?.answered_count ?? 0) >= playerCount;
  // A solved crossword stays up long enough for the room to read its answers.
  const resultSeconds = state?.current_question?.type === "crossword" ? CROSSWORD_RESULT_SECONDS : RESULT_SECONDS;
  // An open answer is scored by the host, so a result holding one waits.
  const waitingOnVerdict = status === "question_result" && openAnswers.length > 0;

  useEffect(() => {
    if (!status || busy || autoPaused) return;

    let delay: number | null = null;
    if (status === "question") {
      if (everyoneAnswered) {
        // A beat, so the last player sees their own answer land.
        delay = 900;
      } else if (deadline) {
        delay = Math.max(0, new Date(deadline).getTime() - Date.now());
      }
    } else if (status === "question_result" && !waitingOnVerdict) {
      delay = resultSeconds * 1000;
    } else if (status === "leaderboard") {
      delay = LEADERBOARD_SECONDS * 1000;
    }

    if (delay === null) return;
    const from: MatchPhase = { status, current_index: index };
    const wait = Math.max(delay, autoRetryAt - Date.now());
    const timer = setTimeout(() => { void advance("next", from, true); }, wait);
    return () => clearTimeout(timer);
  }, [advance, autoPaused, autoRetryAt, busy, deadline, everyoneAnswered, index, resultSeconds, status, waitingOnVerdict]);

  // Open answers need a human verdict, so they are loaded whenever a result is
  // on screen.
  useEffect(() => {
    if (!sessionId || state?.status !== "question_result") { setOpenAnswers([]); return; }
    void (async () => {
      const { data } = await supabase
        .from("game_answers")
        .select("id, payload, is_correct, game_questions!inner(type), game_players!inner(nickname)")
        .eq("session_id", sessionId)
        .eq("question_index", state.current_index);
      setOpenAnswers((data ?? [])
        .filter((row) => (row.game_questions as unknown as { type: string }).type === "open_answer")
        .map((row) => ({
          id: row.id,
          text: String((row.payload as { text?: string })?.text ?? ""),
          nickname: (row.game_players as unknown as { nickname: string }).nickname,
          is_correct: row.is_correct,
        })));
    })();
  }, [sessionId, state?.current_index, state?.status]);

  async function chooseGame(gameId: string) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await configureSession(sessionId, { gameId });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveRewards(next: GameRewardPlan) {
    if (!sessionId) return;
    setPlan(next);
    try {
      setError(null);
      await configureSession(sessionId, { rewardPlan: next });
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  /** One of the two lobby switches the projector and the phones both read. */
  async function toggleSetting(key: "showOnPhones" | "soundEnabled" | "allowLateJoin", value: boolean) {
    if (!sessionId) return;
    try {
      setError(null);
      await configureSession(sessionId, { [key]: value });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  async function toggleTeamMode() {
    if (!sessionId || !state) return;
    try {
      setError(null);
      const next = !state.team_mode;
      await configureSession(sessionId, {
        teamMode: next,
        // Two numbered teams to start with; the host picks how many and names them.
        teams: next ? [1, 2].map((number) => t("host.teamName", { number })) : [],
      });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }


  /** One to three teams: the names already chosen are kept, new ones are numbered. */
  async function setTeams(names: string[]) {
    if (!sessionId) return;
    try {
      setError(null);
      await configureSession(sessionId, { teams: names });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  function teamCount(count: number) {
    if (!state) return;
    const names = Array.from({ length: count }, (_, index) => state.teams[index] ?? t("host.teamName", { number: index + 1 }));
    void Haptics.selectionAsync();
    void setTeams(names);
  }

  function renameTeam(index: number, name: string) {
    if (!state) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === state.teams[index]) return;
    void setTeams(state.teams.map((current, at) => (at === index ? trimmed : current)));
  }

  function confirmCancel() {
    if (!state) return;
    const from: MatchPhase = { status: state.status, current_index: state.current_index };
    Alert.alert(t("host.cancelTitle"), t("host.cancelBody"), [
      { text: t("common:no"), style: "cancel" },
      { text: t("common:cancel"), style: "destructive", onPress: () => void advance("cancel", from) },
    ]);
  }

  /** The host's verdict on one open answer; a refused one says so instead of vanishing. */
  async function review(answerId: string, correct: boolean) {
    try {
      setError(null);
      await reviewAnswer(answerId, correct);
      setOpenAnswers((current) => current.map((row) => row.id === answerId ? { ...row, is_correct: correct } : row));
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  // How many questions a grid game has: its cells are dealt from them.
  const [gridQuestions, setGridQuestions] = useState(0);
  const gridGameId = state?.game_kind === "grid" ? state.game_id : null;
  useEffect(() => {
    if (!gridGameId) return;
    void supabase.from("games").select("question_count").eq("id", gridGameId).maybeSingle()
      .then(({ data }) => setGridQuestions(data?.question_count ?? 0));
  }, [gridGameId]);

  if (readError && !state) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("games:title")} onLeave={() => router.back()} />
        <ErrorState message={readError.message} onRetry={() => void refresh()} />
      </View>
    );
  }
  if (!state) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // The phase on screen, which every button's step is sent with.
  const phase: MatchPhase = { status: state.status, current_index: state.current_index };
  // A dropped connection says it is reconnecting; a refusal says what the
  // server said. Either way the controls stay where they are.
  const readTrouble = readError ? (readError.offline ? t("player.offline") : readError.message) : null;

  const liability =
    (plan.participant ?? 0) * players.length
    + (players.length >= 1 ? plan.first ?? 0 : 0)
    + (players.length >= 2 ? plan.second ?? 0 : 0)
    + (players.length >= 3 ? plan.third ?? 0 : 0);
  const affordable = state.reward_state === "reserved" || liability <= balance;

  const advanceLabel = (() => {
    switch (state.status) {
      case "lobby": return t("host.advance.lobby");
      case "countdown": return t("host.advance.countdown");
      case "question": return t("host.advance.question");
      case "question_result": return t("host.advance.question_result");
      case "leaderboard": return t("host.advance.leaderboard");
      default: return t("host.advance.other");
    }
  })();

  // A team grid game has its own controls: teams, cells, verdicts.
  const controls = state.game_kind === "grid" && state.game_id && sessionId ? (
    <GridHost sessionId={sessionId} state={state} questionCount={gridQuestions} onChanged={refresh} onCancel={confirmCancel} />
  ) : state.game_kind === "mafia" && state.game_id && sessionId ? (
    // Mafia: the narrator's own controls — the room, the deck, the table.
    <MafiaHost sessionId={sessionId} state={state} showQr={!beside} onChanged={refresh} onCancel={confirmCancel} />
  ) : (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {state.status === "lobby" && !state.game_id ? (
        // A host who scanned a projector has not chosen a game yet: that
        // choice is the first thing this screen asks for, and nothing else
        // can happen until it is made.
        <HostablePicker busy={busy} error={error} onPick={(gameId) => void chooseGame(gameId)} />
      ) : null}

      {state.status === "lobby" && state.game_id ? (
        <>
          <View style={styles.codeCard}>
            {/* Beside the arena the QR is already on the big screen; anywhere
                else this card is where the room finds it. */}
            {beside ? null : (
              <View style={styles.qrFrame}>
                <QrCode value={gameJoinUrl(state.join_token)} size={room === "phone" ? 200 : 240} />
              </View>
            )}
            <Text style={styles.codeLabel}>{t("host.code")}</Text>
            <Text style={styles.codeValue}>{state.join_code.replace(/(\d{3})(\d{3})/, "$1 $2")}</Text>
            <Text style={styles.codeHint}>{beside ? t("host.codeHint") : t("host.scanHint")}</Text>
          </View>

          <View style={styles.countRow}>
            <Users color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
            <Text style={styles.countText}>{t("host.players", { count: state.player_count })}</Text>
          </View>

          <Pressable style={styles.settingRow} onPress={() => void toggleTeamMode()}>
            {state.team_mode
              ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
              : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
            <Text style={styles.settingText}>{t("host.teamMode")}</Text>
          </Pressable>

          {state.team_mode ? (
            <View style={styles.teamCard}>
              <Text style={styles.hint}>{t("host.teamCount")}</Text>
              <View style={styles.teamCounts} accessibilityRole="radiogroup">
                {[1, 2, 3].map((count) => {
                  const chosen = state.teams.length === count;
                  return (
                    <Pressable
                      key={count}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chosen }}
                      onPress={() => teamCount(count)}
                      style={[styles.teamCount, chosen && styles.teamCountOn]}
                    >
                      <Text style={[styles.teamCountText, chosen && styles.teamCountTextOn]}>{count}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {state.teams.map((name, index) => (
                <TextInput
                  // Keyed by the saved name, so a rename from elsewhere refreshes the field.
                  key={`${index}-${name}`}
                  defaultValue={name}
                  maxLength={24}
                  onEndEditing={(event) => renameTeam(index, event.nativeEvent.text)}
                  onSubmitEditing={(event) => renameTeam(index, event.nativeEvent.text)}
                  placeholder={t("host.teamName", { number: index + 1 })}
                  placeholderTextColor={colors.inkSoft}
                  style={styles.teamInput}
                  returnKeyType="done"
                />
              ))}
            </View>
          ) : null}

          <Pressable style={styles.settingRow} onPress={() => void toggleSetting("showOnPhones", !state.show_on_phones)}>
            {state.show_on_phones
              ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
              : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
            <Text style={styles.settingText}>{t("host.onPhones")}</Text>
          </Pressable>

          <Pressable style={styles.settingRow} onPress={() => void toggleSetting("allowLateJoin", !state.allow_late_join)}>
            {state.allow_late_join
              ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
              : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.settingText}>{t("host.lateJoin")}</Text>
              <Text style={styles.hint}>{t("host.lateJoinHint")}</Text>
            </View>
          </Pressable>

          <Pressable style={styles.settingRow} onPress={() => void toggleSetting("soundEnabled", !state.sound_enabled)}>
            {state.sound_enabled
              ? <Volume2 color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
              : <VolumeX color={colors.inkSoft} size={icon.lg} strokeWidth={icon.stroke} />}
            <Text style={styles.settingText}>{t("host.sound")}</Text>
          </Pressable>

          <Pressable style={styles.settingRow} onPress={() => setRewardsOpen((value) => !value)}>
            <Gift color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
            <Text style={styles.settingText}>{t("host.rewards")}</Text>
            <Text style={styles.settingValue}>{liability > 0 ? `${formatNumber(liability)} J` : t("host.none")}</Text>
            <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>

          {rewardsOpen ? (
            <View style={styles.rewardCard}>
              {REWARD_STEPS.map((key) => (
                <View key={key} style={styles.rewardRow}>
                  <Text style={styles.rewardLabel}>{t(`host.reward.${key}`)}</Text>
                  <Pressable
                    style={styles.stepButton}
                    onPress={() => void saveRewards({ ...plan, [key]: Math.max((plan[key] ?? 0) - 1, 0) })}
                  >
                    <Minus color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
                  </Pressable>
                  <Text style={styles.rewardValue}>{plan[key] ?? 0} J</Text>
                  <Pressable
                    style={styles.stepButton}
                    onPress={() => void saveRewards({ ...plan, [key]: Math.min((plan[key] ?? 0) + 1, 1000) })}
                  >
                    <Plus color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
                  </Pressable>
                </View>
              ))}
              <Text style={[styles.rewardTotal, !affordable && styles.rewardShort]}>
                {liability > 0
                  ? t("host.reserve", { amount: formatNumber(liability), balance: formatNumber(balance) })
                  : t("host.noReward")}
              </Text>
              {!affordable ? (
                <Text style={styles.rewardShort}>{t("host.short")}</Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>{t("host.participants")}</Text>
          {players.length === 0 ? (
            <Text style={styles.hint}>{t("host.nobody")}</Text>
          ) : (
            <View style={styles.playerWrap}>
              {players.map((player) => (
                <View key={player.id} style={styles.playerChip}>
                  <GameAvatar id={player.avatar_id} size={34} />
                  <Text style={styles.playerName} numberOfLines={1}>{player.nickname}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : null}

      {state.status !== "lobby" && state.status !== "finished" && state.status !== "cancelled" ? (
        <View style={styles.liveCard}>
          <Text style={styles.liveStatus}>
            {state.status === "countdown" ? t("host.live.countdown")
              : state.status === "question" ? t("host.live.question")
              : state.status === "question_result" ? t("host.live.question_result")
              : t("host.live.leaderboard")}
          </Text>
          <Text style={styles.hint}>{t("host.players", { count: state.player_count })}</Text>
          {state.reward_reserved > 0 ? (
            <Text style={styles.hint}>{t("host.reserved", { amount: formatNumber(state.reward_reserved) })}</Text>
          ) : null}
        </View>
      ) : null}

      {state.current_question ? <HostQuestionCard question={state.current_question} number={state.current_index + 1} /> : null}

      {openAnswers.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>{t("host.review")}</Text>
          {openAnswers.map((answer) => (
            <View key={answer.id} style={styles.reviewRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reviewName}>{answer.nickname}</Text>
                <Text style={styles.reviewText}>{answer.text}</Text>
              </View>
              <Pressable
                style={[styles.reviewButton, answer.is_correct === true && styles.reviewGood]}
                onPress={() => void review(answer.id, true)}
                accessibilityLabel={t("correct")}
              >
                <Check color={answer.is_correct === true ? colors.onPrimary : colors.success} size={icon.md} strokeWidth={icon.strokeBold} />
              </Pressable>
              <Pressable
                style={[styles.reviewButton, answer.is_correct === false && styles.reviewBad]}
                onPress={() => void review(answer.id, false)}
                accessibilityLabel={t("wrong")}
              >
                <X color={answer.is_correct === false ? colors.onPrimary : colors.danger} size={icon.md} strokeWidth={icon.strokeBold} />
              </Pressable>
            </View>
          ))}
        </>
      ) : null}

      {state.status === "finished" && leaderboard ? (
        <>
          <Text style={styles.sectionTitle}>{t("host.final")}</Text>
          <GameLeaderboardList players={leaderboard.players} />
          <PrimaryButton label={t("host.resultsPage")} onPress={() => router.replace(`/oyingoh/results/${sessionId}`)} />
          <PrimaryButton label={t("back")} tone="secondary" onPress={() => router.replace("/(app)/(tabs)/games")} />
        </>
      ) : null}

      {error ? <InlineError message={error} /> : null}

      {state.status !== "finished" && state.status !== "cancelled" && state.status !== "expired"
        && !(state.status === "lobby" && !state.game_id) ? (
        <>
          <PrimaryButton
            label={advanceLabel}
            icon={state.status === "lobby" ? Play : undefined}
            loading={busy}
            disabled={busy || (state.status === "lobby" && (state.player_count < 1 || !affordable))}
            onPress={() => void advance("next", phase)}
          />
          {state.status !== "lobby" ? (
            <>
              {/* The game paces itself; this is how a host takes it back to
                  talk over a question without the clock moving on. */}
              <PrimaryButton
                label={autoPaused ? t("host.autoOn") : t("host.autoOff")}
                tone="ghost"
                disabled={busy}
                onPress={() => setAutoPaused((value) => !value)}
              />
              <PrimaryButton label={t("host.finish")} tone="secondary" disabled={busy} onPress={() => void advance("finish", phase)} />
            </>
          ) : null}
          <PrimaryButton label={t("common:cancel")} tone="ghost" disabled={busy} onPress={confirmCancel} />
        </>
      ) : null}

      {screenUrl ? (
        <PrimaryButton
          label={t("host.openScreen")}
          icon={ExternalLink}
          tone="ghost"
          onPress={() => { window.open(screenUrl, "_blank", "noopener"); }}
        />
      ) : null}
    </ScrollView>
  );

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title={t("host.title")}
        subtitle={state.game_kind === "grid" ? t("games:grid.title")
          : state.game_kind === "mafia" ? t("games:mafia.title")
          : state.status === "lobby" ? t("host.lobby") : t("host.question", { number: state.current_index + 1 })}
        onLeave={() => router.back()}
      />
      {readTrouble ? <View style={styles.offline}><Text style={styles.offlineText}>{readTrouble}</Text></View> : null}
      {beside && screenUrl ? (
        <View style={styles.split}>
          <View style={styles.stage}>
            <iframe
              src={screenUrl}
              title={t("host.screenTitle")}
              allow="fullscreen"
              style={{ border: 0, width: "100%", height: "100%", display: "block" }}
            />
          </View>
          <View style={styles.side}>{controls}</View>
        </View>
      ) : controls}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  // The same strip as on a player's phone.
  offline: { backgroundColor: colors.warning, paddingVertical: 6, paddingHorizontal: spacing.lg },
  offlineText: { ...typography.caption, color: colors.onPrimary, textAlign: "center" },
  codeCard: { alignItems: "center", gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.xl },
  codeLabel: { ...typography.caption, color: colors.primaryDeep },
  codeValue: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 40, color: colors.primaryDeep, letterSpacing: 4 },
  codeHint: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  countText: { ...typography.heading, color: colors.ink },
  settingRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  settingText: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  settingValue: { ...typography.body, color: colors.inkMuted },
  rewardCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rewardLabel: { ...typography.body, color: colors.ink, flex: 1 },
  rewardValue: { ...typography.bodyMedium, color: colors.primaryDeep, minWidth: 52, textAlign: "center" },
  stepButton: {
    width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center",
  },
  rewardTotal: { ...typography.caption, color: colors.inkMuted },
  rewardShort: { ...typography.caption, color: colors.danger },
  sectionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted },
  qrFrame: { padding: spacing.sm, backgroundColor: "#FFFFFF", borderRadius: radius.lg, marginBottom: spacing.sm },
  // The arena's own colours behind it, so the frame never flashes white
  // while the screen loads.
  split: { flex: 1, flexDirection: "row" },
  stage: { flex: 1, backgroundColor: "#150E24", overflow: "hidden" },
  side: { width: 400, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: colors.canvas },
  playerWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  playerChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.pill,
    paddingRight: spacing.md, paddingLeft: 4, paddingVertical: 4, maxWidth: "48%",
  },
  playerName: { ...typography.caption, color: colors.ink, flexShrink: 1 },
  teamCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  teamCounts: { flexDirection: "row", gap: spacing.sm },
  teamCount: { width: 52, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  teamCountOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  teamCountText: { ...typography.bodyMedium, color: colors.ink },
  teamCountTextOn: { color: colors.onPrimary },
  teamInput: { ...typography.body, color: colors.ink, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  liveCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, gap: 4 },
  liveStatus: { ...typography.heading, color: colors.ink },
  reviewRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  reviewName: { ...typography.caption, color: colors.accent },
  reviewText: { ...typography.body, color: colors.ink },
  reviewButton: {
    width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
  reviewGood: { backgroundColor: colors.success },
  reviewBad: { backgroundColor: colors.danger },
}));

export default HostGameScreen;

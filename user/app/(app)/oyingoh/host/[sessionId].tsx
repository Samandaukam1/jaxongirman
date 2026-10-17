import type { GameRewardPlan } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check, ChevronRight, Gift, Minus, Play, Plus, Square, SquareCheck, Users, Volume2, VolumeX, X,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";

import { GameLeaderboardList } from "@/components/GameAnswerInput";
import { GameAvatar } from "@/components/GameAvatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { lockedOnWeb } from "@/components/WebLocked";
import { asErrorMessage } from "@/lib/format";
import {
  advanceSession, configureSession, hostState, listHostable, reviewAnswer, subscribeToSession,
  type HostState, type LeaderboardPayload,
} from "@/lib/games";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Player = { id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; correct_count: number; rank: number | null };
type OpenAnswer = { id: string; text: string; nickname: string; is_correct: boolean | null };
type Hostable = { id: string; title: string; question_count: number; category_label: string | null; difficulty: string; source: string };

/** Where a hostable game came from; named in the `play` table under `host.source`. */
const SOURCES = ["mine", "presentation", "purchased", "free"] as const;
const isSource = (value: string): value is (typeof SOURCES)[number] => (SOURCES as readonly string[]).includes(value);

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
 */
/**
 * How long a finished question and a leaderboard stay on screen.
 *
 * Long enough to read the answer and find your own name, short enough that a
 * room of twenty starts talking. Named here because it is a pacing decision
 * rather than an implementation detail.
 */
const RESULT_SECONDS = 6;
const LEADERBOARD_SECONDS = 8;

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
  /** Loaded only when the screen was claimed without a game already chosen. */
  const [hostable, setHostable] = useState<Hostable[] | null>(null);
  const [busy, setBusy] = useState(false);
  // A host who wants to talk over a question turns the clock off. The game is
  // theirs; running itself is the default, not the rule.
  const [autoPaused, setAutoPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await hostState(sessionId);
      setState(next);
      setPlan((current) => Object.keys(current).length === 0 ? next.reward_plan ?? {} : current);

      // The host is not a player, so game_player_state is not theirs to call:
      // the board is these rows, which RLS already lets the host read in full.
      const { data: rows } = await supabase
        .from("game_players")
        .select("id, nickname, avatar_id, team, total_score, correct_count, rank")
        .eq("session_id", sessionId)
        .order("total_score", { ascending: false });
      const list = (rows as Player[]) ?? [];
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
      setFatal(asErrorMessage(failure));
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // A host who scanned a projector has not chosen a game yet: that choice is
  // the first thing this screen asks for, and nothing else can happen until it
  // is made.
  useEffect(() => {
    if (!state || state.game_id || hostable) return;
    void listHostable().then(setHostable).catch((failure) => setError(asErrorMessage(failure)));
  }, [hostable, state]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = subscribeToSession(sessionId, () => { void refresh(); });
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, sessionId]);

  const advance = useCallback(async (action: "next" | "finish" | "cancel") => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await advanceSession(sessionId, action);
      await refresh();
      if (action === "finish" || action === "cancel") await refreshWallet();
    } catch (failure) {
      setError(asErrorMessage(failure));
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
   * `advance` is idempotent through `state_version`: a late tap and this timer
   * firing together do not skip a question.
   */
  useEffect(() => {
    if (!state || busy || autoPaused) return;

    const everyoneAnswered = state.status === "question"
      && state.player_count > 0
      && (state.answered_count ?? 0) >= state.player_count;

    // An open answer is scored by the host, so a result holding one waits.
    const waitingOnVerdict = state.status === "question_result" && openAnswers.length > 0;

    let delay: number | null = null;
    if (state.status === "question") {
      if (everyoneAnswered) {
        // A beat, so the last player sees their own answer land.
        delay = 900;
      } else if (state.phase_deadline) {
        delay = Math.max(0, new Date(state.phase_deadline).getTime() - Date.now());
      }
    } else if (state.status === "question_result" && !waitingOnVerdict) {
      delay = RESULT_SECONDS * 1000;
    } else if (state.status === "leaderboard") {
      delay = LEADERBOARD_SECONDS * 1000;
    }

    if (delay === null) return;
    const timer = setTimeout(() => { void advance("next"); }, delay);
    return () => clearTimeout(timer);
  }, [advance, autoPaused, busy, openAnswers.length, state]);

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
  async function toggleSetting(key: "showOnPhones" | "soundEnabled", value: boolean) {
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
        teams: next ? [t("host.teams.blue"), t("host.teams.red")] : [],
      });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }


  function confirmCancel() {
    Alert.alert(t("host.cancelTitle"), t("host.cancelBody"), [
      { text: t("common:no"), style: "cancel" },
      { text: t("common:cancel"), style: "destructive", onPress: () => void advance("cancel") },
    ]);
  }

  if (fatal) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("games:title")} onLeave={() => router.back()} />
        <ErrorState message={fatal} onRetry={() => { setFatal(null); void refresh(); }} />
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

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title={t("host.title")}
        subtitle={state.status === "lobby" ? t("host.lobby") : t("host.question", { number: state.current_index + 1 })}
        onLeave={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {state.status === "lobby" && !state.game_id ? (
          <>
            <Text style={styles.pickerTitle}>{t("host.pick")}</Text>
            <Text style={styles.hint}>{t("host.pickHint")}</Text>
            {error ? <InlineError message={error} /> : null}
            {hostable === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
            ) : hostable.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.settingText}>{t("host.noGames")}</Text>
                <Text style={styles.hint}>{t("host.noGamesBody")}</Text>
                <PrimaryButton label={t("host.createGame")} onPress={() => router.replace("/(app)/oyingoh/create")} />
              </View>
            ) : (
              Object.entries(
                hostable.reduce<Record<string, Hostable[]>>((groups, game) => {
                  (groups[game.source] ??= []).push(game);
                  return groups;
                }, {}),
              ).map(([source, games]) => (
                <View key={source} style={{ gap: spacing.sm }}>
                  <Text style={styles.groupLabel}>{isSource(source) ? t(`host.source.${source}`) : source}</Text>
                  {games.map((game) => (
                    <Pressable
                      key={game.id}
                      style={({ pressed }) => [styles.pickRow, pressed && styles.pickRowPressed]}
                      disabled={busy}
                      onPress={() => void chooseGame(game.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.settingText} numberOfLines={1}>{game.title || t("games:untitled")}</Text>
                        <Text style={styles.hint}>
                          {t("games:questions", { count: game.question_count })}
                          {game.category_label ? ` · ${game.category_label}` : ""}
                        </Text>
                      </View>
                      <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
                    </Pressable>
                  ))}
                </View>
              ))
            )}
          </>
        ) : null}

        {state.status === "lobby" && state.game_id ? (
          <>
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>{t("host.code")}</Text>
              <Text style={styles.codeValue}>{state.join_code.replace(/(\d{3})(\d{3})/, "$1 $2")}</Text>
              <Text style={styles.codeHint}>{t("host.codeHint")}</Text>
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

            <Pressable style={styles.settingRow} onPress={() => void toggleSetting("showOnPhones", !state.show_on_phones)}>
              {state.show_on_phones
                ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
                : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
              <Text style={styles.settingText}>{t("host.onPhones")}</Text>
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
                  onPress={() => void (async () => {
                    await reviewAnswer(answer.id, true);
                    setOpenAnswers((current) => current.map((row) => row.id === answer.id ? { ...row, is_correct: true } : row));
                  })()}
                  accessibilityLabel={t("correct")}
                >
                  <Check color={answer.is_correct === true ? colors.onPrimary : colors.success} size={icon.md} strokeWidth={icon.strokeBold} />
                </Pressable>
                <Pressable
                  style={[styles.reviewButton, answer.is_correct === false && styles.reviewBad]}
                  onPress={() => void (async () => {
                    await reviewAnswer(answer.id, false);
                    setOpenAnswers((current) => current.map((row) => row.id === answer.id ? { ...row, is_correct: false } : row));
                  })()}
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
              onPress={() => void advance("next")}
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
                <PrimaryButton label={t("host.finish")} tone="secondary" disabled={busy} onPress={() => void advance("finish")} />
              </>
            ) : null}
            <PrimaryButton label={t("common:cancel")} tone="ghost" disabled={busy} onPress={confirmCancel} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  codeCard: { alignItems: "center", gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.xl },
  codeLabel: { ...typography.caption, color: colors.primaryDeep },
  codeValue: { fontFamily: "Manrope_700Bold", fontSize: 40, color: colors.primaryDeep, letterSpacing: 4 },
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
  pickerTitle: { ...typography.title, color: colors.ink, fontSize: 22 },
  groupLabel: { ...typography.caption, color: colors.accent, letterSpacing: 1.2, marginTop: spacing.sm },
  pickRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  pickRowPressed: { transform: [{ scale: 0.98 }], backgroundColor: colors.primarySoft },
  emptyPicker: { gap: spacing.md, paddingVertical: spacing.xl },
  hint: { ...typography.caption, color: colors.inkMuted },
  playerWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  playerChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.pill,
    paddingRight: spacing.md, paddingLeft: 4, paddingVertical: 4, maxWidth: "48%",
  },
  playerName: { ...typography.caption, color: colors.ink, flexShrink: 1 },
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

// Not in a browser yet: see WebLocked.
export default lockedOnWeb(HostGameScreen);

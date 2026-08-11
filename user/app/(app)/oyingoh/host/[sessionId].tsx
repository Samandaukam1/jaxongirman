import type { GameRewardPlan } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check, ChevronRight, Gift, Minus, Play, Plus, Square, SquareCheck, Users, Volume2, VolumeX, X,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";

import { GameLeaderboardList } from "@/components/GameAnswerInput";
import { GameAvatar } from "@/components/GameAvatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  advanceSession, configureSession, hostState, listHostable, reviewAnswer, subscribeToSession,
  type HostState, type LeaderboardPayload,
} from "@/lib/games";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

type Player = { id: string; nickname: string; avatar_id: number; team: string | null; total_score: number; correct_count: number; rank: number | null };
type OpenAnswer = { id: string; text: string; nickname: string; is_correct: boolean | null };
type Hostable = { id: string; title: string; question_count: number; category_label: string | null; difficulty: string; source: string };

const SOURCE_LABELS: Record<string, string> = {
  mine: "Yaratganlarim",
  presentation: "Prezentatsiyadan",
  purchased: "Sotib olganlarim",
  free: "Bepul o‘yinlar",
};

const REWARD_STEPS: { key: keyof GameRewardPlan; label: string }[] = [
  { key: "first", label: "1-o‘rin" },
  { key: "second", label: "2-o‘rin" },
  { key: "third", label: "3-o‘rin" },
  { key: "participant", label: "Har bir qatnashchi" },
];

/**
 * The host's remote. It never renders a question — the room is looking at the
 * projector — it renders the one decision available at each step: start, next,
 * finish, and while an open answer is on screen, whose answer counted.
 *
 * The reward plan is set here, and the coins are held when the match starts.
 * A plan the wallet cannot cover refuses to start rather than failing at the
 * podium.
 */
export default function HostGameScreen() {
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
        teams: next ? ["Ko‘k jamoa", "Qizil jamoa"] : [],
      });
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  async function advance(action: "next" | "finish" | "cancel") {
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
  }

  function confirmCancel() {
    Alert.alert("O‘yinni bekor qilish", "Mukofot jamg‘armasi balansingizga qaytariladi.", [
      { text: "Yo‘q", style: "cancel" },
      { text: "Bekor qilish", style: "destructive", onPress: () => void advance("cancel") },
    ]);
  }

  if (fatal) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title="O‘yingoh" onLeave={() => router.back()} />
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
      case "lobby": return "O‘yinni boshlash";
      case "countdown": return "Birinchi savol";
      case "question": return "Javoblarni yopish";
      case "question_result": return "Natijalar jadvali";
      case "leaderboard": return "Keyingi savol";
      default: return "Davom etish";
    }
  })();

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title="O‘yingoh boshqaruvi"
        subtitle={state.status === "lobby" ? "Lobbi" : `Savol ${state.current_index + 1}`}
        onLeave={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {state.status === "lobby" && !state.game_id ? (
          <>
            <Text style={styles.pickerTitle}>Qaysi o‘yinni o‘tkazasiz?</Text>
            <Text style={styles.hint}>Tanlangach katta ekranda qo‘shilish uchun QR kod chiqadi.</Text>
            {error ? <InlineError message={error} /> : null}
            {hostable === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
            ) : hostable.length === 0 ? (
              <View style={styles.emptyPicker}>
                <Text style={styles.settingText}>Tayyor o‘yin yo‘q</Text>
                <Text style={styles.hint}>Avval O‘yingoh bo‘limida o‘yin yaratib, uni tayyor holatga keltiring.</Text>
                <PrimaryButton label="O‘yin yaratish" onPress={() => router.replace("/(app)/oyingoh/create")} />
              </View>
            ) : (
              Object.entries(
                hostable.reduce<Record<string, Hostable[]>>((groups, game) => {
                  (groups[game.source] ??= []).push(game);
                  return groups;
                }, {}),
              ).map(([source, games]) => (
                <View key={source} style={{ gap: spacing.sm }}>
                  <Text style={styles.groupLabel}>{SOURCE_LABELS[source] ?? source}</Text>
                  {games.map((game) => (
                    <Pressable
                      key={game.id}
                      style={({ pressed }) => [styles.pickRow, pressed && styles.pickRowPressed]}
                      disabled={busy}
                      onPress={() => void chooseGame(game.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.settingText} numberOfLines={1}>{game.title || "Nomsiz o‘yin"}</Text>
                        <Text style={styles.hint}>
                          {game.question_count} savol
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
              <Text style={styles.codeLabel}>Qo‘shilish kodi</Text>
              <Text style={styles.codeValue}>{state.join_code.replace(/(\d{3})(\d{3})/, "$1 $2")}</Text>
              <Text style={styles.codeHint}>Katta ekrandagi QR kodni skaner qilish ham mumkin.</Text>
            </View>

            <View style={styles.countRow}>
              <Users color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
              <Text style={styles.countText}>{state.player_count} ishtirokchi</Text>
            </View>

            <Pressable style={styles.settingRow} onPress={() => void toggleTeamMode()}>
              {state.team_mode
                ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
                : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
              <Text style={styles.settingText}>Jamoaviy bellashuv</Text>
            </Pressable>

            <Pressable style={styles.settingRow} onPress={() => void toggleSetting("showOnPhones", !state.show_on_phones)}>
              {state.show_on_phones
                ? <SquareCheck color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
                : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
              <Text style={styles.settingText}>Savol telefonlarda ham ko‘rinadi</Text>
            </Pressable>

            <Pressable style={styles.settingRow} onPress={() => void toggleSetting("soundEnabled", !state.sound_enabled)}>
              {state.sound_enabled
                ? <Volume2 color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
                : <VolumeX color={colors.inkSoft} size={icon.lg} strokeWidth={icon.stroke} />}
              <Text style={styles.settingText}>Ovoz effektlari</Text>
            </Pressable>

            <Pressable style={styles.settingRow} onPress={() => setRewardsOpen((value) => !value)}>
              <Gift color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
              <Text style={styles.settingText}>Mukofotlar</Text>
              <Text style={styles.settingValue}>{liability > 0 ? `${formatNumber(liability)} J` : "yo‘q"}</Text>
              <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
            </Pressable>

            {rewardsOpen ? (
              <View style={styles.rewardCard}>
                {REWARD_STEPS.map(({ key, label }) => (
                  <View key={key} style={styles.rewardRow}>
                    <Text style={styles.rewardLabel}>{label}</Text>
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
                    ? `Band qilinadi: ${formatNumber(liability)} J · balans ${formatNumber(balance)} J`
                    : "Mukofot belgilanmagan"}
                </Text>
                {!affordable ? (
                  <Text style={styles.rewardShort}>Balans yetmaydi — rejani kamaytiring yoki balansni to‘ldiring.</Text>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Ishtirokchilar</Text>
            {players.length === 0 ? (
              <Text style={styles.hint}>Hali hech kim qo‘shilmadi.</Text>
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
              {state.status === "countdown" ? "Sanoq boshlandi"
                : state.status === "question" ? "Savol ekranda"
                : state.status === "question_result" ? "Natija ko‘rsatilmoqda"
                : "Jadval ko‘rsatilmoqda"}
            </Text>
            <Text style={styles.hint}>{state.player_count} ishtirokchi</Text>
            {state.reward_reserved > 0 ? (
              <Text style={styles.hint}>Band qilingan mukofot: {formatNumber(state.reward_reserved)} J</Text>
            ) : null}
          </View>
        ) : null}

        {openAnswers.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Erkin javoblarni baholang</Text>
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
                  accessibilityLabel="To‘g‘ri"
                >
                  <Check color={answer.is_correct === true ? colors.onPrimary : colors.success} size={icon.md} strokeWidth={icon.strokeBold} />
                </Pressable>
                <Pressable
                  style={[styles.reviewButton, answer.is_correct === false && styles.reviewBad]}
                  onPress={() => void (async () => {
                    await reviewAnswer(answer.id, false);
                    setOpenAnswers((current) => current.map((row) => row.id === answer.id ? { ...row, is_correct: false } : row));
                  })()}
                  accessibilityLabel="Noto‘g‘ri"
                >
                  <X color={answer.is_correct === false ? colors.onPrimary : colors.danger} size={icon.md} strokeWidth={icon.strokeBold} />
                </Pressable>
              </View>
            ))}
          </>
        ) : null}

        {state.status === "finished" && leaderboard ? (
          <>
            <Text style={styles.sectionTitle}>Yakuniy natijalar</Text>
            <GameLeaderboardList players={leaderboard.players} />
            <PrimaryButton label="Natijalar sahifasi" onPress={() => router.replace(`/oyingoh/results/${sessionId}`)} />
            <PrimaryButton label="O‘yingohga qaytish" tone="secondary" onPress={() => router.replace("/(app)/(tabs)/games")} />
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
              <PrimaryButton label="O‘yinni yakunlash" tone="secondary" disabled={busy} onPress={() => void advance("finish")} />
            ) : null}
            <PrimaryButton label="Bekor qilish" tone="ghost" disabled={busy} onPress={confirmCancel} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
});

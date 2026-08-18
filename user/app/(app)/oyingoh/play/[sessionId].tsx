import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Clock, Trophy, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from "react-native";

import { GameAnswerInput, GameLeaderboardList, GameRevealPanel, GameStatsSummary } from "@/components/GameAnswerInput";
import { GameAvatar } from "@/components/GameAvatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ErrorState } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { playerState, submitAnswer, subscribeToSession, type PlayerState } from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

/** A local clock only to draw the ring; the server owns the real deadline. */
function useCountdown(deadline: string | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const target = new Date(deadline).getTime();
    const tick = () => setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return remaining;
}

function publicUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return supabase.storage.from("game-assets").getPublicUrl(path).data.publicUrl;
}

/**
 * The player's screen for a whole match: lobby, countdown, question, reveal,
 * scoreboard, podium. One realtime subscription on the session row wakes it;
 * every wake refetches this player's own sanitised state, so a hundred phones
 * carry a hundred small payloads instead of one broadcast that leaks answers.
 */
export default function PlayGameScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const celebrated = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      const next = await playerState(sessionId);
      setState(next);
      setError(null);
      setConnected(true);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [sessionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = subscribeToSession(sessionId, () => { void refresh(); });
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, sessionId]);

  // A phase that ends on the server clock still needs one refetch here: the
  // question closing is a state change the row will announce, but a deadline
  // passing with nobody answering is not.
  useEffect(() => {
    if (!state?.phase_deadline) return;
    const wait = new Date(state.phase_deadline).getTime() - Date.now() + 800;
    if (wait <= 0) return;
    const timer = setTimeout(() => { void refresh(); }, wait);
    return () => clearTimeout(timer);
  }, [refresh, state?.phase_deadline]);

  // Reconnect polling: if the socket is gone, the screen still moves.
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  const remaining = useCountdown(state?.phase_deadline ?? null);

  // The verdict lands with the reveal, which is the moment to celebrate.
  useEffect(() => {
    if (state?.status !== "question_result" || !state.reveal?.my_answer) return;
    if (celebrated.current === state.current_index) return;
    celebrated.current = state.current_index;
    void Haptics.notificationAsync(state.reveal.my_answer.is_correct
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Warning);
  }, [state?.current_index, state?.reveal?.my_answer, state?.status]);

  async function answer(payload: Record<string, unknown>) {
    if (!sessionId || state?.current_index == null) return;
    setSubmitting(true);
    try {
      await submitAnswer(sessionId, state.current_index, payload);
      await refresh();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !state) {
    return (
      <View style={styles.safe}>
        <ErrorState message={error} onRetry={() => void refresh()} />
      </View>
    );
  }
  if (!state) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.waitText}>O‘yinga ulanmoqda...</Text>
      </View>
    );
  }

  const me = state.me;

  return (
    <View style={styles.safe}>
      {!connected ? <View style={styles.offline}><Text style={styles.offlineText}>Ulanish uzildi. Qayta ulanmoqda...</Text></View> : null}

      <View style={styles.header}>
        <GameAvatar id={me.avatar_id} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.myName} numberOfLines={1}>{me.nickname}</Text>
          {me.team ? <Text style={styles.myTeam}>{me.team}</Text> : null}
        </View>
        <View style={styles.scorePill}>
          <Text style={styles.scoreText}>{me.total_score.toLocaleString("uz-UZ")}</Text>
        </View>
      </View>

      {state.status === "lobby" ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.waitTitle}>Siz o‘yindasiz</Text>
          <Text style={styles.waitText}>Boshlovchi o‘yinni boshlashini kutamiz.</Text>
          <View style={styles.playerCount}>
            <Users color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
            <Text style={styles.waitText}>{state.player_count} ishtirokchi</Text>
          </View>
        </View>
      ) : null}

      {state.status === "countdown" ? (
        <View style={styles.center}>
          <Text
            style={remaining > 0 ? styles.countdownNumber : styles.countdownGo}
            // The word is one word and must stay one word. Shrinking beats
            // wrapping "BOSHL / ADIK!" across two lines, which is what a
            // ninety-six point face did on a phone.
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
          >
            {remaining > 0 ? remaining : "BOSHLADIK!"}
          </Text>
        </View>
      ) : null}

      {state.status === "question" && state.question ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.questionMeta}>
            <Text style={styles.questionIndex}>{state.current_index + 1} / {state.question_count}</Text>
            <View style={styles.timerPill}>
              <Clock color={remaining <= 5 ? colors.danger : colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
              <Text style={[styles.timerText, remaining <= 5 && styles.timerUrgent]}>{remaining}s</Text>
            </View>
          </View>

          {state.show_on_phones ? (
            <>
              <Text style={styles.prompt}>{state.question.prompt}</Text>
              {state.question.media_path && state.question.type !== "hotspot" ? (
                <Image source={{ uri: publicUrl(state.question.media_path) }} style={styles.media} resizeMode="cover" />
              ) : null}
            </>
          ) : (
            <Text style={styles.prompt}>Katta ekranga qarang</Text>
          )}

          {state.answered ? (
            <View style={styles.lockedBanner}>
              <Check color={colors.success} size={icon.lg} strokeWidth={icon.strokeBold} />
              <Text style={styles.lockedText}>Javobingiz qabul qilindi</Text>
            </View>
          ) : (
            <GameAnswerInput
              question={state.question}
              locked={Boolean(state.answered) || submitting}
              onSubmit={(payload) => void answer(payload)}
            />
          )}
        </ScrollView>
      ) : null}

      {state.status === "question_result" && state.question && state.reveal ? (
        <ScrollView contentContainerStyle={styles.content}>
          {state.reveal.my_answer ? (
            <View style={[styles.verdict, state.reveal.my_answer.is_correct === true ? styles.verdictGood
              : state.reveal.my_answer.is_correct === false ? styles.verdictBad : styles.verdictNeutral]}>
              {state.reveal.my_answer.is_correct === true ? (
                <>
                  <Check color={colors.onPrimary} size={34} strokeWidth={icon.strokeBold} />
                  <Text style={styles.verdictTitle}>To‘g‘ri!</Text>
                  <Text style={styles.verdictScore}>+{state.reveal.my_answer.score_awarded.toLocaleString("uz-UZ")}</Text>
                </>
              ) : state.reveal.my_answer.is_correct === false ? (
                <>
                  <X color={colors.onPrimary} size={34} strokeWidth={icon.strokeBold} />
                  <Text style={styles.verdictTitle}>Noto‘g‘ri</Text>
                </>
              ) : (
                <Text style={styles.verdictTitle}>Javobingiz qabul qilindi</Text>
              )}
            </View>
          ) : (
            <View style={[styles.verdict, styles.verdictNeutral]}>
              <Text style={styles.verdictTitle}>Javob bermadingiz</Text>
            </View>
          )}

          <Text style={styles.prompt}>{state.question.prompt}</Text>
          <GameRevealPanel
            question={state.question}
            config={(state.reveal.config ?? {}) as Record<string, unknown>}
            stats={state.reveal.stats}
          />
          {state.question.type !== "poll" && state.question.type !== "word_cloud" ? (
            <GameStatsSummary stats={state.reveal.stats} />
          ) : null}
          {state.reveal.explanation ? (
            <View style={styles.explanationCard}>
              <Text style={styles.explanationText}>{state.reveal.explanation}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {state.status === "leaderboard" && state.leaderboard ? (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>Natijalar jadvali</Text>
          <GameLeaderboardList players={state.leaderboard.players} meId={me.player_id} />
        </View>
      ) : null}

      {state.status === "finished" && state.leaderboard ? (
        <ScrollView contentContainerStyle={styles.content}>
          <Podium players={state.leaderboard.players} />
          {me.rank && me.rank <= 3 ? (
            <View style={styles.myResult}>
              <Trophy color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} />
              <Text style={styles.myResultText}>Siz {me.rank}-o‘rinni egalladingiz!</Text>
            </View>
          ) : (
            <Text style={styles.waitText}>Sizning o‘rningiz: {me.rank ?? "—"}</Text>
          )}
          <GameLeaderboardList players={state.leaderboard.players} meId={me.player_id} />
          <PrimaryButton label="O‘yingohga qaytish" onPress={() => router.replace("/(app)/(tabs)/games")} />
        </ScrollView>
      ) : null}

      {state.status === "cancelled" || state.status === "expired" ? (
        <View style={styles.center}>
          <Text style={styles.waitTitle}>O‘yin to‘xtatildi</Text>
          <PrimaryButton label="O‘yingohga qaytish" onPress={() => router.replace("/(app)/(tabs)/games")} />
        </View>
      ) : null}
    </View>
  );
}

function Podium({ players }: { players: { id: string; nickname: string; avatar_id: number; total_score: number; rank: number }[] }) {
  const top = players.filter((player) => player.rank <= 3);
  const order = [top.find((p) => p.rank === 2), top.find((p) => p.rank === 1), top.find((p) => p.rank === 3)];
  const heights = [96, 130, 74];
  const medals = ["🥈", "🥇", "🥉"];
  return (
    <View style={styles.podium}>
      {order.map((player, index) => player ? (
        <View key={player.id} style={styles.podiumColumn}>
          <GameAvatar id={player.avatar_id} size={index === 1 ? 66 : 52} />
          <Text style={styles.podiumName} numberOfLines={1}>{player.nickname}</Text>
          <Text style={styles.podiumScore}>{player.total_score.toLocaleString("uz-UZ")}</Text>
          <View style={[styles.podiumBlock, { height: heights[index] }]}>
            <Text style={styles.podiumMedal}>{medals[index]}</Text>
          </View>
        </View>
      ) : <View key={`empty-${index}`} style={styles.podiumColumn} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 54 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  offline: { backgroundColor: colors.warning, paddingVertical: 6 },
  offlineText: { ...typography.caption, color: colors.onPrimary, textAlign: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  myName: { ...typography.bodyMedium, color: colors.ink },
  myTeam: { ...typography.caption, color: colors.accent },
  scorePill: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  scoreText: { ...typography.bodyMedium, color: colors.primaryDeep },
  waitTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  waitText: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  playerCount: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  countdownNumber: { fontFamily: "Manrope_700Bold", fontSize: 96, color: colors.primary, textAlign: "center" },
  // A digit is one glyph and a word is ten. Sized for the word, then allowed to
  // shrink further on a narrow phone rather than break in half.
  countdownGo: {
    fontFamily: "Manrope_700Bold", fontSize: 52, color: colors.primary,
    textAlign: "center", letterSpacing: -0.5, paddingHorizontal: spacing.lg,
  },
  questionMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  questionIndex: { ...typography.caption, color: colors.inkMuted },
  timerPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.primarySoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  timerText: { ...typography.bodyMedium, color: colors.primaryDeep },
  timerUrgent: { color: colors.danger },
  prompt: { ...typography.title, color: colors.ink, fontSize: 21, lineHeight: 28 },
  media: { width: "100%", height: 180, borderRadius: radius.lg },
  lockedBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.successSoft, borderRadius: radius.lg, paddingVertical: spacing.xl,
  },
  lockedText: { ...typography.bodyMedium, color: colors.success },
  verdict: { alignItems: "center", gap: spacing.sm, borderRadius: radius.lg, paddingVertical: spacing.xl },
  verdictGood: { backgroundColor: colors.success },
  verdictBad: { backgroundColor: colors.danger },
  verdictNeutral: { backgroundColor: colors.surfaceMuted },
  verdictTitle: { ...typography.heading, color: colors.onPrimary },
  verdictScore: { ...typography.title, color: colors.onPrimary },
  explanationCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg },
  explanationText: { ...typography.body, color: colors.inkMuted },
  sectionTitle: { ...typography.heading, color: colors.ink },
  podium: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: spacing.sm, paddingTop: spacing.lg },
  podiumColumn: { flex: 1, alignItems: "center", gap: 4 },
  podiumName: { ...typography.bodyMedium, color: colors.ink, fontSize: 13 },
  podiumScore: { ...typography.caption, color: colors.inkMuted },
  podiumBlock: {
    width: "100%", borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    backgroundColor: colors.primarySoft, alignItems: "center", paddingTop: spacing.sm,
  },
  podiumMedal: { fontSize: 26 },
  myResult: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  myResultText: { ...typography.bodyMedium, color: colors.primaryDeep },
});

import { GAME_TYPE_LABELS, type GameQuestionType } from "@jaxongirman/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { GameLeaderboardList } from "@/components/GameAnswerInput";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing, typography } from "@/theme/tokens";

type Player = { id: string; nickname: string; avatar_id: number; total_score: number; correct_count: number; rank: number | null };
type QuestionRow = { id: string; position: number; type: string; prompt: string };
type AnswerRow = { question_id: string; is_correct: boolean | null; response_ms: number };

type QuestionAnalytics = {
  id: string;
  position: number;
  type: GameQuestionType;
  prompt: string;
  answers: number;
  correct: number;
  averageMs: number;
};

/**
 * What the match said about the room: the final board, and per question how
 * many got it and how long they took. This is the creator's read on their own
 * content — which question was too hard, which was free.
 */
export default function GameResultsScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<QuestionAnalytics[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      setError(null);
      const [sessionResult, playerResult, answerResult] = await Promise.all([
        supabase.from("game_sessions").select("game_id, games(title)").eq("id", sessionId).single(),
        supabase.from("game_players")
          .select("id, nickname, avatar_id, total_score, correct_count, rank")
          .eq("session_id", sessionId)
          .order("rank", { nullsFirst: false }),
        supabase.from("game_answers")
          .select("question_id, is_correct, response_ms")
          .eq("session_id", sessionId),
      ]);
      if (sessionResult.error) throw sessionResult.error;
      setTitle((sessionResult.data.games as unknown as { title: string } | null)?.title ?? "O‘yin");
      setPlayers((playerResult.data as Player[]) ?? []);

      const gameId = sessionResult.data.game_id;
      if (gameId) {
        const { data: questionRows } = await supabase
          .from("game_questions")
          .select("id, position, type, prompt")
          .eq("game_id", gameId)
          .order("position");
        const answers = (answerResult.data as AnswerRow[]) ?? [];
        setQuestions(((questionRows as QuestionRow[]) ?? []).map((question) => {
          const mine = answers.filter((answer) => answer.question_id === question.id);
          return {
            id: question.id,
            position: question.position,
            type: question.type as GameQuestionType,
            prompt: question.prompt,
            answers: mine.length,
            correct: mine.filter((answer) => answer.is_correct).length,
            averageMs: mine.length ? Math.round(mine.reduce((sum, answer) => sum + answer.response_ms, 0) / mine.length) : 0,
          };
        }));
      }
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.safe, styles.center]}><ActivityIndicator color={colors.primary} size="large" /></View>
    );
  }
  if (error) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title="Natijalar" onLeave={() => router.back()} />
        <ErrorState message={error} onRetry={() => void load()} />
      </View>
    );
  }

  const graded = questions.filter((question) => question.answers > 0 && question.type !== "poll" && question.type !== "word_cloud");
  const hardest = graded.length ? graded.reduce((worst, question) =>
    question.correct / question.answers < worst.correct / worst.answers ? question : worst) : null;
  const easiest = graded.length ? graded.reduce((best, question) =>
    question.correct / question.answers > best.correct / best.answers ? question : best) : null;
  const totalAnswers = questions.reduce((sum, question) => sum + question.answers, 0);
  const totalCorrect = questions.reduce((sum, question) => sum + question.correct, 0);
  const averageScore = players.length
    ? Math.round(players.reduce((sum, player) => sum + player.total_score, 0) / players.length) : 0;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Natijalar" subtitle={title} onLeave={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryGrid}>
          <Summary value={String(players.length)} label="Ishtirokchi" />
          <Summary value={averageScore.toLocaleString("uz-UZ")} label="O‘rtacha ball" />
          <Summary
            value={totalAnswers ? `${Math.round((totalCorrect / totalAnswers) * 100)}%` : "—"}
            label="To‘g‘ri javob"
          />
        </View>

        <Text style={styles.sectionTitle}>Natijalar jadvali</Text>
        <GameLeaderboardList players={players.map((player, index) => ({ ...player, rank: player.rank ?? index + 1 }))} />

        {hardest || easiest ? (
          <>
            <Text style={styles.sectionTitle}>Diqqatga sazovor</Text>
            {hardest ? (
              <View style={styles.noteCard}>
                <Text style={styles.noteLabel}>Eng qiyin savol</Text>
                <Text style={styles.noteText} numberOfLines={2}>{hardest.position + 1}. {hardest.prompt}</Text>
                <Text style={styles.noteMeta}>{Math.round((hardest.correct / hardest.answers) * 100)}% to‘g‘ri</Text>
              </View>
            ) : null}
            {easiest && easiest.id !== hardest?.id ? (
              <View style={styles.noteCard}>
                <Text style={styles.noteLabel}>Eng oson savol</Text>
                <Text style={styles.noteText} numberOfLines={2}>{easiest.position + 1}. {easiest.prompt}</Text>
                <Text style={styles.noteMeta}>{Math.round((easiest.correct / easiest.answers) * 100)}% to‘g‘ri</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Savollar bo‘yicha</Text>
        {questions.map((question) => (
          <View key={question.id} style={styles.questionCard}>
            <View style={styles.questionHead}>
              <Text style={styles.questionIndex}>{question.position + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.questionType}>{GAME_TYPE_LABELS[question.type]}</Text>
                <Text style={styles.questionPrompt} numberOfLines={2}>{question.prompt}</Text>
              </View>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { flex: question.correct || 0.001 }]} />
              <View style={[styles.barRest, { flex: Math.max(question.answers - question.correct, 0) || 0.001 }]} />
            </View>
            <Text style={styles.questionMeta}>
              {question.answers} javob · {question.correct} to‘g‘ri
              {question.averageMs > 0 ? ` · o‘rtacha ${(question.averageMs / 1000).toFixed(1)}s` : ""}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Summary({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  summaryGrid: { flexDirection: "row", gap: spacing.sm },
  summaryCard: {
    flex: 1, alignItems: "center", gap: 2, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingVertical: spacing.lg,
  },
  summaryValue: { ...typography.heading, color: colors.ink },
  summaryLabel: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  sectionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  noteCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg, gap: 2 },
  noteLabel: { ...typography.caption, color: colors.accent },
  noteText: { ...typography.body, color: colors.ink },
  noteMeta: { ...typography.caption, color: colors.inkMuted },
  questionCard: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
  },
  questionHead: { flexDirection: "row", gap: spacing.md },
  questionIndex: { ...typography.bodyMedium, color: colors.primaryDeep, width: 20 },
  questionType: { ...typography.caption, color: colors.accent },
  questionPrompt: { ...typography.body, color: colors.ink },
  bar: { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  barFill: { backgroundColor: colors.success },
  barRest: { backgroundColor: colors.danger },
  questionMeta: { ...typography.caption, color: colors.inkMuted },
});

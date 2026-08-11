import { GAME_TYPE_LABELS, GAME_QUESTION_TYPES, type GameQuestionType } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Play, Plus, ShoppingBag, Sparkles, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { GameQuestionCard } from "@/components/GameQuestionCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  createSession, generateGame, listQuestions, setGameStatus,
  type Game, type GameQuestion,
} from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

const GENERATING_POLL_MS = 2500;

/** A sensible empty answer key for a hand-added question of each type. */
function defaultConfig(type: GameQuestionType): Record<string, unknown> {
  const options = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: String.fromCharCode(97 + index), text: "" }));
  switch (type) {
    case "single_choice": case "image_quiz": return { options: options(4) };
    case "multiple_choice": return { options: options(4), correct: [] };
    case "poll": return { options: options(3) };
    case "true_false": return {};
    case "ordering": {
      const items = options(3);
      return { items, order: items.map((item) => item.id) };
    }
    case "matching": {
      const left = [{ id: `l${Crypto.randomUUID().slice(0, 6)}`, text: "" }, { id: `l${Crypto.randomUUID().slice(0, 6)}`, text: "" }];
      const right = [{ id: `r${Crypto.randomUUID().slice(0, 6)}`, text: "" }, { id: `r${Crypto.randomUUID().slice(0, 6)}`, text: "" }];
      return { left, right, pairs: { [left[0]!.id]: right[0]!.id, [left[1]!.id]: right[1]!.id } };
    }
    case "fill_blank": return { answers: [] };
    case "open_answer": return { reference: "", ai_grading: false };
    case "word_cloud": return {};
    case "hotspot": return { shape: "circle" };
  }
}

/**
 * The game editor: every AI draft lands here before anyone plays it, and every
 * question — model-written or hand-written — is editable down to its answer
 * key. "Tayyor" is earned through game_set_status, which refuses a deck whose
 * questions cannot be graded.
 */
export default function GameEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [game, setGame] = useState<Game | null>(null);
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "ready" | "host" | "sell">(null);
  const [typePicker, setTypePicker] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const { data, error: gameError } = await supabase.from("games").select("*").eq("id", id).single();
      if (gameError) throw gameError;
      setGame(data as Game);
      if ((data as Game).status !== "generating") {
        setQuestions(await listQuestions(id));
      }
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // The AI writes in the background; the row's status is the progress signal.
  useEffect(() => {
    if (game?.status !== "generating" && !regeneratingId) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void load(); }, GENERATING_POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [game?.status, load, regeneratingId]);

  // A regeneration is finished when the question's row changes.
  useEffect(() => {
    if (!regeneratingId) return;
    const timer = setInterval(() => {
      void (async () => {
        const { data } = await supabase.from("game_questions").select("*").eq("id", regeneratingId).single();
        if (!data) { setRegeneratingId(null); return; }
        setQuestions((current) => {
          const previous = current.find((question) => question.id === regeneratingId);
          if (previous && previous.updated_at !== (data as GameQuestion).updated_at) {
            setRegeneratingId(null);
            return current.map((question) => question.id === regeneratingId ? data as GameQuestion : question);
          }
          return current;
        });
      })();
    }, GENERATING_POLL_MS);
    return () => clearInterval(timer);
  }, [regeneratingId]);

  async function saveMeta(patch: Partial<Pick<Game, "title" | "description">>) {
    if (!game) return;
    const { error: saveError } = await supabase.from("games").update(patch).eq("id", game.id);
    if (saveError) setActionError(asErrorMessage(saveError));
  }

  async function addQuestion(type: GameQuestionType) {
    if (!game) return;
    setTypePicker(false);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Kirish talab qilinadi.");
      const { data, error: insertError } = await supabase
        .from("game_questions")
        .insert({
          game_id: game.id,
          owner_id: user.id,
          position: questions.length,
          type,
          prompt: "",
          config: defaultConfig(type) as never,
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      setQuestions((current) => [...current, data as GameQuestion]);
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    }
  }

  async function removeQuestion(question: GameQuestion) {
    Alert.alert("Savolni o‘chirish", "Bu savol butunlay o‘chiriladi.", [
      { text: "Bekor qilish", style: "cancel" },
      {
        text: "O‘chirish", style: "destructive",
        onPress: () => void (async () => {
          const { error: deleteError } = await supabase.from("game_questions").delete().eq("id", question.id);
          if (deleteError) { setActionError(asErrorMessage(deleteError)); return; }
          setQuestions((current) => current.filter((row) => row.id !== question.id));
        })(),
      },
    ]);
  }

  async function duplicateQuestion(question: GameQuestion) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !game) return;
    const { data, error: insertError } = await supabase
      .from("game_questions")
      .insert({
        game_id: game.id, owner_id: user.id, position: questions.length,
        type: question.type, prompt: question.prompt, explanation: question.explanation,
        time_limit_seconds: question.time_limit_seconds, base_points: question.base_points,
        media_path: question.media_path, config: question.config as never,
      })
      .select("*")
      .single();
    if (insertError) { setActionError(asErrorMessage(insertError)); return; }
    setQuestions((current) => [...current, data as GameQuestion]);
  }

  async function moveQuestion(question: GameQuestion, direction: -1 | 1) {
    const index = questions.findIndex((row) => row.id === question.id);
    const swapWith = questions[index + direction];
    if (!swapWith) return;
    const next = [...questions];
    next[index] = swapWith;
    next[index + direction] = question;
    setQuestions(next);
    await Promise.all([
      supabase.from("game_questions").update({ position: index + direction }).eq("id", question.id),
      supabase.from("game_questions").update({ position: index }).eq("id", swapWith.id),
    ]);
  }

  async function regenerate(question: GameQuestion) {
    if (!game) return;
    setRegeneratingId(question.id);
    setActionError(null);
    try {
      await generateGame({ mode: "regenerate", gameId: game.id, questionId: question.id });
    } catch (failure) {
      setActionError(asErrorMessage(failure));
      setRegeneratingId(null);
    }
  }

  async function markReadyAnd(next: "ready" | "host" | "sell") {
    if (!game) return;
    setBusy(next);
    setActionError(null);
    try {
      await setGameStatus(game.id, "ready");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (next === "host") {
        const session = await createSession(game.id);
        router.push(`/oyingoh/host/${session.session_id}`);
      } else if (next === "sell") {
        router.push({ pathname: "/marketplace/sell", params: { gameId: game.id, gameTitle: game.title } });
      } else {
        await load();
      }
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (error || !game) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title="O‘yin" onLeave={() => router.back()} />
        <ErrorState message={error ?? "O‘yin topilmadi."} onRetry={() => void load()} />
      </View>
    );
  }

  if (game.status === "generating") {
    return (
      <View style={[styles.safe, styles.center, { gap: spacing.lg, padding: spacing.xl }]}>
        <Sparkles color={colors.primary} size={44} strokeWidth={icon.stroke} />
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.generatingTitle}>O‘yingoh yaratilmoqda...</Text>
        <Text style={styles.generatingHint}>AI savollarni tuzmoqda. Tayyor bo‘lgach savollarni tekshirib chiqasiz — har birini o‘zgartirish mumkin.</Text>
      </View>
    );
  }

  if (game.status === "failed") {
    return (
      <View style={styles.safe}>
        <ScreenHeader title="O‘yin" onLeave={() => router.back()} />
        <ErrorState message={game.failure_reason ?? "O‘yin yaratilmadi."} onRetry={() => router.replace("/oyingoh/create")} />
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title="O‘yin muharriri" subtitle={`${questions.length} savol`} onLeave={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {questions.length > 0 && game.source_type !== "manual" ? (
            <View style={styles.readyBanner}>
              <Text style={styles.readyBannerText}>Tayyor — savollarni tekshirib chiqing</Text>
            </View>
          ) : null}

          <TextInput
            style={styles.titleInput}
            defaultValue={game.title}
            placeholder="O‘yin nomi"
            placeholderTextColor={colors.inkSoft}
            maxLength={160}
            onEndEditing={(event) => void saveMeta({ title: event.nativeEvent.text.trim() })}
          />
          <TextInput
            style={styles.descriptionInput}
            defaultValue={game.description}
            placeholder="Qisqa tavsif"
            placeholderTextColor={colors.inkSoft}
            maxLength={2000}
            multiline
            onEndEditing={(event) => void saveMeta({ description: event.nativeEvent.text.trim() })}
          />

          {questions.map((question, index) => (
            <GameQuestionCard
              key={question.id}
              question={question}
              index={index}
              total={questions.length}
              onSaved={(next) => setQuestions((current) => current.map((row) => row.id === next.id ? next : row))}
              onDelete={() => void removeQuestion(question)}
              onDuplicate={() => void duplicateQuestion(question)}
              onMove={(direction) => void moveQuestion(question, direction)}
              onRegenerate={question.type === "image_quiz" || question.type === "hotspot" ? null : () => void regenerate(question)}
              regenerating={regeneratingId === question.id}
            />
          ))}

          <Pressable style={styles.addButton} onPress={() => setTypePicker(true)}>
            <Plus color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
            <Text style={styles.addButtonText}>Savol qo‘shish</Text>
          </Pressable>

          {actionError ? <InlineError message={actionError} /> : null}

          <PrimaryButton
            label="Saqlash"
            loading={busy === "ready"}
            disabled={busy !== null}
            onPress={() => void markReadyAnd("ready")}
          />
          <PrimaryButton
            label="O‘yinni boshlash"
            icon={Play}
            loading={busy === "host"}
            disabled={busy !== null}
            onPress={() => void markReadyAnd("host")}
          />
          <PrimaryButton
            label="Do‘konda sotish"
            icon={ShoppingBag}
            tone="secondary"
            loading={busy === "sell"}
            disabled={busy !== null}
            onPress={() => void markReadyAnd("sell")}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={typePicker} transparent animationType="slide" onRequestClose={() => setTypePicker(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Savol turi</Text>
              <Pressable onPress={() => setTypePicker(false)} hitSlop={8}>
                <X color={colors.inkMuted} size={icon.lg} strokeWidth={icon.stroke} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xl }}>
              {GAME_QUESTION_TYPES.map((type) => (
                <Pressable key={type} style={styles.typeRow} onPress={() => void addQuestion(type)}>
                  <Text style={styles.typeRowText}>{GAME_TYPE_LABELS[type]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  generatingTitle: { ...typography.heading, color: colors.ink, textAlign: "center" },
  generatingHint: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  readyBanner: { backgroundColor: colors.successSoft, borderRadius: radius.md, padding: spacing.md },
  readyBannerText: { ...typography.bodyMedium, color: colors.success, textAlign: "center" },
  titleInput: {
    ...typography.heading, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  descriptionInput: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    minHeight: 56, textAlignVertical: "top",
  },
  addButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: spacing.lg, borderRadius: radius.lg, borderWidth: 1.5,
    borderColor: colors.primary, borderStyle: "dashed",
  },
  addButtonText: { ...typography.bodyMedium, color: colors.primary },
  modalScrim: { flex: 1, backgroundColor: "rgba(21, 14, 36, 0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.xl, maxHeight: "75%",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  modalTitle: { ...typography.heading, color: colors.ink },
  typeRow: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.lg },
  typeRowText: { ...typography.bodyMedium, color: colors.ink },
});

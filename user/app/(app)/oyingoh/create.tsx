import {
  GAME_AI_TYPES, GAME_AUDIENCE_LABELS, GAME_DIFFICULTY_LABELS, GAME_TYPE_LABELS,
  type GameQuestionType,
} from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, FileText, Presentation, Sparkles, SquarePen } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { generateGame } from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

type Mode = "topic" | "text" | "presentation" | "manual";
type DeckRow = { id: string; title: string };

const COUNT_PRESETS = [5, 10, 15, 20] as const;

/**
 * "Yangi o‘yin yaratish": four doors into the same editor. Three of them ask
 * the AI to draft, one starts blank — and every road ends on the editor
 * screen, because an AI question that cannot be edited does not ship.
 */
export default function CreateGameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ categoryId?: string; presentationId?: string }>();
  const [mode, setMode] = useState<Mode>("topic");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [deckId, setDeckId] = useState<string | null>(params.presentationId ?? null);
  const [difficulty, setDifficulty] = useState("aralash");
  const [audience, setAudience] = useState("umumiy");
  const [count, setCount] = useState<number>(10);
  const [types, setTypes] = useState<Set<GameQuestionType>>(new Set(["single_choice", "true_false", "multiple_choice", "fill_blank"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "presentation" || decks.length > 0) return;
    void supabase
      .from("presentations")
      .select("id, title")
      .eq("status", "ready")
      .order("updated_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setDecks((data as DeckRow[]) ?? []));
  }, [decks.length, mode]);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (mode === "topic") return topic.trim().length >= 3;
    if (mode === "text") return text.trim().length >= 80;
    if (mode === "presentation") return Boolean(deckId);
    return true;
  }, [busy, deckId, mode, text, topic]);

  function toggleType(type: GameQuestionType) {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        if (next.size > 1) next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (mode === "manual") {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Kirish talab qilinadi.");
        const { data, error: insertError } = await supabase
          .from("games")
          .insert({
            owner_id: user.id,
            title: topic.trim() || "Yangi o‘yin",
            category_id: params.categoryId ?? null,
            difficulty,
            audience,
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        router.replace(`/oyingoh/${data.id}`);
        return;
      }

      const result = await generateGame({
        mode: mode === "presentation" ? "presentation" : mode,
        topic: topic.trim() || undefined,
        text: text.trim() || undefined,
        presentationId: deckId ?? undefined,
        difficulty,
        audience,
        questionCount: count,
        types: [...types],
        categoryId: params.categoryId ?? null,
      });
      router.replace(`/oyingoh/${result.gameId}`);
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Yangi o‘yin" subtitle="O‘yingoh" onLeave={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.modeGrid}>
            <ModeCard active={mode === "topic"} icon={Sparkles} label="Mavzu bo‘yicha" hint="AI bilan" onPress={() => setMode("topic")} />
            <ModeCard active={mode === "text"} icon={FileText} label="Matndan" hint="AI bilan" onPress={() => setMode("text")} />
            <ModeCard active={mode === "presentation"} icon={Presentation} label="Prezentatsiyadan" hint="AI bilan" onPress={() => setMode("presentation")} />
            <ModeCard active={mode === "manual"} icon={SquarePen} label="Qo‘lda" hint="Bo‘sh o‘yin" onPress={() => setMode("manual")} />
          </View>

          {mode === "topic" || mode === "manual" ? (
            <View style={styles.field}>
              <Text style={styles.label}>{mode === "manual" ? "O‘yin nomi" : "Mavzu"}</Text>
              <TextInput
                style={styles.input}
                value={topic}
                onChangeText={setTopic}
                placeholder={mode === "manual" ? "Masalan: Adabiyot viktorinasi" : "Masalan: Amir Temur davlati"}
                placeholderTextColor={colors.inkSoft}
                maxLength={300}
              />
            </View>
          ) : null}

          {mode === "text" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Manba matn</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={text}
                onChangeText={setText}
                placeholder="Savollar shu matndan tuziladi. Kamida bir necha jumla joylashtiring."
                placeholderTextColor={colors.inkSoft}
                multiline
                maxLength={20000}
              />
            </View>
          ) : null}

          {mode === "presentation" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Taqdimotni tanlang</Text>
              {decks.length === 0 ? (
                <Text style={styles.hint}>Tayyor taqdimotingiz yo‘q. Avval taqdimot yarating.</Text>
              ) : decks.map((deck) => (
                <Pressable
                  key={deck.id}
                  style={[styles.deckRow, deckId === deck.id && styles.deckRowActive]}
                  onPress={() => setDeckId(deck.id)}
                >
                  <Text style={[styles.deckTitle, deckId === deck.id && styles.deckTitleActive]} numberOfLines={1}>{deck.title}</Text>
                  {deckId === deck.id ? <Check color={colors.primary} size={icon.md} strokeWidth={icon.strokeBold} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {mode !== "manual" ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Daraja</Text>
                <View style={styles.chipRow}>
                  {Object.entries(GAME_DIFFICULTY_LABELS).map(([value, label]) => (
                    <Chip key={value} active={difficulty === value} label={label} onPress={() => setDifficulty(value)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Auditoriya</Text>
                <View style={styles.chipRow}>
                  {["umumiy", "maktab_1_4", "maktab_5_9", "maktab_10_11", "universitet"].map((value) => (
                    <Chip key={value} active={audience === value} label={GAME_AUDIENCE_LABELS[value] ?? value} onPress={() => setAudience(value)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Savollar soni</Text>
                <View style={styles.chipRow}>
                  {COUNT_PRESETS.map((preset) => (
                    <Chip key={preset} active={count === preset} label={`${preset}`} onPress={() => setCount(preset)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Savol turlari</Text>
                <Text style={styles.hint}>Rasmli turlar (Rasmni toping, Rasmdan joyni toping) muharrirda qo‘lda qo‘shiladi.</Text>
                <View style={styles.chipRow}>
                  {GAME_AI_TYPES.map((type) => (
                    <Chip key={type} active={types.has(type)} label={GAME_TYPE_LABELS[type]} onPress={() => toggleType(type)} />
                  ))}
                </View>
              </View>
            </>
          ) : null}

          {error ? <InlineError message={error} /> : null}

          <PrimaryButton
            label={mode === "manual" ? "O‘yin yaratish" : busy ? "O‘yingoh yaratilmoqda..." : "AI bilan yaratish"}
            loading={busy}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ModeCard({ active, icon: Icon, label, hint, onPress }: {
  active: boolean; icon: typeof Sparkles; label: string; hint: string; onPress: () => void;
}) {
  return (
    <Pressable style={[styles.modeCard, active && styles.modeCardActive]} onPress={onPress} accessibilityRole="button">
      <Icon color={active ? colors.primary : colors.inkMuted} size={icon.lg} strokeWidth={icon.stroke} />
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
      <Text style={styles.modeHint}>{hint}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  modeCard: {
    width: "48%", flexGrow: 1, gap: 4, padding: spacing.lg,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg,
    borderWidth: 1.5, borderColor: "transparent",
  },
  modeCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modeLabel: { ...typography.bodyMedium, color: colors.ink },
  modeLabelActive: { color: colors.primaryDeep },
  modeHint: { ...typography.caption, color: colors.inkMuted },
  field: { gap: spacing.sm },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  input: {
    ...typography.body, color: colors.ink,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  textArea: { minHeight: 140, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5, borderColor: "transparent",
  },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.body, color: colors.inkMuted },
  chipTextActive: { color: colors.primaryDeep, fontFamily: "Manrope_600SemiBold" },
  deckRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent",
  },
  deckRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  deckTitle: { ...typography.body, color: colors.ink, flex: 1 },
  deckTitleActive: { color: colors.primaryDeep },
});

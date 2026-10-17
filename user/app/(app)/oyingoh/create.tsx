import { GAME_AI_TYPES, GAME_DIFFICULTY_LABELS, type GameQuestionType } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, FileText, Presentation, Sparkles, SquarePen } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { LANGUAGE_NAMES, type AppLanguage } from "@/i18n";
import { asErrorMessage } from "@/lib/format";
import { generateGame } from "@/lib/games";
import { labelOf } from "@/lib/labels";
import { hasCyrillic, toLatin } from "@/lib/script";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/providers/LanguageProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Mode = "topic" | "text" | "presentation" | "manual";
type DeckRow = { id: string; title: string };

const COUNT_PRESETS = [5, 10, 15, 20] as const;

/**
 * "Yangi o‘yin yaratish": four doors into the same editor. Three of them ask
 * the AI to draft, one starts blank — and every road ends on the editor
 * screen, because an AI question that cannot be edited does not ship.
 */
export default function CreateGameScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
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
  /**
   * The language the questions are written in — the app's own until the person
   * picks another, as for a deck. A quiz made from a deck takes the deck's.
   */
  const { language: appLanguage, deckLanguages } = useLanguage();
  const [chosenLanguage, setGameLanguage] = useState<AppLanguage>(appLanguage);
  const gameLanguage: AppLanguage = deckLanguages.includes(chosenLanguage) ? chosenLanguage : "uz";
  const needsLatin = mode === "topic" && gameLanguage === "uz" && hasCyrillic(topic);

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
    if (mode === "topic") return topic.trim().length >= 3 && !needsLatin;
    if (mode === "text") return text.trim().length >= 80;
    if (mode === "presentation") return Boolean(deckId);
    return true;
  }, [busy, deckId, mode, needsLatin, text, topic]);

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
        if (!user) throw new Error(t("form.signIn"));
        const { data, error: insertError } = await supabase
          .from("games")
          .insert({
            owner_id: user.id,
            title: topic.trim() || t("form.defaultTitle"),
            category_id: params.categoryId ?? null,
            difficulty,
            audience,
            language: gameLanguage,
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
        // A quiz about a deck is written in the deck's language; the server reads it.
        language: mode === "presentation" ? undefined : gameLanguage,
      });
      router.replace(`/oyingoh/${result.gameId}`);
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("form.title")} subtitle={t("title")} onLeave={() => router.back()} />
      <View style={{ flex: 1 }}>
        <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.modeGrid}>
            <ModeCard active={mode === "topic"} icon={Sparkles} label={t("form.mode.topic")} hint={t("form.withAi")} onPress={() => setMode("topic")} />
            <ModeCard active={mode === "text"} icon={FileText} label={t("form.mode.text")} hint={t("form.withAi")} onPress={() => setMode("text")} />
            <ModeCard active={mode === "presentation"} icon={Presentation} label={t("form.mode.presentation")} hint={t("form.withAi")} onPress={() => setMode("presentation")} />
            <ModeCard active={mode === "manual"} icon={SquarePen} label={t("form.mode.manual")} hint={t("form.blank")} onPress={() => setMode("manual")} />
          </View>

          {mode === "topic" || mode === "manual" ? (
            <View style={styles.field}>
              <Text style={styles.label}>{mode === "manual" ? t("form.name") : t("form.topic")}</Text>
              <TextInput
                style={styles.input}
                value={topic}
                onChangeText={setTopic}
                placeholder={mode === "manual" ? t("form.namePlaceholder") : t("form.topicPlaceholder")}
                placeholderTextColor={colors.inkSoft}
                maxLength={300}
              />
              {needsLatin ? (
                <View style={styles.latin}>
                  <Text style={styles.latinText}>{t("form.latinBody")}</Text>
                  <Pressable accessibilityRole="button" onPress={() => setTopic(toLatin(topic))} style={styles.latinFix}>
                    <Text style={styles.latinFixText}>{t("form.latinFix")}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Only when there is a choice; a quiz about a deck takes the deck's language. */}
          {deckLanguages.length > 1 ? (
            <View style={styles.field}>
              <Text style={styles.label}>{t("form.language")}</Text>
              {mode === "presentation" ? (
                <Text style={styles.hint}>{t("form.deckLanguageHint")}</Text>
              ) : (
                <>
                  <Text style={styles.hint}>{t("form.languageHint")}</Text>
                  <View style={styles.chipRow} accessibilityRole="radiogroup">
                    {deckLanguages.map((code) => (
                      <Chip key={code} active={gameLanguage === code} label={LANGUAGE_NAMES[code]} onPress={() => { setGameLanguage(code); void Haptics.selectionAsync(); }} />
                    ))}
                  </View>
                </>
              )}
            </View>
          ) : null}

          {mode === "text" ? (
            <View style={styles.field}>
              <Text style={styles.label}>{t("form.source")}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={text}
                onChangeText={setText}
                placeholder={t("form.sourcePlaceholder")}
                placeholderTextColor={colors.inkSoft}
                multiline
                maxLength={20000}
              />
            </View>
          ) : null}

          {mode === "presentation" ? (
            <View style={styles.field}>
              <Text style={styles.label}>{t("form.deck")}</Text>
              {decks.length === 0 ? (
                <Text style={styles.hint}>{t("form.noDecks")}</Text>
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
                <Text style={styles.label}>{t("form.difficulty")}</Text>
                <View style={styles.chipRow}>
                  {Object.keys(GAME_DIFFICULTY_LABELS).map((value) => (
                    <Chip key={value} active={difficulty === value} label={labelOf("gameDifficulty", value)} onPress={() => setDifficulty(value)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("form.audience")}</Text>
                <View style={styles.chipRow}>
                  {["umumiy", "maktab_1_4", "maktab_5_9", "maktab_10_11", "universitet"].map((value) => (
                    <Chip key={value} active={audience === value} label={labelOf("audience", value)} onPress={() => setAudience(value)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("form.count")}</Text>
                <View style={styles.chipRow}>
                  {COUNT_PRESETS.map((preset) => (
                    <Chip key={preset} active={count === preset} label={`${preset}`} onPress={() => setCount(preset)} />
                  ))}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("form.types")}</Text>
                <Text style={styles.hint}>{t("form.typesHint")}</Text>
                <View style={styles.chipRow}>
                  {GAME_AI_TYPES.map((type) => (
                    <Chip key={type} active={types.has(type)} label={labelOf("gameType", type)} onPress={() => toggleType(type)} />
                  ))}
                </View>
              </View>
            </>
          ) : null}

          {error ? <InlineError message={error} /> : null}

          <PrimaryButton
            label={mode === "manual" ? t("form.createManual") : busy ? t("form.creating") : t("form.createAi")}
            loading={busy}
            disabled={!canSubmit}
            onPress={() => void submit()}
          />
        </KeyboardAwareScrollView>
      </View>
    </View>
  );
}

function ModeCard({ active, icon: Icon, label, hint, onPress }: {
  active: boolean; icon: typeof Sparkles; label: string; hint: string; onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable style={[styles.modeCard, active && styles.modeCardActive]} onPress={onPress} accessibilityRole="button">
      <Icon color={active ? colors.primary : colors.inkMuted} size={icon.lg} strokeWidth={icon.stroke} />
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>{label}</Text>
      <Text style={styles.modeHint}>{hint}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
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
  latin: { gap: spacing.sm, alignItems: "flex-start" },
  latinText: { ...typography.caption, color: colors.danger },
  latinFix: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  latinFixText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
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
}));

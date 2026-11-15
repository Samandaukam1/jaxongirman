import { GAME_DIFFICULTY_LABELS } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
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
import { labelOf } from "@/lib/labels";
import { hasCyrillic } from "@/lib/script";
import { supabase } from "@/lib/supabase";
import { createManualTest, generateTest, TEST_COUNT_PRESETS, TEST_OPTION_PRESETS } from "@/lib/tests";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Mode = "topic" | "text" | "presentation" | "manual";
type Layout = "combined" | "separate";

/** A new test: where its questions come from, how many, and how it is printed. */
export default function CreateTestScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const router = useRouter();
  const { user } = useAuth();
  const { language: appLanguage, deckLanguages } = useLanguage();
  const [mode, setMode] = useState<Mode>("topic");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [decks, setDecks] = useState<{ id: string; title: string }[]>([]);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [chosenLanguage, setLanguage] = useState<AppLanguage>(appLanguage);
  const language: AppLanguage = deckLanguages.includes(chosenLanguage) ? chosenLanguage : "uz";
  const [difficulty, setDifficulty] = useState("aralash");
  const [audience, setAudience] = useState("umumiy");
  const [count, setCount] = useState(20);
  const [options, setOptions] = useState(4);
  const [layout, setLayout] = useState<Layout>("combined");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsLatin = mode === "topic" && language === "uz" && hasCyrillic(topic);

  useEffect(() => {
    if (mode !== "presentation" || decks.length) return;
    void supabase.from("presentations").select("id, title").eq("status", "ready")
      .order("updated_at", { ascending: false }).limit(30)
      .then(({ data }) => setDecks(data ?? []));
  }, [decks.length, mode]);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (mode === "topic") return topic.trim().length >= 3 && !needsLatin;
    if (mode === "text") return text.trim().length >= 80;
    if (mode === "presentation") return Boolean(deckId);
    return true;
  }, [busy, deckId, mode, needsLatin, text, topic]);

  async function submit() {
    if (!user) return;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const id = mode === "manual"
        ? await createManualTest({ ownerId: user.id, title: topic.trim(), language, optionCount: options, layout })
        : await generateTest({
          mode, topic: topic.trim() || undefined, text: text.trim() || undefined, presentationId: deckId ?? undefined,
          language: mode === "presentation" ? undefined : language, difficulty, audience, questionCount: count, optionCount: options, layout,
        });
      router.replace(`/test/${id}`);
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("form.title")} subtitle={t("title")} onLeave={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.modeGrid}>
          {([
            ["topic", Sparkles, t("form.mode.topic"), t("form.withAi")],
            ["text", FileText, t("form.mode.text"), t("form.withAi")],
            ["presentation", Presentation, t("form.mode.presentation"), t("form.withAi")],
            ["manual", SquarePen, t("form.mode.manual"), t("form.blank")],
          ] as const).map(([value, Icon, label, hint]) => (
            <Pressable key={value} accessibilityRole="button" onPress={() => setMode(value)} style={[styles.modeCard, mode === value && styles.modeCardActive]}>
              <Icon color={mode === value ? colors.primary : colors.inkMuted} size={icon.lg} strokeWidth={icon.stroke} />
              <Text style={[styles.modeLabel, mode === value && styles.modeLabelActive]}>{label}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </Pressable>
          ))}
        </View>

        {mode === "topic" || mode === "manual" ? (
          <Field label={mode === "manual" ? t("form.name") : t("form.topic")}>
            <TextInput
              style={styles.input}
              value={topic}
              onChangeText={setTopic}
              placeholder={mode === "manual" ? t("form.namePlaceholder") : t("form.topicPlaceholder")}
              placeholderTextColor={colors.inkSoft}
              maxLength={300}
            />
            {needsLatin ? <Text style={styles.warning}>{t("form.latin")}</Text> : null}
          </Field>
        ) : null}

        {mode === "text" ? (
          <Field label={t("form.source")}>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={text}
              onChangeText={setText}
              placeholder={t("form.sourcePlaceholder")}
              placeholderTextColor={colors.inkSoft}
              multiline
              maxLength={20000}
            />
          </Field>
        ) : null}

        {mode === "presentation" ? (
          <Field label={t("form.deck")}>
            {decks.length === 0 ? <Text style={styles.hint}>{t("form.noDecks")}</Text> : decks.map((deck) => (
              <Pressable key={deck.id} onPress={() => setDeckId(deck.id)} style={[styles.deckRow, deckId === deck.id && styles.deckRowActive]}>
                <Text style={[styles.deckTitle, deckId === deck.id && styles.modeLabelActive]} numberOfLines={1}>{deck.title}</Text>
                {deckId === deck.id ? <Check color={colors.primary} size={icon.md} strokeWidth={icon.strokeBold} /> : null}
              </Pressable>
            ))}
          </Field>
        ) : null}

        {deckLanguages.length > 1 && mode !== "presentation" ? (
          <Field label={t("form.language")}>
            <Chips values={deckLanguages} active={language} label={(code) => LANGUAGE_NAMES[code]} onPick={setLanguage} />
          </Field>
        ) : null}

        {mode !== "manual" ? (
          <>
            <Field label={t("form.difficulty")}>
              <Chips values={Object.keys(GAME_DIFFICULTY_LABELS)} active={difficulty} label={(value) => labelOf("gameDifficulty", value)} onPick={setDifficulty} />
            </Field>
            <Field label={t("form.audience")}>
              <Chips values={["umumiy", "maktab_1_4", "maktab_5_9", "maktab_10_11", "universitet"]} active={audience} label={(value) => labelOf("audience", value)} onPick={setAudience} />
            </Field>
            <Field label={t("form.count")}>
              <Chips values={[...TEST_COUNT_PRESETS]} active={count} label={(value) => `${value}`} onPick={setCount} />
            </Field>
          </>
        ) : null}

        <Field label={t("form.options")} hint={t("form.optionsHint")}>
          <Chips values={[...TEST_OPTION_PRESETS]} active={options} label={(value) => `${value}`} onPick={setOptions} />
        </Field>

        <Field label={t("form.layout")}>
          {(["combined", "separate"] as const).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: layout === value }} onPress={() => setLayout(value)}
              style={[styles.deckRow, layout === value && styles.deckRowActive]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.deckTitle, layout === value && styles.modeLabelActive]}>{t(`form.${value}`)}</Text>
                <Text style={styles.hint}>{t(`form.${value}Hint`)}</Text>
              </View>
              {layout === value ? <Check color={colors.primary} size={icon.md} strokeWidth={icon.strokeBold} /> : null}
            </Pressable>
          ))}
        </Field>

        {error ? <InlineError message={error} /> : null}
        <PrimaryButton
          label={mode === "manual" ? t("form.createManual") : busy ? t("form.creating") : t("form.create")}
          loading={busy}
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

function Chips<T extends string | number>({ values, active, label, onPick }: { values: readonly T[]; active: T; label: (value: T) => string; onPick: (value: T) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.chipRow}>
      {values.map((value) => (
        <Pressable key={String(value)} onPress={() => { onPick(value); void Haptics.selectionAsync(); }} style={[styles.chip, active === value && styles.chipActive]}>
          <Text style={[styles.chipText, active === value && styles.chipTextActive]}>{label(value)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  modeCard: { width: "48%", flexGrow: 1, gap: 4, padding: spacing.lg, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, borderWidth: 1.5, borderColor: "transparent" },
  modeCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modeLabel: { ...typography.bodyMedium, color: colors.ink },
  modeLabelActive: { color: colors.primaryDeep },
  field: { gap: spacing.sm },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  warning: { ...typography.caption, color: colors.danger },
  input: { ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  textArea: { minHeight: 140, textAlignVertical: "top" },
  deckRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent" },
  deckRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  deckTitle: { ...typography.body, color: colors.ink, flexShrink: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent" },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.body, color: colors.inkMuted },
  chipTextActive: { color: colors.primaryDeep, fontFamily: "JaxongirmanSans_600SemiBold" },
}));

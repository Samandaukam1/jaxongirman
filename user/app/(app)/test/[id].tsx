import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Download, KeyRound, ListChecks, PenLine, Plus, ScanLine, Sparkles, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { TestQuestionEditor, type QuestionDraft } from "@/components/TestQuestionEditor";
import { localizeError } from "@/lib/errors";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  deleteQuestion, loadTest, OPTION_LETTERS, openTestPdf, saveQuestion, updateTest, type Test, type TestQuestion,
} from "@/lib/tests";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One test: print it, check its sheets, see its results, and edit its
 * questions. Checking comes first on the page, because once a test is printed
 * that is what the teacher comes back for.
 */
export default function TestScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["tests", "common"]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [results, setResults] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "sheet" | "key">(null);
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [loaded, counted] = await Promise.all([
        loadTest(id),
        supabase.from("test_results").select("id", { count: "exact", head: true }).eq("test_id", id),
      ]);
      setTest(loaded.test);
      setQuestions(loaded.questions);
      setResults(counted.count ?? 0);
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [id]);

  useFocusRefresh(load, 0);

  // The questions are written in the background; the row says when they are in.
  useEffect(() => {
    if (test?.status !== "generating") return;
    const timer = setInterval(() => { void load(); }, 2500);
    return () => clearInterval(timer);
  }, [load, test?.status]);

  if (error && !test) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("title")} onLeave={() => router.back()} />
        <ErrorState message={error} onRetry={() => void load()} />
      </View>
    );
  }
  if (!test) return <View style={[styles.safe, styles.center]}><ActivityIndicator color={colors.primary} size="large" /></View>;

  if (test.status === "generating") {
    return (
      <View style={[styles.safe, styles.center, { gap: spacing.lg, padding: spacing.xl }]}>
        <Sparkles color={colors.primary} size={44} strokeWidth={icon.stroke} />
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.bigTitle}>{t("page.generating")}</Text>
        <Text style={styles.hint}>{t("page.generatingBody")}</Text>
      </View>
    );
  }
  if (test.status === "failed") {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("title")} onLeave={() => router.back()} />
        <ErrorState message={test.failure_reason ? localizeError(test.failure_reason) : t("page.failed")} onRetry={() => router.replace("/test/create")} />
      </View>
    );
  }

  const current = test;
  const empty = questions.length === 0;

  async function pdf(kind: "sheet" | "key") {
    setBusy(kind);
    setActionError(null);
    try {
      await openTestPdf(current.id, kind, current.title);
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function setLayout(layout: "combined" | "separate") {
    if (layout === current.print_layout) return;
    void Haptics.selectionAsync();
    setTest({ ...current, print_layout: layout });
    try {
      await updateTest(current.id, { print_layout: layout });
    } catch (failure) {
      setActionError(asErrorMessage(failure));
    }
  }

  async function save(next: QuestionDraft) {
    setSaving(true);
    setDraftError(null);
    try {
      await saveQuestion({
        id: next.id, test_id: current.id, owner_id: current.owner_id, prompt: next.prompt, options: next.options, correct: next.correct,
        position: next.id ? questions.find((question) => question.id === next.id)!.position : questions.length,
      });
      setDraft(null);
      await load();
    } catch (failure) {
      setDraftError(asErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  function remove(question: TestQuestion) {
    Alert.alert(t("page.delete"), t("page.deleteConfirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("page.delete"), style: "destructive", onPress: () => {
        void deleteQuestion(question, questions).then(load).catch((failure) => setActionError(asErrorMessage(failure)));
      } },
    ]);
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("title")} subtitle={t("meta", { count: questions.length, options: test.option_count })} onLeave={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.titleInput}
          defaultValue={test.title}
          placeholder={t("page.name")}
          placeholderTextColor={colors.inkSoft}
          maxLength={160}
          multiline
          onEndEditing={(event) => {
            const title = event.nativeEvent.text.trim();
            if (title !== current.title) void updateTest(current.id, { title }).then(load).catch((failure) => setActionError(asErrorMessage(failure)));
          }}
        />

        {empty ? <Text style={styles.notice}>{t("page.needQuestions")}</Text> : null}
        <View style={styles.action}>
          <PrimaryButton label={t("page.scan")} icon={ScanLine} disabled={empty} onPress={() => router.push(`/test/scan/${test.id}`)} />
          <Text style={styles.hint}>{t("page.scanHint")}</Text>
        </View>
        <PrimaryButton label={results ? t("page.resultsCount", { count: results }) : t("page.results")} icon={ListChecks} tone="secondary" onPress={() => router.push(`/test/results/${test.id}`)} />
        <PrimaryButton label={t("page.manual")} icon={PenLine} tone="ghost" disabled={empty} onPress={() => router.push(`/test/check/${test.id}`)} />

        <Text style={styles.section}>{t("page.layout")}</Text>
        <View style={styles.segment}>
          {(["combined", "separate"] as const).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: test.print_layout === value }}
              onPress={() => void setLayout(value)} style={[styles.segmentOption, test.print_layout === value && styles.segmentActive]}>
              <Text style={[styles.segmentText, test.print_layout === value && styles.segmentTextActive]}>{t(`form.${value}`)}</Text>
              <Text style={styles.segmentHint} numberOfLines={2}>{t(`form.${value}Hint`)}</Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton label={t("page.pdf")} icon={Download} tone="secondary" loading={busy === "sheet"} disabled={empty || busy !== null} onPress={() => void pdf("sheet")} />
        <PrimaryButton label={t("page.key")} icon={KeyRound} tone="ghost" loading={busy === "key"} disabled={empty || busy !== null} onPress={() => void pdf("key")} />
        <Text style={styles.hint}>{t("page.printNote")}</Text>
        {actionError ? <InlineError message={actionError} /> : null}

        <Text style={styles.section}>{t("page.questions")}</Text>
        {empty ? <Text style={styles.hint}>{t("page.noQuestions")}</Text> : null}
        {questions.map((question, index) => (
          <Pressable
            key={question.id}
            onPress={() => setDraft({ id: question.id, prompt: question.prompt, options: (question.options as string[]).map(String), correct: question.correct })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.cardHead}>
              <Text style={styles.cardNumber}>{index + 1}</Text>
              <Text style={styles.cardPrompt}>{question.prompt}</Text>
              <Pressable accessibilityLabel={t("page.delete")} hitSlop={8} onPress={() => remove(question)}>
                <Trash2 color={colors.inkSoft} size={18} />
              </Pressable>
            </View>
            {(question.options as string[]).map((option, at) => (
              <Text key={at} style={[styles.option, at === question.correct && styles.optionRight]}>
                {OPTION_LETTERS[at]}) {String(option)}
              </Text>
            ))}
          </Pressable>
        ))}
        {questions.length < 60 ? (
          <Pressable style={styles.add} onPress={() => setDraft({ prompt: "", options: Array.from({ length: test.option_count }, () => ""), correct: 0 })}>
            <Plus color={colors.primary} size={icon.lg} strokeWidth={icon.strokeBold} />
            <Text style={styles.addText}>{t("page.addQuestion")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {draft ? (
        <TestQuestionEditor draft={draft} saving={saving} error={draftError} onSave={(next) => void save(next)} onClose={() => { setDraft(null); setDraftError(null); }} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  bigTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  hint: { ...typography.caption, color: colors.inkMuted },
  notice: { ...typography.caption, color: colors.warning },
  titleInput: { ...typography.title, color: colors.ink, paddingVertical: 0 },
  action: { gap: spacing.xs },
  section: { ...typography.bodyMedium, color: colors.ink, marginTop: spacing.md },
  segment: { flexDirection: "row", gap: spacing.sm },
  segmentOption: { flex: 1, gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent" },
  segmentActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  segmentText: { ...typography.bodyMedium, color: colors.ink },
  segmentTextActive: { color: colors.primaryDeep },
  segmentHint: { ...typography.caption, color: colors.inkMuted },
  card: { gap: 4, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardHead: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginBottom: 4 },
  cardNumber: { ...typography.bodyMedium, color: colors.primary, minWidth: 22 },
  cardPrompt: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  option: { ...typography.body, color: colors.inkMuted, paddingLeft: 30 },
  optionRight: { color: colors.success, fontFamily: "JaxongirmanSans_700Bold" },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary },
  addText: { ...typography.bodyMedium, color: colors.primary },
}));

import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { TestAnswerGrid } from "@/components/TestAnswerGrid";
import { asErrorMessage } from "@/lib/format";
import { loadTest, previewScore, saveResult, type Test, type TestQuestion } from "@/lib/tests";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** A sheet checked by hand: the teacher taps what the student marked; the database grades it. */
export default function CheckTestScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [student, setStudent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const keyAnswers = useMemo(() => questions.map((question) => question.correct), [questions]);

  useEffect(() => {
    if (!id) return;
    loadTest(id).then((loaded) => {
      setTest(loaded.test);
      setQuestions(loaded.questions);
      setAnswers(loaded.questions.map(() => null));
    }).catch((failure) => setError(asErrorMessage(failure)));
  }, [id]);

  async function save() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const row = await saveResult(id, student, answers, "manual");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(t("scan.saved", { name: row.student_name || t("results.noName"), score: row.score, total: row.total }));
      setStudent("");
      setAnswers(questions.map(() => null));
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  if (error && !test) {
    return <View style={styles.safe}><ScreenHeader title={t("check.title")} onLeave={() => router.back()} /><ErrorState message={error} /></View>;
  }
  if (!test) return <View style={[styles.safe, styles.center]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  const score = previewScore(questions, answers);

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("check.title")} subtitle={test.title} onLeave={() => router.back()} />
      <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {saved ? <View style={styles.saved}><CheckCircle2 color={colors.success} size={18} /><Text style={styles.savedText}>{saved}</Text></View> : null}
        <Text style={styles.score}>{t("score", { score, total: questions.length })}</Text>
        <Text style={styles.hint}>{t("check.hint")}</Text>
        <Text style={styles.label}>{t("scan.student")}</Text>
        <TextInput style={styles.input} value={student} onChangeText={setStudent} placeholder={t("scan.studentPlaceholder")} placeholderTextColor={colors.inkSoft} maxLength={120} />
        <TestAnswerGrid answers={answers} options={test.option_count} keyAnswers={keyAnswers} onChange={setAnswers} />
        {error ? <InlineError message={error} /> : null}
        <PrimaryButton label={t("check.save")} loading={saving} onPress={() => void save()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  score: { ...typography.display, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  label: { ...typography.bodyMedium, color: colors.ink },
  input: { ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  saved: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  savedText: { ...typography.bodyMedium, color: colors.success, flex: 1 },
}));

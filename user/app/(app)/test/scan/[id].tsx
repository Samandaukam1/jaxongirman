import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, CheckCircle2, ImageIcon, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Platform, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { TestAnswerGrid } from "@/components/TestAnswerGrid";
import { asErrorMessage } from "@/lib/format";
import { loadTest, previewScore, saveResult, scanSheet, type ScanReading, type Test, type TestQuestion } from "@/lib/tests";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** The answer panel's shape, width to height (`test-sheet.ts`: 350 × 515). */
const PANEL_RATIO = 350 / 515;

type Stage =
  | { kind: "camera" }
  | { kind: "reading" }
  | { kind: "review"; reading: ScanReading; uri: string; answers: (number | null)[] }
  | { kind: "failed"; message: string };

/**
 * Checking filled-in sheets with the camera, one after another.
 *
 * The frame on the camera is the answer panel's own shape, with its four
 * corners marked where the black squares go. The photo is read on the server
 * (`test-scan`); what was read is drawn back over the photo, every doubtful
 * row is yellow, and the teacher can tap any answer to correct it before
 * saving. Saving goes straight back to the camera for the next sheet.
 */
export default function ScanTestScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["tests", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "camera" });
  const [student, setStudent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const web = Platform.OS === "web";

  useEffect(() => {
    if (!id) return;
    loadTest(id).then((loaded) => { setTest(loaded.test); setQuestions(loaded.questions); }).catch((failure) => setError(asErrorMessage(failure)));
  }, [id]);

  const read = useCallback(async (uri: string, size: { width: number; height: number }) => {
    if (!id) return;
    setStage({ kind: "reading" });
    setSaved(null);
    try {
      const { outcome, uri: small } = await scanSheet(id, uri, size);
      if (!outcome.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setStage({ kind: "failed", message: outcome.error || t("scan.unreadable") });
        return;
      }
      void Haptics.notificationAsync(outcome.flags.some(Boolean) ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      setStage({ kind: "review", reading: outcome, uri: small, answers: outcome.answers });
    } catch (failure) {
      setStage({ kind: "failed", message: asErrorMessage(failure) });
    }
  }, [id, t]);

  async function capture() {
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) await read(photo.uri, { width: photo.width, height: photo.height });
    } catch (failure) {
      setStage({ kind: "failed", message: asErrorMessage(failure) });
    }
  }

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) await read(asset.uri, { width: asset.width, height: asset.height });
  }

  async function save() {
    if (stage.kind !== "review" || !id || !test) return;
    setSaving(true);
    try {
      const row = await saveResult(id, student, stage.answers, "scan");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaved(t("scan.saved", { name: row.student_name || t("results.noName"), score: row.score, total: row.total }));
      setStudent("");
      setStage({ kind: "camera" });
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  if (error && !test) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("scan.title")} onLeave={() => router.back()} />
        <ErrorState message={error} />
      </View>
    );
  }
  if (!test) return <View style={[styles.safe, styles.center]}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("scan.title")} subtitle={test.title} onLeave={() => router.back()} />

      {stage.kind === "camera" ? (
        <View style={styles.cameraStage}>
          {saved ? (
            <View style={styles.saved}><CheckCircle2 color={colors.success} size={18} /><Text style={styles.savedText}>{saved}</Text></View>
          ) : null}
          {web ? (
            <View style={[styles.center, { flex: 1, gap: spacing.lg, padding: spacing.xl }]}>
              <Text style={styles.tips}>{t("scan.web")}</Text>
              <PrimaryButton label={t("scan.choose")} icon={ImageIcon} onPress={() => void pick()} />
            </View>
          ) : !permission?.granted ? (
            <View style={[styles.center, { flex: 1, gap: spacing.lg, padding: spacing.xl }]}>
              <Text style={styles.tips}>{t("scan.permission")}</Text>
              <PrimaryButton label={t("scan.allow")} onPress={() => void requestPermission()} />
              <PrimaryButton label={t("scan.gallery")} icon={ImageIcon} tone="secondary" onPress={() => void pick()} />
            </View>
          ) : (
            <>
              <View style={styles.viewfinder}>
                <CameraView ref={camera} style={StyleSheetFill} facing="back" autofocus="on" />
                <Guide />
              </View>
              <Text style={styles.tips}>{t("scan.tips")}</Text>
              <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
                <View style={{ flex: 1 }}><PrimaryButton label={t("scan.gallery")} icon={ImageIcon} tone="secondary" onPress={() => void pick()} /></View>
                <View style={{ flex: 1.4 }}><PrimaryButton label={t("scan.capture")} icon={Camera} onPress={() => void capture()} /></View>
              </View>
            </>
          )}
        </View>
      ) : null}

      {stage.kind === "reading" ? (
        <View style={[styles.center, { flex: 1, gap: spacing.md }]}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.tips}>{t("scan.reading")}</Text>
        </View>
      ) : null}

      {stage.kind === "failed" ? (
        <View style={[styles.center, { flex: 1, gap: spacing.lg, padding: spacing.xl }]}>
          <InlineError message={stage.message} />
          <PrimaryButton label={t("scan.retake")} icon={RotateCcw} onPress={() => setStage({ kind: "camera" })} />
        </View>
      ) : null}

      {stage.kind === "review" ? (
        <Review
          test={test}
          questions={questions}
          stage={stage}
          student={student}
          onStudent={setStudent}
          onAnswers={(answers) => setStage({ ...stage, answers })}
          onRetake={() => setStage({ kind: "camera" })}
          onSave={() => void save()}
          saving={saving}
          bottom={insets.bottom}
        />
      ) : null}
    </View>
  );
}

const StyleSheetFill = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

/** The panel's outline, its corners marked: where the black squares should sit. */
function Guide() {
  const styles = useStyles();
  return (
    <View pointerEvents="none" style={styles.guideWrap}>
      <View style={styles.guide}>
        {(["tl", "tr", "br", "bl"] as const).map((corner) => <View key={corner} style={[styles.corner, styles[corner]]} />)}
      </View>
    </View>
  );
}

function Review({ test, questions, stage, student, onStudent, onAnswers, onRetake, onSave, saving, bottom }: {
  test: Test; questions: TestQuestion[]; stage: Extract<Stage, { kind: "review" }>; student: string; onStudent: (name: string) => void;
  onAnswers: (answers: (number | null)[]) => void; onRetake: () => void; onSave: () => void; saving: boolean; bottom: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const { width: screen } = useWindowDimensions();
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const keyAnswers = useMemo(() => questions.map((question) => question.correct), [questions]);
  const flags = stage.reading.flags.map((flag, question) => (touched.has(question) ? null : flag));
  const doubtful = flags.filter(Boolean).length;
  const score = previewScore(questions, stage.answers);
  const total = questions.length;
  const shown = Math.min(screen - spacing.xl * 2, 520);
  const scale = shown / stage.reading.image.width;
  const height = stage.reading.image.height * scale;

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(bottom, spacing.xl) + spacing.xl }]} keyboardShouldPersistTaps="handled">
      <View style={styles.scoreRow}>
        <Text style={styles.score}>{t("score", { score, total })}</Text>
        <Text style={styles.percent}>{t("percent", { percent: Math.round((score / Math.max(total, 1)) * 100) })}</Text>
      </View>
      <Text style={doubtful ? styles.flagNote : styles.cleanNote}>{doubtful ? t("scan.flagged", { count: doubtful }) : t("scan.clean")}</Text>

      <View style={{ width: shown, height, alignSelf: "center", borderRadius: radius.md, overflow: "hidden" }}>
        <Image source={{ uri: stage.uri }} style={{ width: shown, height }} resizeMode="stretch" />
        {stage.reading.bubbles.map((row, question) => row.map((bubble, option) => {
          const chosen = stage.answers[question] === option;
          const flagged = Boolean(flags[question]);
          if (!chosen && !flagged) return null;
          const r = Math.max(bubble.r * scale * 1.25, 5);
          const color = chosen ? (keyAnswers[question] === option ? colors.success : colors.danger) : colors.warning;
          return (
            <View
              key={`${question}-${option}`}
              pointerEvents="none"
              style={{ position: "absolute", left: bubble.x * scale - r, top: bubble.y * scale - r, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 2.5, borderColor: color }}
            />
          );
        }))}
      </View>

      <Text style={styles.label}>{t("scan.student")}</Text>
      <TextInput
        style={styles.input}
        value={student}
        onChangeText={onStudent}
        placeholder={t("scan.studentPlaceholder")}
        placeholderTextColor={colors.inkSoft}
        maxLength={120}
      />
      <TestAnswerGrid
        answers={stage.answers}
        options={test.option_count}
        keyAnswers={keyAnswers}
        flags={flags}
        onChange={(next, question) => { setTouched(new Set(touched).add(question)); onAnswers(next); }}
      />
      <PrimaryButton label={t("scan.save")} loading={saving} onPress={onSave} />
      <PrimaryButton label={t("scan.retake")} icon={RotateCcw} tone="ghost" disabled={saving} onPress={onRetake} />
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.md },
  cameraStage: { flex: 1, gap: spacing.md },
  viewfinder: { flex: 1, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#000" },
  guideWrap: { ...{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  guide: { width: "86%", maxHeight: "94%", aspectRatio: PANEL_RATIO, borderWidth: 1, borderColor: "rgba(255,255,255,0.45)", borderRadius: 8 },
  corner: { position: "absolute", width: 34, height: 34, borderColor: "#fff" },
  tl: { left: -2, top: -2, borderLeftWidth: 4, borderTopWidth: 4, borderTopLeftRadius: 8 },
  tr: { right: -2, top: -2, borderRightWidth: 4, borderTopWidth: 4, borderTopRightRadius: 8 },
  br: { right: -2, bottom: -2, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: 8 },
  bl: { left: -2, bottom: -2, borderLeftWidth: 4, borderBottomWidth: 4, borderBottomLeftRadius: 8 },
  tips: { ...typography.caption, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.xl },
  controls: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg },
  saved: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft,
  },
  savedText: { ...typography.bodyMedium, color: colors.success, flex: 1 },
  scoreRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  score: { ...typography.display, color: colors.ink },
  percent: { ...typography.title, color: colors.primary },
  flagNote: { ...typography.caption, color: colors.warning },
  cleanNote: { ...typography.caption, color: colors.success },
  label: { ...typography.bodyMedium, color: colors.ink, marginTop: spacing.sm },
  input: { ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
}));

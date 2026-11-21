import { CameraView } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Camera, CheckCircle2, ImageIcon, RotateCcw, SkipForward } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Platform, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { Easing, FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { TestAnswerGrid } from "@/components/TestAnswerGrid";
import { asErrorMessage } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { useReduceMotion } from "@/lib/motion";
import { forgetPicture } from "@/lib/omr/frame";
import { expectedSheet, type Answers, type LiveStatus } from "@/lib/omr/live";
import { prepareSpeech, speakScore, stopSpeaking } from "@/lib/omr/speech";
import { useLiveScan, type LiveCatch } from "@/lib/omr/useLiveScan";
import { loadTest, previewScore, saveResult, scanSheet, type ScanFlag, type ScanReading, type Test, type TestQuestion } from "@/lib/tests";
import { useScannerCamera } from "@/lib/useScannerCamera";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** The answer panel's shape, width to height (`test-sheet.ts`: 350 × 515). */
const PANEL_RATIO = 350 / 515;

/**
 * The capture size on the phone. Live frames need far less (`LIVE_SIDE`), but
 * the camera's full 12–48 MP makes every frame slow to take; 1080p is quick,
 * and still more than the 1600 px a photo for the server is cut down to.
 */
const PICTURE_SIZE = "1920x1080";

type Stage =
  | { kind: "camera" }
  | { kind: "reading" }
  /** Read live, every row clear: the score over the camera, to save or skip. */
  | { kind: "scored"; reading: ScanReading; uri: string; answers: Answers }
  /** The reading over its picture, to correct before saving: doubtful rows, a server photo, or asked for. */
  | { kind: "review"; reading: ScanReading; uri: string; answers: Answers; flags: ScanFlag[]; from: "live" | "photo" }
  | { kind: "failed"; message: string };

/**
 * Checking filled-in sheets with the camera, one after another.
 *
 * The camera reads on its own: held over a sheet, frames are read on the
 * phone (`useLiveScan`), and when two in a row agree the phone buzzes, shows
 * the score large and says it. The teacher types a name and saves, or skips,
 * and the camera is already looking for the next sheet. A sheet with doubtful
 * rows buzzes differently and opens the correction view instead, its rows in
 * yellow. When the phone cannot read at all, the old way takes over: a photo,
 * read on the server (`test-scan`). The gallery and the web always use it.
 *
 * Nothing keeps a picture of a sheet: live frames live in memory only, and a
 * photo's files are deleted once the teacher is done with them.
 */
export default function ScanTestScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, i18n } = useTranslation(["tests", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { granted, ask, live } = useScannerCamera();
  const camera = useRef<CameraView | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "camera" });
  const [student, setStudent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** "photo" once reading on the phone has failed outright: the server reads, as before. */
  const [mode, setMode] = useState<"live" | "photo">("live");
  const web = Platform.OS === "web";

  useEffect(() => {
    if (!id) return;
    loadTest(id).then((loaded) => { setTest(loaded.test); setQuestions(loaded.questions); }).catch((failure) => setError(asErrorMessage(failure)));
  }, [id]);

  useEffect(() => { prepareSpeech(); }, []);
  useFocusEffect(useCallback(() => () => stopSpeaking(), []));

  const cameraShown = !web && live && (stage.kind === "camera" || stage.kind === "scored");
  // A camera mounted again has to say it is ready again before frames are taken.
  useEffect(() => { if (!cameraShown) setReady(false); }, [cameraShown]);

  const expect = useMemo(() => (test && test.question_count > 0 ? expectedSheet(test) : null), [test]);
  const total = questions.length;

  function caught({ verdict, reading, frame }: LiveCatch) {
    const uri = `data:image/jpeg;base64,${frame.base64}`;
    setSaved(null);
    setSaveError(null);
    if (verdict.kind === "clean") {
      haptic.success();
      const score = previewScore(questions, verdict.answers);
      void speakScore({ score, total, language: i18n.language, sentence: t("scan.live.spoken", { score, total }) });
      setStage({ kind: "scored", reading, uri, answers: verdict.answers });
    } else {
      haptic.warning();
      setStage({ kind: "review", reading, uri, answers: verdict.answers, flags: verdict.flags, from: "live" });
    }
  }

  const scanner = useLiveScan({
    camera,
    enabled: mode === "live" && cameraShown && ready && stage.kind === "camera",
    expect,
    onCatch: caught,
    onFallBack: () => setMode("photo"),
  });

  /** A photo read on the server: the gallery, the web, and the camera when the phone cannot read. */
  async function read(uri: string, size: { width: number; height: number }) {
    if (!id) return;
    setStage({ kind: "reading" });
    setSaved(null);
    setSaveError(null);
    try {
      const { outcome, uri: small } = await scanSheet(id, uri, size);
      if (!outcome.ok) {
        haptic.error();
        setStage({ kind: "failed", message: outcome.error || t("scan.unreadable") });
        return;
      }
      if (outcome.flags.some(Boolean)) haptic.warning();
      else haptic.success();
      scanner.handled(outcome.answers);
      setStage({ kind: "review", reading: outcome, uri: small, answers: outcome.answers, flags: outcome.flags, from: "photo" });
    } catch (failure) {
      setStage({ kind: "failed", message: asErrorMessage(failure) });
    }
  }

  /** A full photo for the server. The live loop is stopped first: the camera takes one picture at a time. */
  async function capture() {
    await scanner.hold();
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) await read(photo.uri, { width: photo.width, height: photo.height });
    } catch (failure) {
      setStage({ kind: "failed", message: asErrorMessage(failure) });
    } finally {
      scanner.release();
    }
  }

  async function pick() {
    await scanner.hold();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) await read(asset.uri, { width: asset.width, height: asset.height });
    } finally {
      scanner.release();
    }
  }

  /**
   * Back to the camera for the next sheet; the one just shown is not announced
   * again. The score being said is left to finish: a quick "save" is the
   * usual answer to it, and cutting it off mid-number would only confuse.
   */
  function next() {
    setStudent("");
    setSaveError(null);
    setStage({ kind: "camera" });
  }

  async function save() {
    if ((stage.kind !== "review" && stage.kind !== "scored") || !id) return;
    setSaving(true);
    setSaveError(null);
    try {
      const row = await saveResult(id, student, stage.answers, "scan");
      haptic.success();
      setSaved(t("scan.saved", { name: row.student_name || t("results.noName"), score: row.score, total: row.total }));
      next();
    } catch (failure) {
      setSaveError(asErrorMessage(failure));
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

  const bottom = Math.max(insets.bottom, spacing.lg);
  // A test with no questions yet has nothing to check a sheet against here; the server says so.
  const photoMode = mode === "photo" || !expect;
  const offerPhoto = photoMode || scanner.suggestPhoto;
  const statusLine = photoMode
    ? t("scan.live.photoMode")
    : scanner.status === "fit" && scanner.suggestPhoto ? t("scan.live.hard") : t(STATUS_TEXT[scanner.status]);

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("scan.title")} subtitle={test.title} onLeave={() => router.back()} />

      {stage.kind === "camera" || stage.kind === "scored" ? (
        <KeyboardAvoidingView behavior="padding" style={styles.cameraStage}>
          {saved && stage.kind === "camera" ? (
            <View style={styles.saved}><CheckCircle2 color={colors.success} size={18} /><Text style={styles.savedText}>{saved}</Text></View>
          ) : null}
          {web ? (
            <View style={[styles.center, { flex: 1, gap: spacing.lg, padding: spacing.xl }]}>
              <Text style={styles.tips}>{t("scan.web")}</Text>
              <PrimaryButton label={t("scan.choose")} icon={ImageIcon} onPress={() => void pick()} />
            </View>
          ) : !granted ? (
            <View style={[styles.center, { flex: 1, gap: spacing.lg, padding: spacing.xl }]}>
              <Text style={styles.tips}>{t("scan.permission")}</Text>
              <PrimaryButton label={t("scan.allow")} onPress={() => void ask()} />
              <PrimaryButton label={t("scan.gallery")} icon={ImageIcon} tone="secondary" onPress={() => void pick()} />
            </View>
          ) : (
            <>
              <View style={styles.viewfinder}>
                {cameraShown ? (
                  <CameraView
                    ref={camera}
                    style={StyleSheetFill}
                    facing="back"
                    autofocus="on"
                    animateShutter={false}
                    pictureSize={PICTURE_SIZE}
                    onCameraReady={() => setReady(true)}
                  />
                ) : null}
                <Guide found={!photoMode && (scanner.status === "reading" || stage.kind === "scored")} />
                {stage.kind === "scored" ? (
                  <ScoreOverlay score={previewScore(questions, stage.answers)} total={total} reduceMotion={reduceMotion} />
                ) : (
                  <StatusLine text={statusLine} busy={!photoMode && scanner.status === "reading"} />
                )}
              </View>

              {stage.kind === "scored" ? (
                <View style={[styles.panel, { paddingBottom: bottom }]}>
                  <TextInput
                    style={styles.input}
                    value={student}
                    onChangeText={setStudent}
                    placeholder={t("scan.studentPlaceholder")}
                    placeholderTextColor={colors.inkSoft}
                    accessibilityLabel={t("scan.student")}
                    maxLength={120}
                    returnKeyType="done"
                  />
                  {saveError ? <InlineError message={saveError} /> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}><PrimaryButton label={t("scan.live.skip")} icon={SkipForward} tone="secondary" disabled={saving} onPress={next} /></View>
                    <View style={{ flex: 1.4 }}><PrimaryButton label={t("scan.save")} loading={saving} onPress={() => void save()} /></View>
                  </View>
                  <PrimaryButton
                    label={t("scan.live.details")}
                    tone="ghost"
                    disabled={saving}
                    onPress={() => setStage({ kind: "review", reading: stage.reading, uri: stage.uri, answers: stage.answers, flags: stage.reading.flags, from: "live" })}
                  />
                </View>
              ) : (
                <>
                  <Text style={styles.tips}>{photoMode ? t("scan.tips") : t("scan.live.tips")}</Text>
                  <View style={[styles.row, styles.controls, { paddingBottom: bottom }]}>
                    <View style={{ flex: 1 }}><PrimaryButton label={t("scan.gallery")} icon={ImageIcon} tone="secondary" onPress={() => void pick()} /></View>
                    {offerPhoto ? (
                      <View style={{ flex: 1.4 }}>
                        <PrimaryButton label={t("scan.capture")} icon={Camera} tone={photoMode ? "primary" : "secondary"} disabled={!ready} onPress={() => void capture()} />
                      </View>
                    ) : null}
                  </View>
                </>
              )}
            </>
          )}
        </KeyboardAvoidingView>
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
          <PrimaryButton label={t("scan.retake")} icon={RotateCcw} onPress={next} />
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
          onLeave={next}
          onSave={() => void save()}
          saving={saving}
          saveError={saveError}
          bottom={insets.bottom}
        />
      ) : null}
    </View>
  );
}

const StyleSheetFill = { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } as const;

/** What the line under the frame says for each state of the live reader. */
const STATUS_TEXT = {
  fit: "scan.live.fit", reading: "scan.live.reading", other: "scan.live.other", next: "scan.live.next",
} as const satisfies Record<LiveStatus, string>;

/** The panel's outline, its corners marked: where the black squares should sit. Green while a sheet is being read. */
function Guide({ found }: { found: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const tint = found ? { borderColor: colors.success } : null;
  return (
    <View pointerEvents="none" style={styles.guideWrap}>
      <View style={styles.guide}>
        {(["tl", "tr", "br", "bl"] as const).map((corner) => <View key={corner} style={[styles.corner, styles[corner], tint]} />)}
      </View>
    </View>
  );
}

/** The small line under the frame that says what the camera is doing. */
function StatusLine({ text, busy }: { text: string; busy: boolean }) {
  const styles = useStyles();
  return (
    <View pointerEvents="none" style={styles.statusWrap}>
      <View style={styles.status} accessibilityLiveRegion="polite">
        {busy ? <ActivityIndicator color="#fff" size="small" /> : null}
        <Text style={styles.statusText}>{text}</Text>
      </View>
    </View>
  );
}

/** The score, large over the camera, as soon as a sheet is read. */
function ScoreOverlay({ score, total, reduceMotion }: { score: number; total: number; reduceMotion: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const percent = Math.round((score / Math.max(total, 1)) * 100);
  return (
    <Animated.View
      pointerEvents="none"
      entering={reduceMotion ? undefined : FadeIn.duration(180).easing(Easing.out(Easing.cubic))}
      style={styles.scrim}
      accessibilityLiveRegion="assertive"
    >
      <CheckCircle2 color="#fff" size={36} strokeWidth={2.2} />
      <Text style={styles.bigScore} adjustsFontSizeToFit numberOfLines={1}>{t("score", { score, total })}</Text>
      <Text style={styles.bigPercent}>{t("percent", { percent })}</Text>
    </Animated.View>
  );
}

function Review({ test, questions, stage, student, onStudent, onAnswers, onLeave, onSave, saving, saveError, bottom }: {
  test: Test; questions: TestQuestion[]; stage: Extract<Stage, { kind: "review" }>; student: string; onStudent: (name: string) => void;
  onAnswers: (answers: Answers) => void; onLeave: () => void; onSave: () => void; saving: boolean; saveError: string | null; bottom: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const { width: screen } = useWindowDimensions();
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const keyAnswers = useMemo(() => questions.map((question) => question.correct), [questions]);
  const flags = stage.flags.map((flag, question) => (touched.has(question) ? null : flag));
  const doubtful = flags.filter(Boolean).length;
  const score = previewScore(questions, stage.answers);
  const total = questions.length;
  const shown = Math.min(screen - spacing.xl * 2, 520);
  const scale = shown / stage.reading.image.width;
  const height = stage.reading.image.height * scale;

  // The picture goes when the teacher is done with this sheet, however they leave it.
  useEffect(() => () => { void forgetPicture(stage.uri); }, [stage.uri]);

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
      {saveError ? <InlineError message={saveError} /> : null}
      <PrimaryButton label={t("scan.save")} loading={saving} onPress={onSave} />
      <PrimaryButton
        label={stage.from === "live" ? t("scan.live.skip") : t("scan.retake")}
        icon={stage.from === "live" ? SkipForward : RotateCcw}
        tone="ghost"
        disabled={saving}
        onPress={onLeave}
      />
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
  statusWrap: { position: "absolute", left: 0, right: 0, bottom: spacing.md, alignItems: "center", paddingHorizontal: spacing.lg },
  status: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: "rgba(0,0,0,0.62)",
  },
  statusText: { ...typography.caption, color: "#fff", textAlign: "center", flexShrink: 1 },
  scrim: {
    position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center",
    gap: spacing.xs, paddingHorizontal: spacing.xl, backgroundColor: "rgba(0,0,0,0.6)",
  },
  bigScore: { ...typography.display, fontSize: 72, lineHeight: 80, letterSpacing: -1.5, color: "#fff" },
  bigPercent: { ...typography.title, color: "rgba(255,255,255,0.86)" },
  tips: { ...typography.caption, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.xl },
  row: { flexDirection: "row", gap: spacing.sm },
  controls: { paddingHorizontal: spacing.lg },
  panel: { gap: spacing.sm, paddingHorizontal: spacing.lg },
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

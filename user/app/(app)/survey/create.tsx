import { DATA_COLLECTION_MODULE } from "@jaxongirman/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { BookmarkPlus, Plus, Send } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { PrimaryButton } from "@/components/PrimaryButton";
import {
  QuestionEditor, blankQuestion, firstQuestionProblem, makeKey, toPayload,
  type DraftQuestion,
} from "@/components/QuestionEditor";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { useSuccessToast } from "@/components/SuccessToast";
import { formatClock, formatDate, useNow } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { moduleGate, useModuleAccess } from "@/lib/modules";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Deadlines people actually choose, plus a typed date for everything else. */
const DEADLINE_PRESETS = [
  { label: "d1", days: 1 },
  { label: "d3", days: 3 },
  { label: "w1", days: 7 },
  { label: "w2", days: 14 },
  { label: "m1", days: 30 },
] as const;

function addDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** "09.08.2026 18:00" → Date, or null. Deliberately strict about the shape. */
function parseTypedDeadline(value: string): Date | null {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const [, day, month, year, hour = "23", minute = "59"] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The survey builder.
 *
 * The whole draft lives in component state and reaches the database exactly
 * once, through `save_survey_form()`, which rewrites the form and its questions
 * in a single transaction. Nothing is written per keystroke, so an abandoned
 * build leaves nothing behind either.
 */
export default function SurveyBuilderScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["survey", "common"]);
  const notify = useSuccessToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; templateId?: string }>();
  const formId = typeof params.id === "string" ? params.id : null;
  const { state: access } = useModuleAccess(DATA_COLLECTION_MODULE);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacyNote, setPrivacyNote] = useState("");
  const [expected, setExpected] = useState("");
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [deadlineText, setDeadlineText] = useState("");
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);

  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(Boolean(formId));
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);

  const load = useCallback(async () => {
    if (!formId) return;
    setLoading(true);
    try {
      const [formResult, questionResult] = await Promise.all([
        supabase.from("survey_forms").select("*").eq("id", formId).single(),
        supabase.from("survey_questions").select("*").eq("form_id", formId).order("position"),
      ]);
      if (formResult.error) throw formResult.error;
      if (questionResult.error) throw questionResult.error;

      const form = formResult.data;
      setTitle(form.title);
      setDescription(form.description);
      setPrivacyNote(form.privacy_note);
      setExpected(form.expected_participants ? String(form.expected_participants) : "");
      setDeadline(form.deadline ? new Date(form.deadline) : null);
      // Once anyone has answered, the question set is frozen: an answer row
      // points at a question id, and rewriting the set would leave results that
      // no longer mean what they say. The server enforces this too.
      setLocked(form.submitted_count > 0);

      const rows = questionResult.data ?? [];
      const optionsResult = rows.length
        ? await supabase.from("survey_question_options").select("*").in("question_id", rows.map((row) => row.id)).order("position")
        : { data: [], error: null };
      if (optionsResult.error) throw optionsResult.error;

      setQuestions(rows.map((row) => ({
        key: row.id,
        type: row.type,
        label: row.label,
        helper_text: row.helper_text,
        is_required: row.is_required,
        latin_only: row.latin_only,
        config: (row.config ?? {}) as DraftQuestion["config"],
        options: (optionsResult.data ?? [])
          .filter((option) => option.question_id === row.id)
          .map((option) => ({ key: option.id, label: option.label })),
      })));
      setLoadError(null);
    } catch (nextError) {
      setLoadError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => { void load(); }, [load]);

  // Arriving from a template pre-fills the builder without creating anything.
  const templateId = typeof params.templateId === "string" ? params.templateId : null;
  useEffect(() => {
    if (!templateId) return;
    let active = true;
    void (async () => {
      const [templateResult, questionResult] = await Promise.all([
        supabase.from("survey_templates").select("name,description").eq("id", templateId).single(),
        supabase.from("survey_template_questions").select("*").eq("template_id", templateId).order("position"),
      ]);
      if (!active || templateResult.error || questionResult.error) return;
      setTitle((current) => current || templateResult.data.name);
      setQuestions((questionResult.data ?? []).map((row) => ({
        key: makeKey(),
        type: row.type,
        label: row.label,
        helper_text: row.helper_text,
        is_required: row.is_required,
        latin_only: row.latin_only,
        config: (row.config ?? {}) as DraftQuestion["config"],
        options: Array.isArray(row.options)
          ? (row.options as { label?: string }[]).map((option) => ({ key: makeKey(), label: String(option?.label ?? "") }))
          : [],
      })));
    })();
    return () => { active = false; };
  }, [templateId]);

  const creatorGate = moduleGate(access, "creator");
  // Half a minute is enough resolution for "is this deadline still ahead of us".
  const now = useNow(deadline !== null, 30_000);

  const problem = useMemo(() => {
    if (title.trim().length < 3) return t("builder.needTitle");
    if (deadline && deadline.getTime() <= now) return t("builder.needFuture");
    return locked ? null : firstQuestionProblem(questions);
  }, [deadline, locked, now, questions, t, title]);

  function moveQuestion(from: number, to: number) {
    if (to < 0 || to >= questions.length) return;
    setQuestions((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  async function persist(): Promise<string | null> {
    const expectedCount = Number.parseInt(expected.replace(/[^0-9]/g, ""), 10);
    const { data, error: saveError } = await supabase.rpc("save_survey_form", {
      // Null means "create". The generated signature types every argument as
      // non-null because Postgres reports no default for this one, but the
      // function's whole create path is `p_form_id is null`.
      p_form_id: formId as unknown as string,
      p_title: title.trim(),
      p_description: description.trim(),
      p_deadline: deadline ? deadline.toISOString() : undefined,
      p_expected_participants: Number.isFinite(expectedCount) && expectedCount > 0 ? expectedCount : undefined,
      p_privacy_note: privacyNote.trim(),
      // A frozen question set is left alone; passing null tells the server to
      // update only the form's own fields.
      p_questions: locked ? undefined : (toPayload(questions) as never),
    });
    if (saveError) {
      setError(asErrorMessage(saveError));
      return null;
    }
    return data as string;
  }

  async function saveDraft() {
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    const id = await persist();
    setSaving(false);
    if (id) router.replace({ pathname: "/(app)/survey/results/[id]", params: { id } });
  }

  async function publish() {
    if (problem) { setError(problem); return; }
    setPublishing(true); setError(null);
    const id = await persist();
    if (!id) { setPublishing(false); return; }
    const { error: statusError } = await supabase.rpc("set_survey_status", { p_form_id: id, p_status: "open" });
    setPublishing(false);
    if (statusError) { setError(asErrorMessage(statusError)); return; }
    router.replace({ pathname: "/(app)/survey/results/[id]", params: { id } });
  }

  function openTemplateSheet() {
    const questionProblem = firstQuestionProblem(questions);
    if (questionProblem) { setError(questionProblem); return; }
    setTemplateName(title.trim());
    setTemplateOpen(true);
  }

  async function saveAsTemplate() {
    if (templateName.trim() === "") return;
    setTemplateSaving(true);
    const { error: templateError } = await supabase.rpc("save_survey_template", {
      // Explicitly null: an omitted key is dropped from the body, and this
      // parameter has no default, so the call could never be resolved.
      p_template_id: null as unknown as string,
      p_name: templateName.trim(),
      p_description: description.trim(),
      p_questions: toPayload(questions) as never,
    });
    setTemplateSaving(false);
    if (templateError) { setError(asErrorMessage(templateError)); return; }
    setTemplateOpen(false);
    notify(t("builder.templateSaved"), t("builder.templateSavedBody"));
  }

  function confirmLeave() {
    if (!title && questions.every((question) => question.label === "")) { router.back(); return; }
    Alert.alert(t("builder.leaveTitle"), t("builder.leaveBody"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("builder.leave"), style: "destructive", onPress: () => router.back() },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("builder.title")} variant="close" onLeave={() => router.back()} />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("builder.title")} variant="close" onLeave={() => router.back()} />
        <View style={styles.content}><ErrorState message={loadError} onRetry={() => void load()} /></View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={formId ? t("builder.edit") : t("newSurvey")}
        subtitle={locked ? t("builder.locked") : undefined}
        variant="close"
        onLeave={confirmLeave}
      />

      <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!creatorGate.allowed ? <InlineError message={creatorGate.reason ?? ""} /> : null}

        <View style={styles.block}>
          <Text style={styles.label}>{t("builder.name")}</Text>
          <TextInput
            value={title}
            onChangeText={(value) => setTitle(value.slice(0, 120))}
            placeholder={t("builder.namePlaceholder")}
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{t("builder.description")}</Text>
          <TextInput
            value={description}
            onChangeText={(value) => setDescription(value.slice(0, 1000))}
            placeholder={t("builder.descriptionPlaceholder")}
            placeholderTextColor={colors.inkSoft}
            multiline
            style={[styles.input, styles.multiline]}
          />
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{t("builder.deadline")}</Text>
          <View style={styles.presets}>
            {DEADLINE_PRESETS.map((preset) => {
              const target = addDays(preset.days);
              const active = deadline !== null && Math.abs(deadline.getTime() - target.getTime()) < 60_000;
              return (
                <Pressable
                  key={preset.label}
                  accessibilityRole="button"
                  onPress={() => { setDeadline(target); setDeadlineText(""); }}
                  style={[styles.preset, active && styles.presetActive]}
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>{t(`builder.preset.${preset.label}`)}</Text>
                </Pressable>
              );
            })}
            <Pressable accessibilityRole="button" onPress={() => { setDeadline(null); setDeadlineText(""); }} style={[styles.preset, deadline === null && styles.presetActive]}>
              <Text style={[styles.presetText, deadline === null && styles.presetTextActive]}>{t("builder.noDeadline")}</Text>
            </Pressable>
          </View>
          <TextInput
            value={deadlineText}
            onChangeText={(value) => {
              setDeadlineText(value);
              const parsed = parseTypedDeadline(value);
              if (parsed) setDeadline(parsed);
            }}
            placeholder={t("builder.typed")}
            placeholderTextColor={colors.inkSoft}
            keyboardType="numbers-and-punctuation"
            style={styles.input}
          />
          <Text style={styles.hint}>
            {deadline ? t("builder.ends", { date: formatDate(deadline), time: formatClock(deadline) }) : t("builder.openEnded")}
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{t("builder.expected")}</Text>
          <TextInput
            value={expected}
            onChangeText={(value) => setExpected(value.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder={t("builder.expectedPlaceholder")}
            placeholderTextColor={colors.inkSoft}
            keyboardType="number-pad"
            style={styles.input}
          />
          <Text style={styles.hint}>{t("builder.expectedHint")}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>{t("builder.privacy")}</Text>
          <TextInput
            value={privacyNote}
            onChangeText={(value) => setPrivacyNote(value.slice(0, 600))}
            placeholder={t("builder.privacyPlaceholder")}
            placeholderTextColor={colors.inkSoft}
            multiline
            style={[styles.input, styles.multiline]}
          />
          <Text style={styles.hint}>
            {t("builder.retention", { hours: access?.retention_hours ?? 48 })}
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("builder.questions")}</Text>
          <Text style={styles.sectionCount}>{questions.length}</Text>
        </View>

        {locked ? (
          <Text style={styles.lockedNote}>
            {t("builder.lockedNote")}
          </Text>
        ) : null}

        <View style={styles.questionList}>
          {questions.map((question, index) => (
            <View key={question.key} pointerEvents={locked ? "none" : "auto"} style={locked ? styles.lockedCard : undefined}>
              <QuestionEditor
                question={question}
                index={index}
                total={questions.length}
                onChange={(next) => setQuestions((current) => current.map((item) => item.key === question.key ? next : item))}
                onRemove={() => setQuestions((current) => (current.length > 1 ? current.filter((item) => item.key !== question.key) : current))}
                onDuplicate={() => setQuestions((current) => {
                  const copy = { ...question, key: makeKey(), options: question.options.map((option) => ({ ...option, key: makeKey() })) };
                  const next = [...current];
                  next.splice(index + 1, 0, copy);
                  return next;
                })}
                onMove={(to) => moveQuestion(index, to)}
              />
            </View>
          ))}
        </View>

        {!locked ? (
          <Pressable accessibilityRole="button" onPress={() => setQuestions((current) => [...current, blankQuestion()])} style={styles.addQuestion}>
            <Plus color={colors.primary} size={icon.sm} strokeWidth={2.4} />
            <Text style={styles.addQuestionText}>{t("builder.addQuestion")}</Text>
          </Pressable>
        ) : null}

        {error ? <InlineError message={error} /> : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={t("builder.saveClose")}
            tone="secondary"
            loading={saving}
            disabled={!creatorGate.allowed || publishing}
            onPress={() => void saveDraft()}
          />
          <PrimaryButton
            label={t("builder.publish")}
            icon={Send}
            loading={publishing}
            disabled={!creatorGate.allowed || saving}
            onPress={() => void publish()}
          />
          {!locked ? (
            <Pressable accessibilityRole="button" onPress={openTemplateSheet} style={styles.templateButton}>
              <BookmarkPlus color={colors.primary} size={icon.sm} strokeWidth={2.2} />
              <Text style={styles.templateText}>{t("builder.saveTemplate")}</Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      {/* A named prompt rather than Alert.prompt, which exists only on iOS. */}
      <Modal visible={templateOpen} transparent animationType="fade" onRequestClose={() => setTemplateOpen(false)}>
        {/* Above the keyboard on both platforms: Android draws a Modal edge to edge, where the system no longer resizes it. */}
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common:close")} onPress={() => setTemplateOpen(false)} style={styles.backdrop}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{t("builder.templateName")}</Text>
            <Text style={styles.sheetCopy}>{t("builder.templateBody")}</Text>
            <TextInput
              value={templateName}
              onChangeText={(value) => setTemplateName(value.slice(0, 120))}
              placeholder={t("builder.templatePlaceholder")}
              placeholderTextColor={colors.inkSoft}
              autoFocus
              style={styles.input}
            />
            <PrimaryButton
              label={t("builder.templateSave")}
              loading={templateSaving}
              disabled={templateName.trim() === ""}
              onPress={() => void saveAsTemplate()}
            />
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  block: { gap: spacing.sm },
  label: { ...typography.bodyMedium, color: colors.ink },
  input: {
    ...typography.body, color: colors.ink, minHeight: 52,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  multiline: { minHeight: 92, textAlignVertical: "top" },
  hint: { ...typography.caption, color: colors.inkSoft, lineHeight: 17 },

  presets: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  preset: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  presetActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { ...typography.caption, color: colors.inkMuted },
  presetTextActive: { color: colors.onPrimary },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  lockedNote: { ...typography.caption, color: colors.warning, lineHeight: 18, backgroundColor: colors.warningSoft, padding: spacing.md, borderRadius: radius.md },
  lockedCard: { opacity: 0.6 },

  questionList: { gap: spacing.md },
  addQuestion: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed", backgroundColor: colors.surface },
  addQuestionText: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },

  actions: { gap: spacing.md, marginTop: spacing.sm },
  templateButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.md },
  templateText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },

  backdrop: { flex: 1, backgroundColor: "rgba(21,14,36,.45)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  sheet: { alignSelf: "stretch", gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  sheetTitle: { ...typography.heading, color: colors.ink },
  sheetCopy: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
}));

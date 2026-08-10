import { LATIN_ONLY_ERROR, formatUzPhone, isLatinText, normalizeUzPhone, type SurveyQuestionType } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, CircleCheck, Clock, ImagePlus, Lock, ShieldCheck, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CountdownText } from "@/components/SurveyCard";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { formatShortDateTime, useNow } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { formatBytes } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

type OpenQuestion = {
  id: string;
  type: SurveyQuestionType;
  label: string;
  helper_text: string;
  is_required: boolean;
  latin_only: boolean;
  config: { min?: number; max?: number; max_length?: number };
  options: { id: string; label: string }[];
};

type OpenForm = {
  id: string;
  title: string;
  description: string;
  status: "draft" | "open" | "closed";
  deadline: string | null;
  privacy_note: string;
  retention_hours: number;
  expected_participants: number | null;
  submitted_count: number;
  is_owner: boolean;
  owner_name: string;
};

type OpenPayload = { form: OpenForm; questions: OpenQuestion[]; already_submitted_at: string | null };

/** A picked image, still on the device. It reaches storage only at submit time. */
type PendingImage = { uri: string; mimeType: string; sizeBytes: number; extension: string };

type AnswerValue = {
  text?: string;
  number?: string;
  date?: string;
  optionIds?: string[];
  image?: PendingImage | null;
};

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_HELP = "Rasm hajmini kamaytirish uchun uni Telegram’dagi “Saqlangan xabarlar”ga yuborib, qayta yuklab olishingiz mumkin.";

function extensionFor(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Answering a survey, reachable from `jaxongirman://survey/<id>`.
 *
 * Nothing typed here touches the server until the final submit. Answers live in
 * component state, a chosen image stays on the device as a local URI, and one
 * call — `submit_survey_response()` — writes the response, its answers and its
 * files together or not at all. Abandon the form and the server never heard of
 * you; that is the privacy rule, implemented rather than promised.
 */
export default function SurveyRespondScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const formId = typeof params.id === "string" ? params.id : "";

  const [payload, setPayload] = useState<OpenPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ expiresAt: string | null } | null>(null);
  const [idempotencyKey] = useState(() => Crypto.randomUUID());
  // Drives the deadline check: the form must lock itself the moment time runs
  // out, not only when the person next navigates.
  const now = useNow(true, 1000);

  const load = useCallback(async () => {
    if (!formId) { setLoadError("So‘rovnoma manzili noto‘g‘ri."); setLoading(false); return; }
    setLoading(true);
    const { data, error: requestError } = await supabase.rpc("open_survey", { p_form_id: formId });
    if (requestError) {
      setLoadError(asErrorMessage(requestError));
    } else {
      setPayload(data as unknown as OpenPayload);
      setLoadError(null);
    }
    setLoading(false);
  }, [formId]);

  useEffect(() => { void load(); }, [load]);

  // Memoised so the two validation memos below do not see a new array identity
  // on every keystroke.
  const questions = useMemo(() => payload?.questions ?? [], [payload]);
  const form = payload?.form ?? null;

  const answeredCount = useMemo(() => questions.filter((question) => {
    const value = answers[question.id];
    if (!value) return false;
    switch (question.type) {
      case "image": return Boolean(value.image);
      case "single_choice":
      case "multi_choice": return (value.optionIds?.length ?? 0) > 0;
      case "number": return (value.number ?? "").trim() !== "";
      case "date": return (value.date ?? "").trim() !== "";
      default: return (value.text ?? "").trim() !== "";
    }
  }).length, [answers, questions]);

  function patch(questionId: string, changes: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: { ...current[questionId], ...changes } }));
  }

  /** The first thing the server would reject, found before the round trip. */
  const validation = useMemo<string | null>(() => {
    for (const question of questions) {
      const value = answers[question.id] ?? {};
      const text = (value.text ?? "").trim();

      if (question.type === "short_text" || question.type === "long_text") {
        if (question.is_required && text === "") return `Savolga javob bering: ${question.label}`;
        if (question.latin_only && !isLatinText(text)) return `${LATIN_ONLY_ERROR} (${question.label})`;
      } else if (question.type === "phone") {
        if (text === "") { if (question.is_required) return `Savolga javob bering: ${question.label}`; }
        else if (!normalizeUzPhone(text)) return `Telefon raqamni +998 formatida kiriting: ${question.label}`;
      } else if (question.type === "number") {
        const raw = (value.number ?? "").trim();
        if (raw === "") { if (question.is_required) return `Savolga javob bering: ${question.label}`; }
        else {
          const parsed = Number(raw.replace(",", "."));
          if (!Number.isFinite(parsed)) return `Raqam kiriting: ${question.label}`;
          if (question.config.min !== undefined && parsed < question.config.min) return `Qiymat ${question.config.min} dan kichik bo‘lmasin: ${question.label}`;
          if (question.config.max !== undefined && parsed > question.config.max) return `Qiymat ${question.config.max} dan katta bo‘lmasin: ${question.label}`;
        }
      } else if (question.type === "date") {
        if (question.is_required && !(value.date ?? "").trim()) return `Savolga javob bering: ${question.label}`;
      } else if (question.type === "single_choice" || question.type === "multi_choice") {
        if (question.is_required && (value.optionIds?.length ?? 0) === 0) return `Savolga javob bering: ${question.label}`;
      } else if (question.type === "image") {
        if (question.is_required && !value.image) return `Savolga javob bering: ${question.label}`;
        if (value.image && value.image.sizeBytes > MAX_IMAGE_BYTES) return "Rasm hajmi 3 MB dan kichik bo‘lishi kerak.";
      }
    }
    return null;
  }, [answers, questions]);

  async function pickImage(question: OpenQuestion) {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;

    const mimeType = asset.mimeType && /image\/(jpeg|jpg|png|webp)/.test(asset.mimeType) ? asset.mimeType : "image/jpeg";
    // `fileSize` is not reported on every platform, so the blob is the only
    // number that can be trusted before anything is uploaded.
    let sizeBytes = asset.fileSize ?? 0;
    if (!sizeBytes) {
      const response = await fetch(asset.uri);
      sizeBytes = (await response.blob()).size;
    }
    if (sizeBytes > MAX_IMAGE_BYTES) {
      Alert.alert("Rasm hajmi katta", `Rasm hajmi 3 MB dan kichik bo‘lishi kerak. Tanlangan rasm: ${formatBytes(sizeBytes)}.\n\n${IMAGE_HELP}`);
      return;
    }
    patch(question.id, { image: { uri: asset.uri, mimeType, sizeBytes, extension: extensionFor(mimeType) } });
  }

  async function submit() {
    if (!user || !form) return;
    if (validation) { setError(validation); return; }
    setSubmitting(true);
    setError(null);

    const uploaded: string[] = [];
    try {
      const items: { question_id: string; text?: string; number?: string; date?: string; option_ids?: string[]; files?: { path: string; mime_type: string; size_bytes: number }[] }[] = [];

      for (const question of questions) {
        const value = answers[question.id];
        if (!value) continue;

        if (question.type === "image") {
          if (!value.image) continue;
          // Uploaded here, at the last possible moment, so a form that is
          // abandoned before this point leaves no object in the bucket.
          const path = `${user.id}/${form.id}/${Crypto.randomUUID()}.${value.image.extension}`;
          const response = await fetch(value.image.uri);
          const blob = await response.blob();
          const { error: uploadError } = await supabase.storage.from("survey-uploads").upload(path, blob, { contentType: value.image.mimeType, upsert: false });
          if (uploadError) throw uploadError;
          uploaded.push(path);
          items.push({ question_id: question.id, files: [{ path, mime_type: value.image.mimeType, size_bytes: value.image.sizeBytes }] });
        } else if (question.type === "phone") {
          const normalized = normalizeUzPhone(value.text ?? "");
          if (normalized) items.push({ question_id: question.id, text: normalized });
        } else if (question.type === "number") {
          if ((value.number ?? "").trim() !== "") items.push({ question_id: question.id, number: (value.number ?? "").replace(",", ".") });
        } else if (question.type === "date") {
          if ((value.date ?? "").trim() !== "") items.push({ question_id: question.id, date: value.date });
        } else if (question.type === "single_choice" || question.type === "multi_choice") {
          if ((value.optionIds?.length ?? 0) > 0) items.push({ question_id: question.id, option_ids: value.optionIds });
        } else if ((value.text ?? "").trim() !== "") {
          items.push({ question_id: question.id, text: (value.text ?? "").trim() });
        }
      }

      const { data, error: submitError } = await supabase.rpc("submit_survey_response", {
        p_form_id: form.id,
        p_answers: items as never,
        p_idempotency_key: idempotencyKey,
      });
      if (submitError) throw submitError;

      const result = data as unknown as { applied?: boolean; expires_at?: string | null };
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone({ expiresAt: result?.expires_at ?? null });
    } catch (nextError) {
      // The response was never written, so the images that went up for it are
      // orphans. Remove them rather than leave answer data with no answer.
      if (uploaded.length > 0) void supabase.storage.from("survey-uploads").remove(uploaded);
      setError(asErrorMessage(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="So‘rovnoma" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (loadError || !form) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="So‘rovnoma" />
        <View style={styles.content}><ErrorState message={loadError ?? "So‘rovnoma topilmadi"} onRetry={() => void load()} /></View>
      </View>
    );
  }

  const alreadySubmitted = Boolean(payload?.already_submitted_at) || Boolean(done);
  const expired = Boolean(form.deadline) && new Date(form.deadline as string).getTime() <= now;
  const closed = form.status !== "open" || expired;

  if (alreadySubmitted) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={form.title} variant="close" onLeave={() => router.back()} />
        <View style={styles.centered}>
          <View style={styles.doneMark}><CircleCheck color={colors.onPrimary} size={36} strokeWidth={2.4} /></View>
          <Text style={styles.doneTitle}>Javobingiz qabul qilindi</Text>
          <Text style={styles.doneCopy}>
            Rahmat! Javoblaringiz so‘rovnoma egasiga yuborildi.
          </Text>
          <Text style={styles.doneMeta}>
            {done?.expiresAt
              ? `Ma’lumotlar ${formatShortDateTime(done.expiresAt)} gacha saqlanadi va so‘ng avtomatik o‘chiriladi.`
              : `Javoblar ${form.retention_hours} soatdan so‘ng avtomatik o‘chiriladi.`}
          </Text>
          <View style={styles.doneAction}>
            <PrimaryButton label="Yopish" onPress={() => router.back()} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title={form.title} subtitle={form.owner_name} variant="close" onLeave={() => router.back()} />

      {/* The countdown sits above the scroll so it never leaves the screen. */}
      <View style={[styles.timer, closed && styles.timerClosed]}>
        <Clock color={closed ? colors.danger : colors.primary} size={15} strokeWidth={2.2} />
        {closed
          ? <Text style={styles.timerClosedText}>{expired ? "Muddat tugagan" : "So‘rovnoma yopilgan"}</Text>
          : <CountdownText deadline={form.deadline} style={styles.timerText} />}
        <View style={styles.spacer} />
        <Text style={styles.progressText}>{answeredCount}/{questions.length}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {form.description ? <Text style={styles.description}>{form.description}</Text> : null}

        <View style={styles.privacy}>
          <ShieldCheck color={colors.primary} size={16} strokeWidth={2} />
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>Maxfiylik</Text>
            <Text style={styles.privacyBody}>
              {form.privacy_note ? `${form.privacy_note}\n\n` : ""}
              Javoblaringiz faqat “Yuborish” tugmasi bosilganda serverga yoziladi. Tugallanmagan javoblar saqlanmaydi.
              Yuborilgan javoblar {form.retention_hours} soat davomida saqlanadi va so‘ng avtomatik o‘chiriladi.
            </Text>
          </View>
        </View>

        {closed ? (
          <View style={styles.closedCard}>
            <Lock color={colors.danger} size={18} strokeWidth={2} />
            <Text style={styles.closedText}>
              Bu so‘rovnoma yangi javob qabul qilmayapti.
            </Text>
          </View>
        ) : null}

        <View style={styles.questions} pointerEvents={closed ? "none" : "auto"}>
          {questions.map((question, index) => {
            const value = answers[question.id] ?? {};
            return (
              <View key={question.id} style={[styles.questionCard, closed && styles.dimmed]}>
                <View style={styles.questionHead}>
                  <Text style={styles.questionIndex}>{index + 1}</Text>
                  <Text style={styles.questionLabel}>
                    {question.label}
                    {question.is_required ? <Text style={styles.required}> *</Text> : null}
                  </Text>
                </View>
                {question.helper_text ? <Text style={styles.helper}>{question.helper_text}</Text> : null}
                {question.latin_only ? <Text style={styles.latinBadge}>Faqat lotin alifbosida</Text> : null}

                {question.type === "short_text" || question.type === "long_text" ? (
                  <>
                    <TextInput
                      value={value.text ?? ""}
                      onChangeText={(text) => patch(question.id, { text })}
                      placeholder="Javobingiz"
                      placeholderTextColor={colors.inkSoft}
                      multiline={question.type === "long_text"}
                      style={[styles.input, question.type === "long_text" && styles.multiline]}
                    />
                    {question.latin_only && !isLatinText(value.text ?? "") ? <InlineError message={LATIN_ONLY_ERROR} /> : null}
                  </>
                ) : null}

                {question.type === "phone" ? (
                  <>
                    <TextInput
                      value={value.text ?? ""}
                      onChangeText={(text) => patch(question.id, { text: formatUzPhone(text) })}
                      onFocus={() => { if (!value.text) patch(question.id, { text: "+998 " }); }}
                      placeholder="+998 90 123 45 67"
                      placeholderTextColor={colors.inkSoft}
                      keyboardType="phone-pad"
                      style={styles.input}
                    />
                    {(value.text ?? "").replace(/[^0-9]/g, "").length > 3 && !normalizeUzPhone(value.text ?? "")
                      ? <InlineError message="Raqam to‘liq emas. Namuna: +998 90 123 45 67" />
                      : null}
                  </>
                ) : null}

                {question.type === "number" ? (
                  <TextInput
                    value={value.number ?? ""}
                    onChangeText={(text) => patch(question.id, { number: text.replace(/[^0-9.,-]/g, "") })}
                    placeholder={
                      question.config.min !== undefined || question.config.max !== undefined
                        ? `${question.config.min ?? "—"} … ${question.config.max ?? "—"}`
                        : "Raqam"
                    }
                    placeholderTextColor={colors.inkSoft}
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                  />
                ) : null}

                {question.type === "date" ? (
                  <TextInput
                    value={value.date ?? ""}
                    onChangeText={(text) => patch(question.id, { date: text.replace(/[^0-9-]/g, "").slice(0, 10) })}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.inkSoft}
                    keyboardType="numbers-and-punctuation"
                    style={styles.input}
                  />
                ) : null}

                {question.type === "single_choice" || question.type === "multi_choice" ? (
                  <View style={styles.options}>
                    {question.options.map((option) => {
                      const selected = (value.optionIds ?? []).includes(option.id);
                      return (
                        <Pressable
                          key={option.id}
                          accessibilityRole={question.type === "single_choice" ? "radio" : "checkbox"}
                          accessibilityState={{ selected }}
                          onPress={() => {
                            const current = value.optionIds ?? [];
                            const next = question.type === "single_choice"
                              ? [option.id]
                              : current.includes(option.id) ? current.filter((id) => id !== option.id) : [...current, option.id];
                            patch(question.id, { optionIds: next });
                          }}
                          style={[styles.option, selected && styles.optionSelected]}
                        >
                          <View style={[
                            question.type === "single_choice" ? styles.radio : styles.checkbox,
                            selected && styles.markSelected,
                          ]}>
                            {selected ? <Check color={colors.onPrimary} size={12} strokeWidth={3} /> : null}
                          </View>
                          <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {question.type === "image" ? (
                  <View style={styles.imageBlock}>
                    {value.image ? (
                      <View style={styles.preview}>
                        <Image source={{ uri: value.image.uri }} style={styles.previewImage} />
                        <View style={styles.previewCopy}>
                          <Text style={styles.previewName}>Rasm tanlandi</Text>
                          <Text style={styles.previewSize}>{formatBytes(value.image.sizeBytes)}</Text>
                        </View>
                        <Pressable accessibilityLabel="Rasmni olib tashlash" onPress={() => patch(question.id, { image: null })} style={styles.previewRemove}>
                          <X color={colors.danger} size={16} strokeWidth={2.4} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable accessibilityRole="button" onPress={() => void pickImage(question)} style={styles.imagePicker}>
                        <ImagePlus color={colors.primary} size={20} strokeWidth={2} />
                        <Text style={styles.imagePickerText}>Rasm tanlash</Text>
                      </Pressable>
                    )}
                    <Text style={styles.imageHint}>Maksimal hajm: 3 MB · jpg, png, webp</Text>
                    <Text style={styles.imageHint}>{IMAGE_HELP}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        {error ? <InlineError message={error} /> : null}

        {!closed ? (
          <PrimaryButton
            label="Javoblarni yuborish"
            loading={submitting}
            disabled={Boolean(validation)}
            onPress={() => void submit()}
          />
        ) : null}
        {validation && !closed ? <Text style={styles.validationHint}>{validation}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.sm },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg, paddingTop: spacing.lg },

  timer: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  timerClosed: {},
  timerText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  timerClosedText: { ...typography.caption, color: colors.danger, fontFamily: "Manrope_600SemiBold" },
  spacer: { flex: 1 },
  progressText: { ...typography.caption, color: colors.inkMuted },
  progressTrack: { height: 4, marginHorizontal: spacing.xl, borderRadius: 2, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },

  description: { ...typography.body, color: colors.inkMuted },
  privacy: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  privacyCopy: { flex: 1, gap: 3 },
  privacyTitle: { ...typography.caption, color: colors.primaryDeep, fontFamily: "Manrope_600SemiBold" },
  privacyBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },

  closedCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: "#F3D4DB" },
  closedText: { ...typography.caption, color: colors.danger, flex: 1, lineHeight: 18 },

  questions: { gap: spacing.md },
  questionCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadow },
  dimmed: { opacity: 0.55 },
  questionHead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  questionIndex: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, width: 24, height: 24, borderRadius: 12, textAlign: "center", lineHeight: 24, overflow: "hidden" },
  questionLabel: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  required: { color: colors.danger },
  helper: { ...typography.caption, color: colors.inkSoft, lineHeight: 17 },
  latinBadge: { ...typography.caption, fontSize: 11, color: colors.primary, backgroundColor: colors.primarySoft, alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden" },

  input: {
    ...typography.body, color: colors.ink, minHeight: 52,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  multiline: { minHeight: 104, textAlignVertical: "top" },

  options: { gap: spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.6, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.6, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  markSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionLabel: { ...typography.body, color: colors.inkMuted, flex: 1 },
  optionLabelSelected: { color: colors.ink },

  imageBlock: { gap: spacing.sm },
  imagePicker: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 56, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted },
  imagePickerText: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },
  preview: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  previewImage: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.border },
  previewCopy: { flex: 1 },
  previewName: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold" },
  previewSize: { ...typography.caption, color: colors.inkSoft },
  previewRemove: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.dangerSoft },
  imageHint: { ...typography.caption, fontSize: 11, color: colors.inkSoft, lineHeight: 16 },

  validationHint: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },

  doneMark: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg },
  doneTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  doneCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  doneMeta: { ...typography.caption, color: colors.inkSoft, textAlign: "center", marginTop: spacing.sm, lineHeight: 18 },
  doneAction: { alignSelf: "stretch", marginTop: spacing.xxl },
});

import type { Tables } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AlertCircle, ArrowLeft, Check, ChevronRight, Clock3, LoaderCircle, RefreshCw, Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { IconChip } from "@/components/IconChip";
import { PrimaryButton } from "@/components/PrimaryButton";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, gradients, icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";

type Job = Tables<"generation_jobs">;
type Step = Tables<"generation_steps">;
type Presentation = Tables<"presentations">;

export default function GenerationScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const presentationId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!presentationId) return;
    try {
      const [presentationResult, jobResult] = await Promise.all([
        supabase.from("presentations").select("*").eq("id", presentationId).single(),
        supabase.from("generation_jobs").select("*").eq("presentation_id", presentationId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (presentationResult.error) throw presentationResult.error;
      if (jobResult.error) throw jobResult.error;
      setPresentation(presentationResult.data);
      setJob(jobResult.data);
      if (jobResult.data) {
        const stepResult = await supabase.from("generation_steps").select("*").eq("job_id", jobResult.data.id).order("sequence");
        if (stepResult.error) throw stepResult.error;
        setSteps(stepResult.data);
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(asErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [presentationId]);

  useEffect(() => {
    void load();
    if (!presentationId) return;
    const channel = supabase
      .channel(`generation:${presentationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "generation_jobs", filter: `presentation_id=eq.${presentationId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "generation_steps", filter: `presentation_id=eq.${presentationId}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "presentations", filter: `id=eq.${presentationId}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 5000);
    return () => { clearInterval(poll); void supabase.removeChannel(channel); };
  }, [load, presentationId]);

  const progress = job?.progress ?? (presentation?.status === "ready" ? 100 : 0);
  const state = useMemo(() => {
    if (presentation?.status === "ready" || job?.status === "succeeded") return "ready";
    if (presentation?.status === "failed" || job?.status === "failed") return "failed";
    return "working";
  }, [job?.status, presentation?.status]);

  async function retry() {
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("generate-presentation", { body: { presentationId, retry: true } });
      if (error) throw error;
      await load();
    } catch (error) {
      Alert.alert("Qayta boshlanmadi", await asFunctionErrorMessage(error));
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/(app)/(tabs)/projects")} style={styles.back}><ArrowLeft color={colors.ink} size={icon.lg} strokeWidth={icon.stroke} /></Pressable>
        <View style={styles.headerText}><Text style={styles.eyebrow}>JAXONGIR AI</Text><Text numberOfLines={1} style={styles.headerTitle}>{presentation?.title ?? "Taqdimot"}</Text></View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={state === "failed" ? gradients.danger : state === "ready" ? gradients.success : gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <IconChip
            icon={state === "working" ? LoaderCircle : state === "ready" ? Check : AlertCircle}
            variant="glass"
            size="lg"
            bold={state === "ready"}
            style={styles.heroIcon}
          />
          <Text style={styles.heroEyebrow}>{state === "working" ? "TAQDIMOT YARATILMOQDA" : state === "ready" ? "TAYYOR" : "GENERATION TO‘XTADI"}</Text>
          <Text style={styles.heroTitle}>{state === "working" ? "Jaxongir AI ishlayapti" : state === "ready" ? "Taqdimotingiz tayyor" : "Texnik xatolik yuz berdi"}</Text>
          <Text style={styles.heroCopy}>
            {state === "working" ? "Har bir ko‘rsatkich haqiqiy backend bosqichidan keladi. Ilovani yopishingiz mumkin — ish serverda davom etadi." : state === "ready" ? "Slaydlarni ko‘ring, elementlarni tahrirlang yoki PDF formatida eksport qiling." : job?.error_message ?? presentation?.error_message ?? loadError ?? "Qayta urinish mumkin."}
          </Text>
          <View style={styles.progressHeader}><Text style={styles.progressStage}>{job?.stage?.replaceAll("_", " ") ?? "preparing"}</Text><Text style={styles.progressValue}>{progress}%</Text></View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, progress)}%` }]} /></View>
        </LinearGradient>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Jarayon</Text><View style={styles.live}><View style={[styles.liveDot, state !== "working" && styles.liveDotDone]} /><Text style={styles.liveText}>{state === "working" ? "Jonli" : "Yakunlandi"}</Text></View></View>
        <View style={styles.steps}>
          {steps.length === 0 ? <View style={styles.emptyStep}><Clock3 color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} /><Text style={styles.emptyStepText}>Birinchi backend yangilanishi kutilmoqda…</Text></View> : null}
          {steps.map((step, index) => {
            const done = step.status === "succeeded" || step.status === "skipped";
            const failed = step.status === "failed";
            const running = step.status === "running";
            return (
              <View style={styles.step} key={step.id}>
                <View style={styles.timeline}>
                  <View style={[styles.stepIcon, done && styles.stepIconDone, failed && styles.stepIconFailed]}>
                    {done ? <Check color={colors.onPrimary} size={15} strokeWidth={icon.strokeBold} /> : failed ? <AlertCircle color={colors.onPrimary} size={15} strokeWidth={icon.stroke} /> : running ? <ActivityIndicator color={colors.primary} size="small" /> : <Text style={styles.stepNumber}>{index + 1}</Text>}
                  </View>
                  {index < steps.length - 1 ? <View style={[styles.timelineLine, done && styles.timelineLineDone]} /> : null}
                </View>
                <View style={styles.stepBody}><Text style={[styles.stepTitle, !running && !done && !failed && styles.stepTitlePending]}>{step.label}</Text>{step.message ? <Text style={styles.stepMessage}>{step.message}</Text> : null}</View>
                {done ? <Text style={styles.stepPercent}>100%</Text> : running ? <Text style={styles.stepPercent}>{step.progress}%</Text> : null}
              </View>
            );
          })}
        </View>

        {state === "ready" ? (
          <PrimaryButton
            icon={Sparkles}
            trailingIcon={ChevronRight}
            label="Editorni ochish"
            style={styles.action}
            onPress={() => router.replace({ pathname: "/(app)/presentation/[id]", params: { id: presentationId } })}
          />
        ) : null}
        {state === "failed" ? (
          <PrimaryButton tone="secondary" icon={RefreshCw} label="Qayta urinish" loading={retrying} style={styles.action} onPress={() => void retry()} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  header: { paddingTop: 58, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.4 },
  headerTitle: { ...typography.heading, color: colors.ink, marginTop: 2 },
  content: { padding: spacing.xl, paddingBottom: 100 },
  hero: { borderRadius: radius.xl, padding: spacing.xl, overflow: "hidden", ...shadowLifted },
  heroIcon: { marginBottom: spacing.xl },
  heroEyebrow: { ...typography.caption, color: "rgba(255,255,255,.72)", letterSpacing: 1.5 },
  heroTitle: { ...typography.title, color: colors.onPrimary, marginTop: spacing.sm },
  heroCopy: { ...typography.body, color: "rgba(255,255,255,.82)", marginTop: spacing.md },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xxl },
  progressStage: { ...typography.caption, color: colors.onPrimary, textTransform: "capitalize" },
  progressValue: { ...typography.bodyMedium, color: colors.onPrimary },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,.2)", overflow: "hidden", marginTop: spacing.sm },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.onPrimary },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xxl, marginBottom: spacing.lg },
  sectionTitle: { ...typography.heading, color: colors.ink },
  live: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  liveDotDone: { backgroundColor: colors.success },
  liveText: { ...typography.caption, color: colors.inkMuted },
  steps: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, ...shadow },
  step: { minHeight: 66, flexDirection: "row" },
  timeline: { width: 38, alignItems: "center" },
  stepIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center", zIndex: 1 },
  stepIconDone: { backgroundColor: colors.primary },
  stepIconFailed: { backgroundColor: colors.danger },
  stepNumber: { ...typography.caption, color: colors.inkSoft },
  timelineLine: { position: "absolute", top: 28, bottom: 0, width: 1, backgroundColor: colors.border },
  timelineLineDone: { backgroundColor: colors.accentSoft },
  stepBody: { flex: 1, paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  stepTitle: { ...typography.bodyMedium, color: colors.ink, marginTop: 3 },
  stepTitlePending: { color: colors.inkSoft },
  stepMessage: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  stepPercent: { ...typography.caption, color: colors.primary, marginTop: 5 },
  emptyStep: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  emptyStepText: { ...typography.body, color: colors.inkMuted, flex: 1 },
  action: { marginTop: spacing.xl },
});

import * as FileSystem from "expo-file-system/legacy";
import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Clock, Download, Link2, Lock, Pencil, Play, Users } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { CountdownText } from "@/components/SurveyCard";
import { EmptyState, ErrorState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime, useNow } from "@/lib/datetime";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

type QuestionStat = {
  id: string;
  label: string;
  type: string;
  is_required: boolean;
  answered: number;
  options: { id: string; label: string; count: number }[];
  number_summary: { min: number | null; max: number | null; avg: number | null; sum: number | null } | null;
  files: { path: string; mime_type: string }[];
};

type Summary = {
  form: {
    id: string;
    title: string;
    status: "draft" | "open" | "closed";
    deadline: string | null;
    expected_participants: number | null;
    submitted_count: number;
    retention_hours: number;
  };
  participants: number;
  next_expiry: string | null;
  questions: QuestionStat[];
};

type ResponseRow = {
  response_id: string;
  submitted_at: string;
  expires_at: string;
  respondent_name: string;
  respondent_username: string | null;
  answers: Record<string, { text: string | null; number: number | null; date: string | null; option_ids: string[]; files: { path: string }[] }>;
};

/**
 * The owner's results dashboard.
 *
 * Every number comes from `survey_results_summary()`, which refuses anyone but
 * the owner — the screen never assembles statistics from rows it fetched
 * itself. Uploaded images are shown through short-lived signed URLs; no path in
 * this bucket is ever public.
 */
export default function SurveyResultsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const formId = typeof params.id === "string" ? params.id : "";

  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const now = useNow(true, 30_000);

  const load = useCallback(async (isRefresh = false) => {
    if (!formId) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [summaryResult, rowsResult] = await Promise.all([
      supabase.rpc("survey_results_summary", { p_form_id: formId }),
      supabase.rpc("survey_response_rows", { p_form_id: formId, p_limit: 200 }),
    ]);
    if (summaryResult.error) {
      setError(asErrorMessage(summaryResult.error));
    } else {
      const next = summaryResult.data as unknown as Summary;
      setSummary(next);
      setRows((rowsResult.data as unknown as ResponseRow[]) ?? []);
      setError(null);

      // Signed per view, and only for what is on screen. The link dies long
      // before the answer it belongs to does.
      const paths = next.questions.flatMap((question) => question.files.map((file) => file.path)).slice(0, 60);
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from("survey-uploads").createSignedUrls(paths, 3600);
        const usable = (signed ?? []).filter((item): item is typeof item & { path: string; signedUrl: string } =>
          Boolean(item.path) && Boolean(item.signedUrl));
        setImageUrls(Object.fromEntries(usable.map((item) => [item.path, item.signedUrl])));
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [formId]);

  useEffect(() => { void load(); }, [load]);

  // The form row carries submitted_count, so the headline follows new responses
  // without a single answer row crossing the wire.
  useEffect(() => {
    if (!formId) return;
    const channel = supabase
      .channel(`survey-results-${formId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "survey_forms", filter: `id=eq.${formId}` }, () => void load(true))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [formId, load]);

  async function changeStatus(status: "open" | "closed") {
    setBusy(status); setActionError(null);
    const { error: statusError } = await supabase.rpc("set_survey_status", { p_form_id: formId, p_status: status });
    setBusy(null);
    if (statusError) setActionError(asErrorMessage(statusError));
    else void load(true);
  }

  async function shareLink() {
    const url = Linking.createURL(`/survey/${formId}`);
    await Share.share({
      message: `“${summary?.form.title ?? "So‘rovnoma"}” so‘rovnomasini to‘ldiring:\n${url}`,
    });
  }

  async function exportResults(format: "xlsx" | "csv") {
    setBusy(format); setActionError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("export-survey", { body: { formId, format } });
      if (invokeError) throw invokeError;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("Eksport havolasi olinmadi");

      const target = `${FileSystem.cacheDirectory}${(summary?.form.title ?? "survey").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.${format}`;
      const download = await FileSystem.downloadAsync(url, target);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(download.uri, {
          mimeType: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Natijalarni ulashish",
        });
      } else {
        Alert.alert("Yuklab olindi", "Fayl qurilmaga saqlandi.");
      }
    } catch (nextError) {
      setActionError(await asFunctionErrorMessage(nextError));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Natijalar" />
        <View style={styles.content}><SkeletonCard lines={3} /><SkeletonCard lines={3} /></View>
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Natijalar" />
        <View style={styles.content}><ErrorState message={error ?? "Natijalar topilmadi"} onRetry={() => void load()} /></View>
      </View>
    );
  }

  const { form } = summary;
  const expired = Boolean(form.deadline) && new Date(form.deadline as string).getTime() <= now;
  const live = form.status === "open" && !expired;
  const remaining = form.expected_participants ? Math.max(form.expected_participants - form.submitted_count, 0) : null;
  const completion = form.expected_participants
    ? Math.min(Math.round((form.submitted_count / form.expected_participants) * 100), 100)
    : null;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={form.title}
        subtitle={live ? "Faol" : form.status === "draft" ? "Qoralama" : "Tugagan"}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tahrirlash"
            onPress={() => router.push({ pathname: "/(app)/survey/create", params: { id: formId } })}
            style={styles.headerAction}
          >
            <Pencil color={colors.primary} size={icon.sm} strokeWidth={2.2} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.headline}>
          <View style={styles.headlineTop}>
            <Text style={styles.headlineValue}>{form.submitted_count}</Text>
            <Text style={styles.headlineUnit}>
              {form.expected_participants ? `/ ${form.expected_participants} javob` : "javob"}
            </Text>
          </View>
          {completion !== null ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completion}%` }]} />
              </View>
              <Text style={styles.headlineMeta}>{completion}% to‘ldirildi · {remaining} ta qoldi</Text>
            </>
          ) : null}
          <View style={styles.headlineRow}>
            <Users color={colors.inkSoft} size={14} strokeWidth={2} />
            <Text style={styles.headlineMeta}>{summary.participants} kishi ochgan</Text>
            <View style={styles.spacer} />
            <Clock color={live ? colors.primary : colors.inkSoft} size={14} strokeWidth={2} />
            {live
              ? <CountdownText deadline={form.deadline} style={styles.headlineCountdown} />
              : <Text style={styles.headlineMeta}>{expired ? "Muddat tugagan" : "Muddatsiz"}</Text>}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => void shareLink()} style={styles.action}>
            <Link2 color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.actionText}>Havola</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void exportResults("xlsx")} style={styles.action}>
            {busy === "xlsx" ? <ActivityIndicator color={colors.primary} size="small" /> : <Download color={colors.primary} size={18} strokeWidth={2} />}
            <Text style={styles.actionText}>XLSX</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void exportResults("csv")} style={styles.action}>
            {busy === "csv" ? <ActivityIndicator color={colors.primary} size="small" /> : <Download color={colors.primary} size={18} strokeWidth={2} />}
            <Text style={styles.actionText}>CSV</Text>
          </Pressable>
          {live ? (
            <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void changeStatus("closed")} style={styles.action}>
              <Lock color={colors.danger} size={18} strokeWidth={2} />
              <Text style={[styles.actionText, styles.actionDanger]}>Yopish</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => void changeStatus("open")} style={styles.action}>
              <Play color={colors.success} size={18} strokeWidth={2} />
              <Text style={[styles.actionText, styles.actionSuccess]}>Ochish</Text>
            </Pressable>
          )}
        </View>

        {actionError ? <InlineError message={actionError} /> : null}

        <View style={styles.retention}>
          <Text style={styles.retentionText}>
            Javoblar {form.retention_hours} soat saqlanadi.
            {summary.next_expiry ? ` Eng erta o‘chirilish: ${formatShortDateTime(summary.next_expiry)}.` : ""}
            {" "}Eksportni shu muddat ichida yuklab oling.
          </Text>
        </View>

        {form.submitted_count === 0 ? (
          <EmptyState
            icon={Users}
            title="Hali javob yo‘q"
            message={live
              ? "Havolani ulashing — javoblar kelgani sari bu sahifa o‘zi yangilanadi."
              : "So‘rovnoma ochilgach, javoblar shu yerda to‘planadi."}
          />
        ) : null}

        {form.submitted_count > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Savollar bo‘yicha</Text>
            <View style={styles.statList}>
              {summary.questions.map((question, index) => (
                <View key={question.id} style={styles.statCard}>
                  <Text style={styles.statLabel}>{index + 1}. {question.label}</Text>
                  <Text style={styles.statMeta}>{question.answered} ta javob</Text>

                  {question.options.length > 0 ? (
                    <View style={styles.bars}>
                      {question.options.map((option) => {
                        const share = question.answered > 0 ? Math.round((option.count / question.answered) * 100) : 0;
                        return (
                          <View key={option.id} style={styles.bar}>
                            <View style={styles.barHead}>
                              <Text numberOfLines={1} style={styles.barLabel}>{option.label}</Text>
                              <Text style={styles.barValue}>{option.count} · {share}%</Text>
                            </View>
                            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${share}%` }]} /></View>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}

                  {question.number_summary && question.number_summary.avg !== null ? (
                    <View style={styles.numbers}>
                      <View style={styles.numberCell}><Text style={styles.numberValue}>{question.number_summary.min}</Text><Text style={styles.numberLabel}>eng kichik</Text></View>
                      <View style={styles.numberCell}><Text style={styles.numberValue}>{question.number_summary.avg}</Text><Text style={styles.numberLabel}>o‘rtacha</Text></View>
                      <View style={styles.numberCell}><Text style={styles.numberValue}>{question.number_summary.max}</Text><Text style={styles.numberLabel}>eng katta</Text></View>
                    </View>
                  ) : null}

                  {question.files.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gallery}>
                      {question.files.map((file) => (
                        <Image key={file.path} source={{ uri: imageUrls[file.path] }} style={styles.galleryImage} />
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              ))}
            </View>

            <Text style={styles.sectionTitle}>Javoblar jadvali</Text>
            {/* One card per respondent rather than a real grid: a phone cannot
                show a fifteen-column table, and the spreadsheet export exists
                precisely for the case where a grid is what you need. */}
            <View style={styles.statList}>
              {rows.map((row, index) => (
                <View key={row.response_id} style={styles.rowCard}>
                  <View style={styles.rowHead}>
                    <Text style={styles.rowIndex}>{index + 1}</Text>
                    <View style={styles.rowIdentity}>
                      <Text numberOfLines={1} style={styles.rowName}>{row.respondent_name}</Text>
                      {row.respondent_username ? <Text style={styles.rowHandle}>@{row.respondent_username}</Text> : null}
                    </View>
                    <Text style={styles.rowTime}>{formatShortDateTime(row.submitted_at)}</Text>
                  </View>
                  {summary.questions.map((question) => {
                    const answer = row.answers[question.id];
                    if (!answer) return null;
                    const text = answer.text
                      ?? (answer.number !== null ? String(answer.number) : null)
                      ?? answer.date
                      ?? (answer.option_ids.length
                        ? answer.option_ids.map((id) => question.options.find((option) => option.id === id)?.label ?? "—").join(", ")
                        : null)
                      ?? (answer.files.length ? `${answer.files.length} ta rasm` : null);
                    if (!text) return null;
                    return (
                      <View key={question.id} style={styles.rowAnswer}>
                        <Text numberOfLines={1} style={styles.rowQuestion}>{question.label}</Text>
                        <Text style={styles.rowValue}>{text}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  headerAction: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },

  headline: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadow },
  headlineTop: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  headlineValue: { fontFamily: "Manrope_700Bold", fontSize: 40, lineHeight: 46, color: colors.ink, letterSpacing: -1 },
  headlineUnit: { ...typography.body, color: colors.inkMuted },
  headlineRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  headlineMeta: { ...typography.caption, color: colors.inkMuted },
  headlineCountdown: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  spacer: { flex: 1 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },

  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionText: { ...typography.caption, fontSize: 11, color: colors.primary },
  actionDanger: { color: colors.danger },
  actionSuccess: { color: colors.success },

  retention: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  retentionText: { ...typography.caption, color: colors.primaryDeep, lineHeight: 17 },

  sectionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  statList: { gap: spacing.md },
  statCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  statLabel: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  statMeta: { ...typography.caption, color: colors.inkSoft },

  bars: { gap: spacing.sm, marginTop: spacing.sm },
  bar: { gap: 4 },
  barHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  barValue: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold" },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },

  numbers: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  numberCell: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  numberValue: { ...typography.bodyMedium, color: colors.ink },
  numberLabel: { ...typography.caption, fontSize: 10, color: colors.inkSoft },

  gallery: { gap: spacing.sm, paddingVertical: spacing.sm },
  galleryImage: { width: 92, height: 92, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },

  rowCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  rowHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIndex: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, width: 24, height: 24, borderRadius: 12, textAlign: "center", lineHeight: 24, overflow: "hidden" },
  rowIdentity: { flex: 1 },
  rowName: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  rowHandle: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  rowTime: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  rowAnswer: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  rowQuestion: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  rowValue: { ...typography.body, color: colors.ink, fontSize: 14 },
});

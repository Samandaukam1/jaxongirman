import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { ChevronLeft, ChevronRight, Download, RefreshCw, Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState } from "@/components/StateBlocks";
import { defensePdf, defensePdfUrl, loadDefense, writeDefense, type Defense } from "@/lib/defense";
import { asErrorMessage } from "@/lib/format";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

/**
 * What to say, one slide at a time.
 *
 * Read standing up, on a phone, minutes before speaking — so it is one passage
 * per screen at a size that survives a glance, rather than a scroll of the whole
 * document. Moving between slides is two large targets at the bottom, where a
 * thumb already is.
 *
 * The key point and the transition are set quieter than the speech. They are
 * notes to the speaker, not lines to deliver, and setting them the same size is
 * how somebody ends up reading "O‘tish:" out loud.
 */
export default function DefenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [defense, setDefense] = useState<Defense | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"write" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(-1);
  const scroller = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDefense(await loadDefense(id));
      setError(null);
    } catch (readError) {
      setError(asErrorMessage(readError));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function rewrite() {
    if (!id) return;
    setWorking("write"); setError(null);
    try {
      await writeDefense(id);
      await load();
      setAt(-1);
    } catch (writeError) {
      setError(asErrorMessage(writeError));
    } finally {
      setWorking(null);
    }
  }

  async function download() {
    if (!id) return;
    setWorking("pdf"); setError(null);
    try {
      const { storagePath } = await defensePdf(id);
      const url = await defensePdfUrl(storagePath);
      if (Platform.OS === "web") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}himoya-matni.pdf`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Himoya matni" });
      }
    } catch (downloadError) {
      setError(asErrorMessage(downloadError));
    } finally {
      setWorking(null);
    }
  }

  function go(next: number) {
    setAt(next);
    scroller.current?.scrollTo({ y: 0, animated: false });
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Himoya matni" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  // Nothing written yet, or written and failed: one button, one sentence.
  if (!defense || defense.status === "failed") {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Himoya matni" />
        <ScrollView contentContainerStyle={styles.content}>
          <EmptyState
            icon={Sparkles}
            title={defense ? "Himoya matni yozilmadi" : "Himoya matni hali yo‘q"}
            message={defense?.failureReason ?? "Taqdimot yonida turib nima deyishingizni Jaxongir AI yozib beradi."}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={() => void rewrite()} disabled={working !== null} style={[styles.primary, working !== null && styles.disabled]}>
            {working === "write"
              ? <ActivityIndicator color={colors.onPrimary} size="small" />
              : <Text style={styles.primaryText}>Himoya matnini yozish</Text>}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (defense.status === "generating") {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Himoya matni" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.waiting}>Yozilmoqda…</Text>
        </View>
      </View>
    );
  }

  const total = defense.sections.length;
  // −1 is the opening, `total` is the close: the script read end to end.
  const section = at >= 0 && at < total ? defense.sections[at] : null;
  const heading = at < 0 ? "Kirish" : section ? `${section.slide_number}-slayd` : "Xulosa";
  const body = at < 0 ? defense.introduction : section ? section.speaker_text : defense.conclusion;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Himoya matni" />

      <ScrollView ref={scroller} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {defense.stale ? (
          <Pressable onPress={() => void rewrite()} disabled={working !== null} style={styles.stale}>
            <RefreshCw color={colors.primaryDeep} size={icon.sm} strokeWidth={2} />
            <Text style={styles.staleText}>
              {working === "write" ? "Yangilanmoqda…" : "Taqdimot o‘zgargan — matnni yangilash"}
            </Text>
          </Pressable>
        ) : null}

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        <View style={styles.card}>
          <Text style={styles.marker}>{heading}</Text>
          {section?.slide_title ? <Text style={styles.slideTitle}>{section.slide_title}</Text> : null}
          <Text style={styles.speech}>{body || "—"}</Text>

          {section?.key_point ? (
            <View style={styles.note}>
              <Text style={styles.noteLabel}>Asosiy fikr</Text>
              <Text style={styles.noteText}>{section.key_point}</Text>
            </View>
          ) : null}
          {section?.transition_to_next ? (
            <View style={styles.note}>
              <Text style={styles.noteLabel}>Keyingi slaydga o‘tish</Text>
              <Text style={styles.noteText}>{section.transition_to_next}</Text>
            </View>
          ) : null}
        </View>

        <Pressable onPress={() => void download()} disabled={working !== null} style={[styles.secondary, working !== null && styles.disabled]}>
          {working === "pdf"
            ? <ActivityIndicator color={colors.primary} size="small" />
            : <><Download color={colors.primary} size={icon.sm} strokeWidth={2} /><Text style={styles.secondaryText}>PDF yuklab olish</Text></>}
        </Pressable>
      </ScrollView>

      <View style={styles.pager}>
        <Pressable accessibilityLabel="Oldingi" disabled={at <= -1} onPress={() => go(at - 1)} style={[styles.pagerButton, at <= -1 && styles.disabled]}>
          <ChevronLeft color={colors.primary} size={icon.md} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.pagerLabel}>{at < 0 ? "Kirish" : at >= total ? "Xulosa" : `${at + 1} / ${total}`}</Text>
        <Pressable accessibilityLabel="Keyingi" disabled={at >= total} onPress={() => go(at + 1)} style={[styles.pagerButton, at >= total && styles.disabled]}>
          <ChevronRight color={colors.primary} size={icon.md} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  waiting: { ...typography.caption, color: colors.inkMuted },
  content: { padding: spacing.xl, paddingBottom: spacing.xl, gap: spacing.lg },
  stale: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  staleText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
  card: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadow },
  marker: { ...typography.caption, fontWeight: "700", color: colors.primary, letterSpacing: 0.6 },
  slideTitle: { ...typography.heading, color: colors.ink },
  // Set larger than body text on purpose: read from a distance, in a hurry, by
  // somebody who is about to speak.
  speech: { fontFamily: "Manrope_400Regular", fontSize: 18, lineHeight: 30, color: colors.ink },
  note: { paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  noteLabel: { ...typography.caption, fontWeight: "700", color: colors.inkSoft },
  noteText: { ...typography.caption, color: colors.inkMuted },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  secondaryText: { ...typography.body, fontWeight: "700", color: colors.primaryDeep },
  primary: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.primary },
  primaryText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  disabled: { opacity: 0.45 },
  error: { ...typography.caption, color: colors.danger },
  pager: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingTop: spacing.md,
    paddingBottom: Platform.OS === "ios" ? spacing.xxl : spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  pagerButton: { width: 56, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.primarySoft },
  pagerLabel: { ...typography.caption, fontWeight: "700", color: colors.inkMuted },
});

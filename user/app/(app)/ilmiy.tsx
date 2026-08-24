import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { BookOpen, Check, Download, Pause, Play, Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import {
  KINDS, createWork, loadWork, myWorks, planWork, workFile, writeNextSection,
  type Section, type Work, type WorkKind,
} from "@/lib/academic";
import { asErrorMessage } from "@/lib/format";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Writing an academic work, a section at a time.
 *
 * The loop is driven from here rather than from the server, which is what makes
 * the screen honest: each section is one request, so progress is real rather
 * than a spinner with a guess under it, stopping halfway keeps everything
 * written, and running out of coins is a pause with a button instead of a
 * failure with an apology.
 */
export default function IlmiyScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [works, setWorks] = useState<Work[]>([]);
  const [work, setWork] = useState<Work | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<WorkKind>("referat");
  const [topic, setTopic] = useState("");
  const [field, setField] = useState("");
  const [requirements, setRequirements] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setWorks(await myWorks()); setError(null); }
    catch (readError) { setError(asErrorMessage(readError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (id: string) => {
    setBusy("open");
    try {
      const loaded = await loadWork(id);
      setWork(loaded.work);
      setSections(loaded.sections);
      setError(null);
    } catch (openError) { setError(asErrorMessage(openError)); }
    finally { setBusy(null); }
  }, []);

  async function start() {
    if (!topic.trim()) { setError("Mavzuni yozing."); return; }
    setBusy("create"); setError(null);
    try {
      const created = await createWork({ kind, topic, field, requirements });
      setWork(created);
      setSections([]);
      setBusy("plan");
      await planWork(created.id);
      await open(created.id);
    } catch (startError) {
      setError(asErrorMessage(startError));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Writes sections until they run out, the balance does, or something fails.
   *
   * One request per section rather than one for the work: a request that fails
   * at the last page of twenty leaves nothing, and this leaves everything
   * except the section it was on.
   */
  async function run() {
    if (!work) return;
    setRunning(true); setError(null);
    try {
      for (;;) {
        const step = await writeNextSection(work.id);
        await open(work.id);
        if (step.done) break;
      }
    } catch (runError) {
      setError(asErrorMessage(runError));
      await open(work.id);
    } finally {
      setRunning(false);
    }
  }

  async function download(format: "docx" | "pdf") {
    if (!work) return;
    setBusy(format); setError(null);
    try {
      const url = await workFile(work.id, format);
      if (Platform.OS === "web") { window.open(url, "_blank", "noopener,noreferrer"); return; }
      const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}ilmiy-ish.${format}`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          dialogTitle: "Ilmiy ish",
        });
      }
    } catch (downloadError) {
      setError(asErrorMessage(downloadError));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Ilmiy ish" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  /* ------------------------------------------------------------- one work */

  if (work) {
    const ready = sections.filter((section) => section.status === "ready").length;
    const total = sections.length;
    const words = sections.reduce((sum, section) => sum + section.words, 0);

    return (
      <View style={styles.screen}>
        <ScreenHeader title={KINDS.find((entry) => entry.kind === work.kind)?.label ?? "Ilmiy ish"} onLeave={() => setWork(null)} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.topic}>{work.topic}</Text>
          <Text style={styles.meta}>
            {ready}/{total} bo‘lim · {words} so‘z · {work.sources.length} manba
            {work.empirical ? " · empirik" : ""}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {work.status === "paused" && work.pausedReason ? (
            <View style={styles.paused}>
              <Pause color={colors.primaryDeep} size={icon.sm} strokeWidth={2} />
              <Text style={styles.pausedText}>{work.pausedReason}</Text>
            </View>
          ) : null}

          <View style={styles.track}>
            <View style={[styles.fill, { width: `${total ? (ready / total) * 100 : 0}%` }]} />
          </View>

          {sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionHeading}>{section.heading}</Text>
                {section.status === "ready"
                  ? <Check color={colors.success} size={16} strokeWidth={2.6} />
                  : section.status === "writing"
                    ? <ActivityIndicator color={colors.primary} size="small" />
                    : <Text style={styles.sectionWait}>kutilmoqda</Text>}
              </View>
              {section.body ? <Text style={styles.sectionBody} numberOfLines={6}>{section.body}</Text> : null}
            </View>
          ))}

          {ready < total ? (
            <Pressable disabled={running} onPress={() => void run()} style={[styles.primary, running && styles.disabled]}>
              {running
                ? <><ActivityIndicator color={colors.onPrimary} size="small" /><Text style={styles.primaryText}>Yozilmoqda…</Text></>
                : <><Play color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} /><Text style={styles.primaryText}>{ready > 0 ? "Davom ettirish" : "Yozishni boshlash"}</Text></>}
            </Pressable>
          ) : null}

          {ready > 0 ? (
            <View style={styles.downloads}>
              {(["docx", "pdf"] as const).map((format) => (
                <Pressable
                  key={format}
                  disabled={busy !== null}
                  onPress={() => void download(format)}
                  style={[styles.secondary, busy !== null && styles.disabled]}
                >
                  {busy === format
                    ? <ActivityIndicator color={colors.primary} size="small" />
                    : <><Download color={colors.primary} size={icon.sm} strokeWidth={2} /><Text style={styles.secondaryText}>{format.toUpperCase()}</Text></>}
                </Pressable>
              ))}
            </View>
          ) : null}

          {work.sources.length > 0 ? (
            <View style={styles.sources}>
              <Text style={styles.sourcesTitle}>Manbalar</Text>
              {work.sources.map((source, index) => (
                <Text key={`${source.title}-${index}`} style={styles.source}>
                  {index + 1}. {source.author ? `${source.author}. ` : ""}{source.title}
                  {source.year ? `, ${source.year}` : ""}
                </Text>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  /* ------------------------------------------------------------ the start */

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title="Ilmiy ish" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>Ish turi</Text>
        <View style={styles.kinds}>
          {KINDS.map((entry) => (
            <Pressable
              key={entry.kind}
              onPress={() => setKind(entry.kind)}
              style={[styles.kind, kind === entry.kind && styles.kindOn]}
            >
              <BookOpen color={kind === entry.kind ? colors.onPrimary : colors.primary} size={18} strokeWidth={2} />
              <Text style={[styles.kindLabel, kind === entry.kind && styles.kindLabelOn]}>{entry.label}</Text>
              <Text style={[styles.kindDetail, kind === entry.kind && styles.kindDetailOn]}>{entry.detail}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Mavzu</Text>
        <TextInput value={topic} onChangeText={setTopic} placeholder="Masalan: Talabalar jurnalistikasining ijtimoiy roli" placeholderTextColor={colors.inkSoft} style={styles.input} multiline maxLength={300} />

        <Text style={styles.label}>Yo‘nalish yoki fan</Text>
        <TextInput value={field} onChangeText={setField} placeholder="Jurnalistika" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={160} />

        <Text style={styles.label}>Talablar (ixtiyoriy)</Text>
        <TextInput value={requirements} onChangeText={setRequirements} placeholder="Hajmi, uslubi, nima kiritilishi kerak…" placeholderTextColor={colors.inkSoft} style={[styles.input, styles.tall]} multiline maxLength={800} />

        <Pressable disabled={busy !== null} onPress={() => void start()} style={[styles.primary, busy !== null && styles.disabled]}>
          {busy
            ? <><ActivityIndicator color={colors.onPrimary} size="small" /><Text style={styles.primaryText}>{busy === "plan" ? "Manbalar izlanmoqda…" : "Tayyorlanmoqda…"}</Text></>
            : <><Sparkles color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} /><Text style={styles.primaryText}>Reja va manbalarni tayyorlash</Text></>}
        </Pressable>

        {works.length > 0 ? (
          <>
            <Text style={styles.label}>Boshlangan ishlar</Text>
            {works.map((entry) => (
              <Pressable key={entry.id} onPress={() => void open(entry.id)} style={styles.workRow}>
                <View style={styles.workCopy}>
                  <Text style={styles.workTopic} numberOfLines={1}>{entry.topic}</Text>
                  <Text style={styles.workMeta}>
                    {KINDS.find((item) => item.kind === entry.kind)?.label} · {entry.status}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.sm },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.md },
  input: { ...typography.body, color: colors.ink, minHeight: 48, paddingHorizontal: spacing.md, paddingTop: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  tall: { minHeight: 96, textAlignVertical: "top" },
  kinds: { gap: spacing.sm },
  kind: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindLabel: { ...typography.body, fontWeight: "700", color: colors.ink },
  kindLabelOn: { color: colors.onPrimary },
  kindDetail: { ...typography.caption, color: colors.inkSoft },
  kindDetailOn: { color: "rgba(255,255,255,0.8)" },
  topic: { ...typography.heading, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  paused: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  pausedText: { ...typography.caption, flex: 1, color: colors.primaryDeep },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden", marginVertical: spacing.sm },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  section: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 6 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  sectionHeading: { ...typography.body, fontWeight: "700", flex: 1, color: colors.ink },
  sectionWait: { ...typography.caption, color: colors.inkSoft },
  sectionBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 19 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 54, marginTop: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary, ...shadow },
  primaryText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  downloads: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  secondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  secondaryText: { ...typography.body, fontWeight: "700", color: colors.primaryDeep },
  sources: { marginTop: spacing.lg, gap: 5 },
  sourcesTitle: { ...typography.caption, fontWeight: "700", color: colors.inkMuted },
  source: { ...typography.caption, color: colors.inkSoft, lineHeight: 18 },
  workRow: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  workCopy: { gap: 2 },
  workTopic: { ...typography.body, fontWeight: "700", color: colors.ink },
  workMeta: { ...typography.caption, color: colors.inkSoft },
  disabled: { opacity: 0.55 },
  error: { ...typography.caption, color: colors.danger },
}));

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { BookOpen, ChevronDown, ChevronUp, Download, FileText, MessageCircle, Pause, Play, Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import {
  AuthorsEditor, Chips, DetailsEditor, LayoutEditor, OptionCards, SectionCard, StyleChips, authorsProblem,
} from "@/components/AcademicForms";
import { ScreenHeader } from "@/components/ScreenHeader";
import {
  KINDS, PRESETS, STRUCTURES, WORK_LANGUAGES, createWork, emptyAuthor, loadWork, myWorks, planWork, sourceAuthors, workFile, writeNextSection,
  type Author, type CitationStyle, type Layout, type Section, type Structure, type Work, type WorkKind, type WorkLanguage,
} from "@/lib/academic";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Writing an academic work, a section at a time — and dressing it as the
 * journal asks.
 *
 * The loop is driven from here rather than from the server, which is what makes
 * the screen honest: each section is one request, so progress is real rather
 * than a spinner with a guess under it, stopping halfway keeps everything
 * written, and running out of coins is a pause with a button instead of a
 * failure with an apology.
 *
 * Around the prose the person sets what a journal requires (§5.6): an
 * article's structure, the language, the authors with ORCID, the UDC code,
 * acknowledgements and funding, the reference style and the layout. All of it
 * but the language and the structure can be changed after the text is
 * written, and the A4 preview shows the pages exactly as the file will be.
 */
export default function IlmiyScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, i18n } = useTranslation("tools");
  const { t: tChat } = useTranslation("chat");
  const router = useRouter();
  const { user } = useAuth();
  const [works, setWorks] = useState<Work[]>([]);
  const [work, setWork] = useState<Work | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [tab, setTab] = useState<"sections" | "details">("sections");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The start of a work.
  const [kind, setKind] = useState<WorkKind>("article");
  const [structure, setStructure] = useState<Structure>("imrad");
  const [language, setLanguage] = useState<WorkLanguage>(
    (WORK_LANGUAGES as string[]).includes(i18n.language) ? i18n.language as WorkLanguage : "uz");
  const [topic, setTopic] = useState("");
  const [field, setField] = useState("");
  const [requirements, setRequirements] = useState("");
  const [authors, setAuthors] = useState<Author[]>([emptyAuthor()]);
  const [style, setStyle] = useState<CitationStyle>("gost");
  const [layout, setLayout] = useState<Layout>(PRESETS.uz);
  const [extras, setExtras] = useState(false);
  const [udc, setUdc] = useState("");
  const [acknowledgements, setAcknowledgements] = useState("");
  const [funding, setFunding] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setWorks(await myWorks()); setError(null); }
    catch (readError) { setError(asErrorMessage(readError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The first author is the person: their name, organisation and e-mail, ready to correct.
  useEffect(() => {
    if (!user) return;
    void supabase.from("profiles").select("first_name, last_name, organization").eq("id", user.id).maybeSingle().then(({ data }) => {
      const name = [data?.last_name, data?.first_name].filter(Boolean).join(" ");
      setAuthors((current) => (current.length === 1 && !current[0]!.name
        ? [{ name, affiliation: data?.organization ?? "", orcid: "", email: user.email ?? "" }]
        : current));
    });
  }, [user]);

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
    if (!topic.trim()) { setError(t("academic.needTopic")); return; }
    const problem = authorsProblem(authors, (key) => t(key as never));
    if (problem) { setError(problem); return; }
    setBusy("create"); setError(null);
    try {
      const created = await createWork({
        kind, topic, field, requirements, language, structure: kind === "article" ? structure : null,
        citationStyle: style, authors, udc, acknowledgements, funding, layout,
      });
      setWork(created);
      setSections([]);
      setTab("sections");
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
          dialogTitle: t("academic.title"),
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
        <ScreenHeader title={t("academic.title")} />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  /* ------------------------------------------------------------- one work */

  if (work) {
    const ready = sections.filter((section) => section.status === "ready").length;
    const total = sections.length;
    const words = sections.reduce((sum, section) => sum + section.words, 0);
    const reload = () => open(work.id);

    return (
      <View style={styles.screen}>
        <ScreenHeader title={t(`academic.kind.${work.kind}.label`)} subtitle={work.structure ? t(`academic.structure.${work.structure}.label`) : undefined} onLeave={() => setWork(null)} />
        <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.topic}>{work.topic}</Text>
          <Text style={styles.meta}>
            {t("academic.meta", { ready, total, words, sources: work.sources.length })}
            {work.empirical ? t("academic.empirical") : ""}
            {` · ${t(`academic.languages.${work.language}`)}`}
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

          {ready < total ? (
            <Pressable disabled={running} onPress={() => void run()} style={[styles.primary, running && styles.disabled]}>
              {running
                ? <><ActivityIndicator color={colors.onPrimary} size="small" /><Text style={styles.primaryText}>{t("academic.writing")}</Text></>
                : <><Play color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} /><Text style={styles.primaryText}>{ready > 0 ? t("academic.resume") : t("academic.start")}</Text></>}
            </Pressable>
          ) : null}

          {ready > 0 ? (
            <>
              {/* The pages as the file will set them, before anything is downloaded. */}
              <Pressable onPress={() => router.push({ pathname: "/(app)/ilmiy-preview/[id]", params: { id: work.id } })} style={[styles.primary, styles.previewButton]}>
                <FileText color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} />
                <Text style={styles.primaryText}>{t("academic.preview")}</Text>
              </Pressable>
              <View style={styles.downloads}>
                {(["docx", "pdf"] as const).map((format) => (
                  <Pressable key={format} disabled={busy !== null} onPress={() => void download(format)} style={[styles.secondary, busy !== null && styles.disabled]}>
                    {busy === format
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <><Download color={colors.primary} size={icon.sm} strokeWidth={2} /><Text style={styles.secondaryText}>{format.toUpperCase()}</Text></>}
                  </Pressable>
                ))}
                <Pressable
                  disabled={busy !== null}
                  onPress={() => router.push({ pathname: "/(app)/chat/share", params: { kind: "academic", id: work.id, title: work.topic } })}
                  style={[styles.secondary, busy !== null && styles.disabled]}
                >
                  <MessageCircle color={colors.primary} size={icon.sm} strokeWidth={2} />
                  <Text style={styles.secondaryText}>{tChat("sendToChat")}</Text>
                </Pressable>
              </View>
            </>
          ) : null}

          <View style={styles.tabs}>
            {(["sections", "details"] as const).map((key) => (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabOn]}>
                <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{t(`academic.tabs.${key}`)}</Text>
              </Pressable>
            ))}
          </View>

          {tab === "sections" ? (
            <>
              {sections.some((section) => section.status === "ready") ? <Text style={styles.hint}>{t("academic.figureHint")}</Text> : null}
              {sections.map((section) => (
                <SectionCard key={`${section.id}-${section.edited_at ?? ""}-${section.figures.length}`} section={section} workId={work.id} ownerId={user?.id ?? ""} onChanged={reload} />
              ))}
              {work.sources.length > 0 ? (
                <View style={styles.sources}>
                  <Text style={styles.sourcesTitle}>{t("academic.sources")}</Text>
                  {work.sources.map((source, index) => (
                    <Text key={`${source.title}-${index}`} style={styles.source}>
                      {index + 1}. {sourceAuthors(source) ? `${sourceAuthors(source)}. ` : ""}{source.title}{source.year ? `, ${source.year}` : ""}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <DetailsEditor key={work.id} work={work} onSaved={reload} />
          )}
        </KeyboardAwareScrollView>
      </View>
    );
  }

  /* ------------------------------------------------------------ the start */

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("academic.title")} />
      <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.label}>{t("academic.type")}</Text>
        <View style={styles.kinds}>
          {KINDS.map((entry) => (
            <Pressable key={entry.kind} onPress={() => setKind(entry.kind)} style={[styles.kind, kind === entry.kind && styles.kindOn]}>
              <BookOpen color={kind === entry.kind ? colors.onPrimary : colors.primary} size={18} strokeWidth={2} />
              <Text style={[styles.kindLabel, kind === entry.kind && styles.kindLabelOn]}>{t(`academic.kind.${entry.kind}.label`)}</Text>
              <Text style={[styles.kindDetail, kind === entry.kind && styles.kindDetailOn]}>{t(`academic.kind.${entry.kind}.detail`)}</Text>
            </Pressable>
          ))}
        </View>

        {kind === "article" ? (
          <>
            <Text style={styles.label}>{t("academic.structureTitle")}</Text>
            <OptionCards options={STRUCTURES} value={structure} onChange={setStructure}
              label={(value) => t(`academic.structure.${value}.label`)} detail={(value) => t(`academic.structure.${value}.detail`)} />
          </>
        ) : null}

        <Text style={styles.label}>{t("academic.language")}</Text>
        <Chips options={WORK_LANGUAGES} value={language} onChange={setLanguage} label={(value) => t(`academic.languages.${value}`)} />

        <Text style={styles.label}>{t("academic.topic")}</Text>
        <TextInput value={topic} onChangeText={setTopic} placeholder={t("academic.topicPlaceholder")} placeholderTextColor={colors.inkSoft} style={styles.input} multiline maxLength={300} />

        <Text style={styles.label}>{t("academic.field")}</Text>
        <TextInput value={field} onChangeText={setField} placeholder={t("academic.fieldPlaceholder")} placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={160} />

        <Text style={styles.label}>{t("academic.requirements")}</Text>
        <TextInput value={requirements} onChangeText={setRequirements} placeholder={t("academic.requirementsPlaceholder")} placeholderTextColor={colors.inkSoft} style={[styles.input, styles.tall]} multiline maxLength={800} />

        <Text style={styles.label}>{t("academic.authors")}</Text>
        <AuthorsEditor authors={authors} onChange={setAuthors} />

        <Text style={styles.label}>{t("academic.style")}</Text>
        <StyleChips value={style} onChange={setStyle} />

        <Text style={styles.label}>{t("academic.layout")}</Text>
        <LayoutEditor layout={layout} onChange={setLayout} />

        <Pressable onPress={() => setExtras((value) => !value)} style={styles.extras}>
          <Text style={styles.extrasText}>{t("academic.extras")}</Text>
          {extras ? <ChevronUp color={colors.primary} size={18} /> : <ChevronDown color={colors.primary} size={18} />}
        </Pressable>
        {extras ? (
          <View style={{ gap: spacing.xs }}>
            {kind === "article" ? (
              <>
                <Text style={styles.label}>{t("academic.udc")}</Text>
                <TextInput value={udc} onChangeText={setUdc} placeholder="070.1" placeholderTextColor={colors.inkSoft} style={styles.input} maxLength={60} />
                <Text style={styles.hint}>{t("academic.udcHint")}</Text>
              </>
            ) : null}
            <Text style={styles.label}>{t("academic.acknowledgements")}</Text>
            <TextInput value={acknowledgements} onChangeText={setAcknowledgements} style={[styles.input, styles.tall]} multiline maxLength={3000} />
            <Text style={styles.label}>{t("academic.funding")}</Text>
            <TextInput value={funding} onChangeText={setFunding} style={[styles.input, styles.tall]} multiline maxLength={3000} />
            <Text style={styles.hint}>{t("academic.fundingHint")}</Text>
          </View>
        ) : null}

        <Pressable disabled={busy !== null} onPress={() => void start()} style={[styles.primary, busy !== null && styles.disabled]}>
          {busy
            ? <><ActivityIndicator color={colors.onPrimary} size="small" /><Text style={styles.primaryText}>{busy === "plan" ? t("academic.planning") : t("academic.preparing")}</Text></>
            : <><Sparkles color={colors.onPrimary} size={icon.sm} strokeWidth={2.2} /><Text style={styles.primaryText}>{t("academic.plan")}</Text></>}
        </Pressable>

        {works.length > 0 ? (
          <>
            <Text style={styles.label}>{t("academic.started")}</Text>
            {works.map((entry) => (
              <Pressable key={entry.id} onPress={() => void open(entry.id)} style={styles.workRow}>
                <View style={styles.workCopy}>
                  <Text style={styles.workTopic} numberOfLines={1}>{entry.topic}</Text>
                  <Text style={styles.workMeta}>
                    {t(`academic.kind.${entry.kind}.label`)}{entry.structure ? ` · ${t(`academic.structure.${entry.structure}.label`)}` : ""} · {t(`academic.status.${entry.status}`)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.sm },
  label: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.md },
  hint: { ...typography.caption, color: colors.inkSoft },
  input: { ...typography.body, color: colors.ink, minHeight: 48, paddingHorizontal: spacing.md, paddingTop: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  tall: { minHeight: 96, textAlignVertical: "top" },
  kinds: { gap: spacing.sm },
  kind: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  kindOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindLabel: { ...typography.body, fontWeight: "700", color: colors.ink },
  kindLabelOn: { color: colors.onPrimary },
  kindDetail: { ...typography.caption, color: colors.inkSoft },
  kindDetailOn: { color: "rgba(255,255,255,0.8)" },
  extras: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md, paddingVertical: spacing.sm },
  extrasText: { ...typography.body, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary, flex: 1 },
  topic: { ...typography.heading, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  paused: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  pausedText: { ...typography.caption, flex: 1, color: colors.primaryDeep },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden", marginVertical: spacing.sm },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 54, marginTop: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary, ...shadow },
  previewButton: { marginTop: spacing.xs },
  primaryText: { ...typography.body, fontWeight: "700", color: colors.onPrimary },
  downloads: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  secondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  secondaryText: { ...typography.body, fontWeight: "700", color: colors.primaryDeep },
  tabs: { flexDirection: "row", gap: 4, padding: 4, marginTop: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.surface },
  tabText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.inkMuted },
  tabTextOn: { color: colors.primaryDeep },
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

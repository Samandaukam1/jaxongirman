import * as FileSystem from "expo-file-system/legacy";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { ArrowLeft, ChevronRight, Download, FileDown, Gamepad2, MonitorPlay, PenLine, RefreshCw, Sparkles, Store } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DeckViewer } from "@/components/DeckViewer";
import { ExportSheet } from "@/components/ExportSheet";
import { GlassAction, GlassPanel } from "@/components/Glass";
import { PublishSheet } from "@/components/PublishSheet";
import { Skeleton } from "@/components/StateBlocks";
import { formatDate } from "@/lib/datetime";
import { loadDeck, loadDeckFonts, type Deck } from "@/lib/deck";
import { defensePdf, defensePdfUrl, loadDefense, writeDefense, type Defense } from "@/lib/defense";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { generateGame } from "@/lib/games";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The finished deck.
 *
 * Where a person lands when their presentation is ready, and where it opens
 * from Loyihalar: the slides large, three small actions under them, and the
 * spoken script below — because those two things are what they came for. The
 * editor is one tap away rather than the first thing in their face; it used to
 * be the landing page, and a screen full of tools is the wrong answer to "is my
 * presentation done?".
 */
export default function DeckScreen() {
  const { t } = useTranslation(["deck", "common"]);
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [room, setRoom] = useState<number | null>(null);
  const params = useLocalSearchParams<{ id: string; withGame?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const wantsGame = params.withGame === "1";

  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [defense, setDefense] = useState<Defense | null | undefined>(undefined);
  const [defenseBusy, setDefenseBusy] = useState<"write" | "pdf" | null>(null);
  const [defenseError, setDefenseError] = useState<string | null>(null);
  const [game, setGame] = useState<{ state: "idle" | "working" | "ready" | "failed"; id?: string; error?: string }>({ state: "idle" });
  const gameStarted = useRef(false);

  const loadAll = useCallback(async () => {
    if (!id) return;
    try {
      const next = await loadDeck(id);
      setDeck(next);
      setError(null);
      void loadDeckFonts(next.elements).then(() => setRevision((value) => value + 1));
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [id]);

  // Re-read on focus: coming back from the editor should show what was edited.
  useFocusEffect(useCallback(() => { void loadAll(); }, [loadAll]));

  /**
   * The script is written by the server right after the deck, so for the
   * first minute or two it is usually on its way. Polled until it settles —
   * and never longer than five minutes, so an abandoned job does not keep a
   * phone busy.
   */
  const loadScript = useCallback(async () => {
    if (!id) return null;
    try {
      const next = await loadDefense(id);
      setDefense(next);
      return next;
    } catch (failure) {
      setDefenseError(asErrorMessage(failure));
      return null;
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const tick = async () => {
      const next = await loadScript();
      if (!active) return;
      const young = deck ? Date.now() - new Date(deck.presentation.updated_at).getTime() < 5 * 60_000 : true;
      const pending = next?.status === "generating" || (next === null && young);
      if (pending && Date.now() - started < 5 * 60_000) timer = setTimeout(() => void tick(), 4000);
    };
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
    // `deck` only decides how long to wait; reading it later is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadScript]);

  // The match that was asked for on the create screen, made from these slides.
  useEffect(() => {
    if (!wantsGame || !id || gameStarted.current || !deck) return;
    gameStarted.current = true;
    setGame({ state: "working" });
    void generateGame({ mode: "presentation", presentationId: id })
      .then((result) => setGame({ state: "ready", id: result.gameId }))
      .catch(async (failure) => setGame({ state: "failed", error: await asFunctionErrorMessage(failure) }));
  }, [deck, id, wantsGame]);

  async function writeScript() {
    if (!id) return;
    setDefenseBusy("write");
    setDefenseError(null);
    try {
      await writeDefense(id);
      await loadScript();
    } catch (failure) {
      setDefenseError(asErrorMessage(failure));
    } finally {
      setDefenseBusy(null);
    }
  }

  async function downloadScript() {
    if (!id) return;
    setDefenseBusy("pdf");
    setDefenseError(null);
    try {
      const { storagePath } = await defensePdf(id);
      const url = await defensePdfUrl(storagePath);
      if (Platform.OS === "web") {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
      const { uri } = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${t("script.fileName")}.pdf`);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: t("script.title") });
      }
    } catch (failure) {
      setDefenseError(asErrorMessage(failure));
    } finally {
      setDefenseBusy(null);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/(tabs)/projects"));
  // A browser window is measured where the page actually sits (beside the side
  // menu, in its column), not across the whole screen.
  const slideWidth = Platform.OS === "web" && room
    ? Math.min(room - spacing.lg * 2, 1100)
    : Math.min(screenWidth - spacing.lg * 2, 720);

  if (!deck) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common:back")} onPress={back} style={styles.round}>
            <ArrowLeft color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
        </View>
        {error ? (
          <View style={styles.centered}>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={() => void loadAll()} style={styles.retry}><Text style={styles.retryText}>{t("common:retry")}</Text></Pressable>
          </View>
        ) : (
          <View style={styles.loadingBody}>
            <Skeleton height={(slideWidth * 562.5) / 1000} radius={radius.lg} />
            <Skeleton height={62} radius={radius.lg} />
            <Skeleton height={180} radius={radius.lg} />
          </View>
        )}
      </View>
    );
  }

  const { presentation, slides, elements } = deck;

  return (
    <View style={styles.screen} onLayout={Platform.OS === "web" ? (event) => setRoom(event.nativeEvent.layout.width) : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl }]} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common:back")} onPress={back} style={styles.round}>
            <ArrowLeft color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{t("ready")}</Text>
            <Text style={styles.meta} numberOfLines={1}>{t("meta", { count: slides.length, date: formatDate(presentation.created_at) })}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={3}>{presentation.title}</Text>

        {slides.length ? (
          <DeckViewer slides={slides} elements={elements} width={slideWidth} revision={revision} />
        ) : (
          <GlassPanel><Text style={styles.empty}>{t("empty")}</Text></GlassPanel>
        )}

        <View style={styles.actions}>
          <GlassAction icon={Download} label={t("download")} onPress={() => setExportOpen(true)} />
          <GlassAction icon={PenLine} label={t("edit")} onPress={() => router.push({ pathname: "/(app)/presentation/[id]/edit", params: { id: presentation.id } })} />
          <GlassAction icon={MonitorPlay} label={t("present")} tone="brand" onPress={() => router.push({ pathname: "/(app)/present/scan", params: { presentationId: presentation.id } })} />
        </View>

        {/* Selling the deck: the server says up front whether it goes live at once. */}
        <Pressable accessibilityRole="button" onPress={() => setPublishOpen(true)} style={styles.gameRow}>
          <Store color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
          <Text style={styles.gameText} numberOfLines={2}>{t("sell")}</Text>
          <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2} />
        </Pressable>

        {wantsGame && game.state !== "idle" ? (
          <Pressable
            disabled={game.state !== "ready"}
            onPress={() => game.id && router.push({ pathname: "/(app)/oyingoh/[id]", params: { id: game.id } })}
            style={styles.gameRow}
          >
            <Gamepad2 color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
            <Text style={styles.gameText} numberOfLines={2}>
              {game.state === "working" ? t("game.working") : game.state === "ready" ? t("game.ready") : t("game.failed", { reason: game.error ?? "" })}
            </Text>
            {game.state === "working" ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </Pressable>
        ) : null}

        {/* The script: the second thing on the page, given room to be read. */}
        <View style={styles.scriptHead}>
          <View style={styles.scriptHeadCopy}>
            <Text style={styles.sectionTitle}>{t("script.title")}</Text>
            <Text style={styles.sectionHint}>{t("script.hint")}</Text>
          </View>
          {defense?.status === "ready" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("script.pdf")}
              onPress={() => void downloadScript()}
              disabled={defenseBusy !== null}
              style={styles.pdfButton}
            >
              {defenseBusy === "pdf" ? <ActivityIndicator size="small" color={colors.primary} /> : <FileDown color={colors.primary} size={16} strokeWidth={2.2} />}
              <Text style={styles.pdfText}>PDF</Text>
            </Pressable>
          ) : null}
        </View>

        {defenseError ? <Text style={styles.error}>{defenseError}</Text> : null}

        <Script
          defense={defense}
          busy={defenseBusy === "write"}
          onWrite={() => void writeScript()}
        />
      </ScrollView>

      <PublishSheet visible={publishOpen} deck={deck} onClose={() => setPublishOpen(false)} />

      <ExportSheet
        visible={exportOpen}
        presentationId={presentation.id}
        presentationTitle={presentation.title}
        onClose={() => setExportOpen(false)}
      />
    </View>
  );
}

/** The script itself, in whatever state the server has it. */
function Script({ defense, busy, onWrite }: { defense: Defense | null | undefined; busy: boolean; onWrite: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t, i18n } = useTranslation("deck");

  if (defense === undefined || defense?.status === "generating" || (defense === null && busy)) {
    return (
      <GlassPanel>
        <View style={styles.writing}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.writingText}>{t("script.writing")}</Text>
        </View>
        <View style={styles.skeletons}>
          <Skeleton height={12} width="92%" />
          <Skeleton height={12} width="84%" />
          <Skeleton height={12} width="66%" />
        </View>
      </GlassPanel>
    );
  }

  if (!defense || defense.status === "failed") {
    return (
      <GlassPanel>
        <Text style={styles.paragraph}>
          {defense?.failureReason ? (i18n.language === "uz" ? defense.failureReason : t("script.failed")) : t("script.intro")}
        </Text>
        <Pressable accessibilityRole="button" onPress={onWrite} disabled={busy} style={[styles.writeButton, busy && styles.dim]}>
          {busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Sparkles color={colors.onPrimary} size={16} strokeWidth={2.2} />}
          <Text style={styles.writeText}>{t("script.write")}</Text>
        </Pressable>
      </GlassPanel>
    );
  }

  return (
    <View style={styles.script}>
      {defense.stale ? (
        <Pressable onPress={onWrite} disabled={busy} style={styles.stale}>
          {busy ? <ActivityIndicator size="small" color={colors.primaryDeep} /> : <RefreshCw color={colors.primaryDeep} size={14} strokeWidth={2.2} />}
          <Text style={styles.staleText}>{t("script.stale")}</Text>
        </Pressable>
      ) : null}

      {defense.introduction ? (
        <View style={styles.part}>
          <Text style={styles.partLabel}>KIRISH</Text>
          <Text style={styles.paragraph}>{defense.introduction}</Text>
        </View>
      ) : null}

      {defense.sections.map((section) => (
        <View key={`${section.slide_number}-${section.slide_title}`} style={styles.part}>
          <View style={styles.partHead}>
            <View style={styles.badge}><Text style={styles.badgeText}>{section.slide_number}</Text></View>
            <Text style={styles.partTitle} numberOfLines={2}>{section.slide_title}</Text>
          </View>
          <Text style={styles.paragraph}>{section.speaker_text}</Text>
          {section.key_point ? (
            <View style={styles.keyPoint}>
              <Text style={styles.keyPointText}>{section.key_point}</Text>
            </View>
          ) : null}
        </View>
      ))}

      {defense.conclusion ? (
        <View style={styles.part}>
          <Text style={styles.partLabel}>XULOSA</Text>
          <Text style={styles.paragraph}>{defense.conclusion}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  loadingBody: { padding: spacing.lg, gap: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: 0 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.success, letterSpacing: 1.2 },
  meta: { ...typography.caption, color: colors.inkSoft },
  title: { ...typography.title, fontSize: 24, lineHeight: 31, color: colors.ink },
  empty: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm },
  gameRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft,
  },
  gameText: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.primaryDeep, flex: 1 },
  scriptHead: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md, marginTop: spacing.sm },
  scriptHeadCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionHint: { ...typography.caption, color: colors.inkSoft },
  pdfButton: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  pdfText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
  error: { ...typography.caption, color: colors.danger },
  retry: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  retryText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
  writing: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  writingText: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.inkMuted },
  skeletons: { gap: spacing.sm, marginTop: spacing.md },
  writeButton: {
    marginTop: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  writeText: { ...typography.bodyMedium, color: colors.onPrimary },
  dim: { opacity: 0.6 },
  script: {
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.sm, overflow: "hidden",
  },
  stale: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  staleText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep, flex: 1 },
  part: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  partHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partLabel: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary, letterSpacing: 1.1 },
  partTitle: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  badge: { minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  badgeText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primary },
  // Set for reading aloud at arm's length.
  paragraph: { fontFamily: "Manrope_400Regular", fontSize: 16, lineHeight: 26, color: colors.ink },
  keyPoint: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, paddingVertical: 2 },
  keyPointText: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.inkMuted },
}));

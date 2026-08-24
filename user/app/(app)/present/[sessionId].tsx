import {
  RESET_PRESENTATION_VIEWPORT,
  clampPresentationViewport,
  type Json,
  type PresentationViewport,
  type Tables,
} from "@jaxongirman/types";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Eye, EyeOff, Gamepad2, PowerOff, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";

import { PresentationPreview, type PresentationPreviewHandle } from "@/components/PresentationPreview";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { launchPresentationGame, presentationHasGame } from "@/lib/games";
import { loadDefense, type Defense } from "@/lib/defense";
import { supabase } from "@/lib/supabase";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Session = Tables<"presentation_sessions"> & {
  translate_x?: number;
  translate_y?: number;
  realtime_token?: string | null;
};
type Slide = Tables<"slides">;
type Element = Tables<"slide_elements">;
type Deck = { id: string; title: string; slide_count: number };
type JsonObject = { [key: string]: Json | undefined };
type ViewportMessage = {
  scale: number;
  translate_x: number;
  translate_y: number;
  slide: number;
};

const DECK_REFRESH_MS = 50 * 60 * 1000;

function object(value: Json): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function viewportOf(session: Session): PresentationViewport {
  return clampPresentationViewport({
    scale: session.zoom,
    translateX: session.translate_x ?? 0,
    translateY: session.translate_y ?? 0,
  });
}

function viewportMessage(value: unknown): ViewportMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const scale = Number(row.scale);
  const translateX = Number(row.translate_x);
  const translateY = Number(row.translate_y);
  const slide = Number(row.slide);
  if (![scale, translateX, translateY, slide].every(Number.isFinite)) return null;
  const safe = clampPresentationViewport({ scale, translateX, translateY });
  return { scale: safe.scale, translate_x: safe.translateX, translate_y: safe.translateY, slide };
}

async function hydrateImages(rows: Element[]): Promise<Element[]> {
  const requested = new Map<string, Set<string>>();
  for (const element of rows) {
    if (element.type !== "image") continue;
    const content = object(element.content);
    const bucket = typeof content.storageBucket === "string" ? content.storageBucket : null;
    const path = typeof content.storagePath === "string" ? content.storagePath : null;
    if (!bucket || !path) continue;
    const paths = requested.get(bucket) ?? new Set<string>();
    paths.add(path);
    requested.set(bucket, paths);
  }

  const signed = new Map<string, string>();
  await Promise.all([...requested.entries()].map(async ([bucket, paths]) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls([...paths], 3600);
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) signed.set(`${bucket}:${item.path}`, item.signedUrl);
    }
  }));
  for (const [bucket, paths] of requested) {
    for (const path of paths) {
      if (!signed.has(`${bucket}:${path}`)) throw new Error("Private slide image could not be signed");
    }
  }

  return rows.map((element) => {
    if (element.type !== "image") return element;
    const content = object(element.content);
    const bucket = typeof content.storageBucket === "string" ? content.storageBucket : null;
    const path = typeof content.storagePath === "string" ? content.storagePath : null;
    const signedUrl = bucket && path ? signed.get(`${bucket}:${path}`) : null;
    return signedUrl ? { ...element, content: { ...content, signedUrl } } : element;
  });
}

/** The phone renders and manipulates the same deck that the projector follows. */
export default function RemoteScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";

  const [session, setSession] = useState<Session | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [elements, setElements] = useState<Element[]>([]);
  const [viewport, setViewport] = useState<PresentationViewport>({ ...RESET_PRESENTATION_VIEWPORT });
  const [loading, setLoading] = useState(true);
  const [deckLoading, setDeckLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  /** Whether a ready O‘yingoh is linked to the deck on screen. */
  const [hasGame, setHasGame] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sessionConnected, setSessionConnected] = useState(false);
  const [viewportConnected, setViewportConnected] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const viewportChannel = useRef<RealtimeChannel | null>(null);
  const deckLoadSequence = useRef(0);
  const previewRef = useRef<PresentationPreviewHandle>(null);
  const connected = sessionConnected && (!session?.realtime_token || viewportConnected);

  useEffect(() => { sessionRef.current = session; }, [session]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    const [sessionResult, deckResult] = await Promise.all([
      supabase.from("presentation_sessions").select("*").eq("id", sessionId).maybeSingle(),
      supabase.from("presentations").select("id,title,slides(count)").eq("status", "ready").order("created_at", { ascending: false }).limit(30),
    ]);
    if (sessionResult.error || !sessionResult.data) {
      setError(sessionResult.error ? asErrorMessage(sessionResult.error) : "Sessiya topilmadi.");
    } else {
      const next = sessionResult.data as Session;
      setSession(next);
      setViewport(viewportOf(next));
      setError(null);
    }
    setDecks((deckResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      slide_count: (row.slides as unknown as { count: number }[])?.[0]?.count ?? 0,
    })));
    setLoading(false);
  }, [sessionId]);

  /**
   * The spoken script, beside the slide it belongs to.
   *
   * This screen is what the presenter is actually holding while they talk, so
   * it is where the script has to be — reading it anywhere else means leaving
   * the remote, and nobody does that mid-sentence. Hidden with one tap for
   * people who would rather look at the room.
   */
  const [defense, setDefense] = useState<Defense | null>(null);
  const [showScript, setShowScript] = useState(true);

  const loadDeck = useCallback(async (presentationId: string) => {
    const sequence = ++deckLoadSequence.current;
    setDeckLoading(true);
    setDeckError(null);
    try {
      const [slideResult, elementResult] = await Promise.all([
        supabase.from("slides").select("*").eq("presentation_id", presentationId).order("position"),
        supabase.from("slide_elements").select("*").eq("presentation_id", presentationId).order("z_index"),
      ]);
      if (slideResult.error) throw slideResult.error;
      if (elementResult.error) throw elementResult.error;
      const hydrated = await hydrateImages(elementResult.data);
      if (sequence !== deckLoadSequence.current) return;
      setSlides(slideResult.data);
      setElements(hydrated);
    } catch (deckFailure) {
      if (sequence !== deckLoadSequence.current) return;
      console.error("presentation preview load failed", deckFailure);
      setSlides([]);
      setElements([]);
      setDeckError("Slayd yuklanmadi.");
    } finally {
      if (sequence === deckLoadSequence.current) setDeckLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!session?.presentation_id) {
      deckLoadSequence.current += 1;
      setSlides([]);
      setElements([]);
      return;
    }
    setSlides([]);
    setElements([]);
    void loadDeck(session.presentation_id);
  }, [loadDeck, session?.presentation_id]);

  useEffect(() => {
    const presentationId = session?.presentation_id;
    if (!presentationId || session.status !== "active") return;
    const timer = setInterval(() => void loadDeck(presentationId), DECK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loadDeck, session?.presentation_id, session?.status]);

  // Navigation and final viewport snapshots use the session row as their single
  // durable source of truth.
  useEffect(() => {
    if (!sessionId) return;
    let subscribed = true;
    setSessionConnected(false);
    const channel = supabase
      .channel(`remote-session-${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "presentation_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          const next = payload.new as Session;
          setSession(next);
          setViewport(viewportOf(next));
        })
      .subscribe((status) => {
        if (subscribed) setSessionConnected(status === "SUBSCRIBED");
      });
    return () => {
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Gesture frames travel over an unguessable session topic, never through a DB
  // write. The final frame is committed separately below.
  useEffect(() => {
    const token = session?.realtime_token;
    if (!token) return;
    let subscribed = true;
    setViewportConnected(false);
    const channel = supabase
      .channel(`presentation-viewport:${token}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "viewport" }, ({ payload }) => {
        const message = viewportMessage(payload);
        if (!message || message.slide !== sessionRef.current?.current_slide) return;
        setViewport({ scale: message.scale, translateX: message.translate_x, translateY: message.translate_y });
      })
      .subscribe((status) => {
        if (subscribed) setViewportConnected(status === "SUBSCRIBED");
      });
    viewportChannel.current = channel;
    return () => {
      subscribed = false;
      if (viewportChannel.current === channel) viewportChannel.current = null;
      void supabase.removeChannel(channel);
    };
  }, [session?.realtime_token]);

  // Whether the launch button belongs on screen at all. Re-asked when the deck
  // changes, because a different deck has a different answer.
  useEffect(() => {
    const presentationId = session?.presentation_id;
    if (!presentationId) { setDefense(null); return; }
    let alive = true;
    // A deck with no script is the ordinary case, not an error: the card simply
    // does not appear.
    loadDefense(presentationId).then((script) => { if (alive) setDefense(script); }).catch(() => {});
    return () => { alive = false; };
  }, [session?.presentation_id]);

  useEffect(() => {
    const presentationId = session?.presentation_id;
    if (!presentationId) { setHasGame(false); return; }
    let active = true;
    void presentationHasGame(presentationId)
      .then((answer) => { if (active) setHasGame(Boolean(answer)); })
      .catch(() => { if (active) setHasGame(false); });
    return () => { active = false; };
  }, [session?.presentation_id]);

  const currentSlide = useMemo(
    () => slides.find((slide) => slide.position === session?.current_slide) ?? null,
    [session?.current_slide, slides],
  );
  const currentElements = useMemo(
    () => currentSlide ? elements.filter((element) => element.slide_id === currentSlide.id) : [],
    [currentSlide, elements],
  );

  // Warm the adjacent slides while the current one is on screen.
  useEffect(() => {
    if (!session || !slides.length) return;
    const nearby = new Set(slides
      .filter((slide) => Math.abs(slide.position - session.current_slide) <= 1)
      .map((slide) => slide.id));
    for (const element of elements) {
      if (element.type !== "image" || !nearby.has(element.slide_id)) continue;
      const uri = object(element.content).signedUrl;
      if (typeof uri === "string") void Image.prefetch(uri);
    }
  }, [elements, session, slides]);

  async function send(command: string, value?: number) {
    setCommandError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { data, error: commandFailure } = await supabase.rpc("presentation_command", {
      p_session_id: sessionId,
      p_command: command,
      p_value: value,
    });
    if (commandFailure) { setCommandError(asErrorMessage(commandFailure)); return; }
    const next = data as unknown as Session;
    setSession(next);
    setViewport(viewportOf(next));
    if (command === "end") router.replace("/(app)/(tabs)/projects");
  }

  /**
   * Hands the projector over to O‘yingoh.
   *
   * The new match carries its own capabilities; the raw screen token travels on
   * the presentation's private broadcast channel — the one channel only this
   * phone and that projector know the name of — so the screen can authorise its
   * own reads without anybody signing in on it.
   */
  async function launchGame() {
    setLaunching(true);
    setCommandError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const match = await launchPresentationGame(sessionId);
      await viewportChannel.current?.send({
        type: "broadcast",
        event: "oyingoh",
        payload: { session_id: match.game_session_id, screen_token: match.screen_token },
      });
      router.replace({ pathname: "/(app)/oyingoh/host/[sessionId]", params: { sessionId: match.game_session_id } });
    } catch (failure) {
      setCommandError(asErrorMessage(failure));
      setLaunching(false);
    }
  }

  async function chooseDeck(deck: Deck) {
    const { data, error: deckFailure } = await supabase.rpc("presentation_session_set_deck", {
      p_session_id: sessionId,
      p_presentation_id: deck.id,
    });
    if (deckFailure) setCommandError(asErrorMessage(deckFailure));
    else {
      const next = data as unknown as Session;
      setSession(next);
      setViewport(viewportOf(next));
    }
  }

  const changeViewport = useCallback((next: PresentationViewport, final: boolean) => {
    const safe = clampPresentationViewport(next);
    setViewport(safe);
    const slide = sessionRef.current?.current_slide ?? 0;
    void viewportChannel.current?.send({
      type: "broadcast",
      event: "viewport",
      payload: { scale: safe.scale, translate_x: safe.translateX, translate_y: safe.translateY, slide },
    });
    if (!final) return;
    void supabase.rpc("presentation_viewport_commit", {
      p_session_id: sessionId,
      p_scale: safe.scale,
      p_translate_x: safe.translateX,
      p_translate_y: safe.translateY,
      p_slide: slide,
    }).then(({ data, error: viewportError }) => {
      if (viewportError) setCommandError(asErrorMessage(viewportError));
      else if (data) setSession(data as unknown as Session);
    });
  }, [sessionId]);

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Pult" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (error || !session) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Pult" />
        <View style={styles.content}><ErrorState message={error ?? "Sessiya topilmadi"} onRetry={() => void load()} /></View>
      </View>
    );
  }

  const ended = session.status === "ended" || session.status === "expired";

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Taqdimot pulti"
        subtitle={ended ? "Sessiya yakunlandi" : connected ? "Ekran ulangan" : "Qayta ulanmoqda…"}
        variant="close"
        onLeave={() => router.replace("/(app)/(tabs)/projects")}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!connected ? <InlineError message="Ulanish uzildi. Qayta ulanmoqda..." /> : null}
        {session.presentation_id === null ? (
          <>
            <Text style={styles.sectionTitle}>Qaysi taqdimot ko‘rsatilsin?</Text>
            <View style={styles.deckList}>
              {decks.map((deck) => (
                <Pressable key={deck.id} accessibilityRole="button" onPress={() => void chooseDeck(deck)} style={styles.deckRow}>
                  <Text numberOfLines={1} style={styles.deckTitle}>{deck.title}</Text>
                  <Text style={styles.deckMeta}>{deck.slide_count} slayd</Text>
                </Pressable>
              ))}
              {decks.length === 0 ? <Text style={styles.hint}>Tayyor taqdimot topilmadi. Avval Loyihalar bo‘limida taqdimot yarating.</Text> : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.stageHeader}>
              <Text style={styles.stageLabel}>Joriy slayd</Text>
              <View style={styles.stageRight}>
                {/* Reset belongs beside what it resets, not at the end of a
                    scroll: it undoes a zoom, and a zoom is on the picture. */}
                <Pressable accessibilityLabel="Masshtabni asliga qaytarish" disabled={ended} onPress={() => previewRef.current?.reset()} style={styles.resetButton}>
                  <RotateCcw color={colors.primary} size={16} strokeWidth={2} />
                  <Text style={styles.resetText}>Reset</Text>
                </Pressable>
                <Text style={styles.stageCount}>{session.slide_count > 0 ? `${session.current_slide + 1} / ${session.slide_count}` : "—"}</Text>
              </View>
            </View>

            {deckLoading ? (
              <View style={styles.previewState}><ActivityIndicator color={colors.primary} size="large" /></View>
            ) : deckError || !currentSlide ? (
              <View style={styles.previewState}>
                <ErrorState message="Slayd yuklanmadi." onRetry={() => {
                  if (session.presentation_id) void loadDeck(session.presentation_id);
                }} />
              </View>
            ) : (
              <PresentationPreview
                ref={previewRef}
                slide={currentSlide}
                elements={currentElements}
                viewport={viewport}
                disabled={ended}
                onViewportChange={changeViewport}
              />
            )}

            <Text style={styles.gestureHint}>Kattalashtirish uchun ikki barmoq bilan suring</Text>

            <View style={styles.navRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Oldingi slayd"
                disabled={ended || session.current_slide <= 0}
                onPress={() => void send("previous")}
                style={({ pressed }) => [styles.navButton, (ended || session.current_slide <= 0) && styles.disabled, pressed && styles.pressed]}
              >
                <ChevronLeft color={colors.primaryDeep} size={34} strokeWidth={2.4} />
                <Text style={styles.navText}>Oldingi</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keyingi slayd"
                disabled={ended || session.current_slide >= session.slide_count - 1}
                onPress={() => void send("next")}
                style={({ pressed }) => [styles.navButton, styles.navPrimary, (ended || session.current_slide >= session.slide_count - 1) && styles.disabled, pressed && styles.pressed]}
              >
                <ChevronRight color={colors.onPrimary} size={34} strokeWidth={2.4} />
                <Text style={[styles.navText, styles.navPrimaryText]}>Keyingi</Text>
              </Pressable>
            </View>

            {/**
              * What to say about the slide that is on the screen right now.
              *
              * Its own scroll, so a long passage does not push the buttons off
              * the bottom — the thing a presenter must never have to hunt for
              * is the one that changes the slide.
              */}
            {defense?.status === "ready" && showScript ? (
              <View style={styles.script}>
                <View style={styles.scriptHead}>
                  <Text style={styles.scriptTitle}>Himoya matni</Text>
                  <Pressable accessibilityLabel="Himoya matnini yashirish" onPress={() => setShowScript(false)} style={styles.scriptHide}>
                    <EyeOff color={colors.inkMuted} size={16} strokeWidth={2} />
                    <Text style={styles.scriptHideText}>Yashirish</Text>
                  </Pressable>
                </View>
                <ScrollView style={styles.scriptScroll} nestedScrollEnabled showsVerticalScrollIndicator>
                  <Text style={styles.scriptBody}>
                    {defense.sections[session.current_slide]?.speaker_text?.trim()
                      || "Bu slayd uchun matn yozilmagan."}
                  </Text>
                  {defense.sections[session.current_slide]?.key_point ? (
                    <Text style={styles.scriptPoint}>
                      Asosiy fikr: {defense.sections[session.current_slide]!.key_point}
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}

            {defense?.status === "ready" && !showScript ? (
              <Pressable accessibilityRole="button" onPress={() => setShowScript(true)} style={styles.scriptShow}>
                <Eye color={colors.primary} size={16} strokeWidth={2} />
                <Text style={styles.scriptShowText}>Himoya matnini ko‘rsatish</Text>
              </Pressable>
            ) : null}

            {commandError ? <InlineError message={commandError} /> : null}

            {hasGame && !ended ? (
              <Pressable
                accessibilityRole="button"
                disabled={launching}
                onPress={() => void launchGame()}
                style={({ pressed }) => [styles.launchButton, pressed && styles.pressed, launching && styles.disabled]}
              >
                {launching
                  ? <ActivityIndicator color={colors.onPrimary} size="small" />
                  : <Gamepad2 color={colors.onPrimary} size={22} strokeWidth={2.2} />}
                <Text style={styles.launchText}>
                  {launching ? "O‘yingoh ochilmoqda…" : "O‘yingohni ishga tushirish"}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={ended}
              onPress={() => Alert.alert("Taqdimotni yakunlash?", "Ekrandagi ko‘rsatuv to‘xtaydi.", [
                { text: "Bekor qilish", style: "cancel" },
                { text: "Yakunlash", style: "destructive", onPress: () => void send("end") },
              ])}
              style={styles.endButton}
            >
              <PowerOff color={colors.danger} size={18} strokeWidth={2} />
              <Text style={styles.endText}>Taqdimotni yakunlash</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  sectionTitle: { ...typography.heading, color: colors.ink },
  deckList: { gap: spacing.sm },
  deckRow: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
  deckTitle: { ...typography.bodyMedium, color: colors.ink },
  deckMeta: { ...typography.caption, color: colors.inkSoft },
  hint: { ...typography.caption, color: colors.inkSoft, lineHeight: 18 },
  stageHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stageLabel: { ...typography.bodyMedium, color: colors.ink },
  stageCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  previewState: { width: "100%", aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  gestureHint: { ...typography.caption, color: colors.inkSoft, textAlign: "center", marginTop: -spacing.sm },
  navRow: { flexDirection: "row", gap: spacing.md },
  navButton: {
    flex: 1, minHeight: 92, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", gap: 2,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, ...shadow,
  },
  navPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  navText: { ...typography.caption, color: colors.primaryDeep },
  navPrimaryText: { color: colors.onPrimary },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.35 },
  stageRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  script: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  scriptHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  scriptTitle: { ...typography.caption, fontWeight: "700", color: colors.primary, letterSpacing: 0.5 },
  scriptHide: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 4, paddingHorizontal: 6 },
  scriptHideText: { ...typography.caption, color: colors.inkMuted },
  // Tall enough for a paragraph, short enough that the buttons stay on screen.
  scriptScroll: { maxHeight: 190 },
  scriptBody: { fontFamily: "Manrope_400Regular", fontSize: 16, lineHeight: 26, color: colors.ink },
  scriptPoint: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm },
  scriptShow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, minHeight: 44, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  scriptShowText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
  resetButton: { alignSelf: "center", minWidth: 132, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  resetText: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },
  launchButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 60, borderRadius: radius.lg, backgroundColor: colors.primary, ...shadow,
  },
  launchText: { ...typography.bodyMedium, color: colors.onPrimary, fontSize: 16 },
  endButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft, backgroundColor: colors.surface },
  endText: { ...typography.bodyMedium, color: colors.danger, fontSize: 14 },
}));

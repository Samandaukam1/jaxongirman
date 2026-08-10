import type { Tables } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Maximize, Minimize, PowerOff, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

type Session = Tables<"presentation_sessions">;
type Deck = { id: string; title: string; slide_count: number };

/**
 * The phone as a remote.
 *
 * Nothing about the presentation lives here: every button calls
 * `presentation_command`, which re-checks that this account is the one that
 * claimed the session and then moves the single row the projector is watching.
 * The screen updates because the row changed, not because this device told it to.
 */
export default function RemoteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";

  const [session, setSession] = useState<Session | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

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
      setSession(sessionResult.data);
      setError(null);
    }
    setDecks((deckResult.data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      slide_count: (row.slides as unknown as { count: number }[])?.[0]?.count ?? 0,
    })));
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // The remote follows the same row the screen does, so two phones on one
  // session — or a slide changed from elsewhere — stay in step.
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`remote-${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "presentation_sessions", filter: `id=eq.${sessionId}` },
        (payload) => setSession(payload.new as Session))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [sessionId]);

  async function send(command: string, value?: number) {
    setCommandError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { data, error: commandFailure } = await supabase.rpc("presentation_command", {
      p_session_id: sessionId,
      p_command: command,
      p_value: value,
    });
    if (commandFailure) { setCommandError(asErrorMessage(commandFailure)); return; }
    setSession(data as unknown as Session);
    if (command === "end") router.replace("/(app)/(tabs)/projects");
  }

  async function chooseDeck(deck: Deck) {
    const { data, error: deckError } = await supabase.rpc("presentation_session_set_deck", {
      p_session_id: sessionId,
      p_presentation_id: deck.id,
    });
    if (deckError) setCommandError(asErrorMessage(deckError));
    else setSession(data as unknown as Session);
  }

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
        subtitle={ended ? "Sessiya yakunlandi" : "Ekran ulangan"}
        variant="close"
        onLeave={() => router.replace("/(app)/(tabs)/projects")}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
              {decks.length === 0 ? (
                <Text style={styles.hint}>Tayyor taqdimot topilmadi. Avval Loyihalar bo‘limida taqdimot yarating.</Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.stage}>
              <Text style={styles.stageLabel}>Joriy slayd</Text>
              <Text style={styles.stageValue}>
                {session.slide_count > 0 ? `${session.current_slide + 1} / ${session.slide_count}` : "—"}
              </Text>
              <Text style={styles.stageZoom}>Masshtab {session.zoom}×</Text>
            </View>

            <View style={styles.navRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Oldingi slayd"
                disabled={ended}
                onPress={() => void send("previous")}
                style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
              >
                <ChevronLeft color={colors.primaryDeep} size={34} strokeWidth={2.4} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keyingi slayd"
                disabled={ended}
                onPress={() => void send("next")}
                style={({ pressed }) => [styles.navButton, styles.navPrimary, pressed && styles.pressed]}
              >
                <ChevronRight color={colors.onPrimary} size={34} strokeWidth={2.4} />
              </Pressable>
            </View>

            <View style={styles.zoomRow}>
              <Pressable accessibilityLabel="Kichraytirish" disabled={ended} onPress={() => void send("zoom_out")} style={styles.zoomButton}>
                <Minimize color={colors.primary} size={18} strokeWidth={2} />
                <Text style={styles.zoomText}>Kichraytirish</Text>
              </Pressable>
              <Pressable accessibilityLabel="Asliga qaytarish" disabled={ended} onPress={() => void send("reset_zoom")} style={styles.zoomButton}>
                <RotateCcw color={colors.primary} size={18} strokeWidth={2} />
                <Text style={styles.zoomText}>Asliga</Text>
              </Pressable>
              <Pressable accessibilityLabel="Kattalashtirish" disabled={ended} onPress={() => void send("zoom_in")} style={styles.zoomButton}>
                <Maximize color={colors.primary} size={18} strokeWidth={2} />
                <Text style={styles.zoomText}>Kattalashtirish</Text>
              </Pressable>
            </View>

            {commandError ? <InlineError message={commandError} /> : null}

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  sectionTitle: { ...typography.heading, color: colors.ink },
  deckList: { gap: spacing.sm },
  deckRow: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
  deckTitle: { ...typography.bodyMedium, color: colors.ink },
  deckMeta: { ...typography.caption, color: colors.inkSoft },
  hint: { ...typography.caption, color: colors.inkSoft, lineHeight: 18 },

  stage: { alignItems: "center", padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primarySoft, gap: 4 },
  stageLabel: { ...typography.caption, color: colors.primaryDeep },
  stageValue: { fontFamily: "Manrope_700Bold", fontSize: 56, lineHeight: 64, color: colors.primaryDeep, letterSpacing: -2 },
  stageZoom: { ...typography.caption, color: colors.inkMuted },

  navRow: { flexDirection: "row", gap: spacing.md },
  navButton: {
    flex: 1, height: 120, borderRadius: radius.xl, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, ...shadow,
  },
  navPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  zoomRow: { flexDirection: "row", gap: spacing.sm },
  zoomButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  zoomText: { ...typography.caption, fontSize: 11, color: colors.primary },

  endButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerSoft, backgroundColor: colors.surface },
  endText: { ...typography.bodyMedium, color: colors.danger, fontSize: 14 },
});

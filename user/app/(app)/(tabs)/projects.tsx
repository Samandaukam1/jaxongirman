import type { Tables } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { FileText, FileUp, GraduationCap, Image as Image_, MonitorPlay, Sparkles } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { CreateDeckButton } from "@/components/CreateDeckButton";
import { PresentationCard } from "@/components/PresentationCard";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

type Presentation = Tables<"presentations">;

/**
 * The presentation generator's home, unchanged in behaviour — it simply lives on
 * its own tab now that the app has a dashboard in front of it. The balance and
 * inbox that used to sit in this header belong to the home screen; what stays
 * here is the one number a person needs while deciding to generate a deck.
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { balance, refresh: refreshAccount } = useAccount();
  const [items, setItems] = useState<Presentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { data, error: requestError } = await supabase
        .from("presentations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      if (requestError) throw requestError;
      setItems(data);
      void supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
      if (isRefresh) void refreshAccount();
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshAccount, user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function openPresentation(item: Presentation) {
    if (item.status === "ready") router.push({ pathname: "/(app)/presentation/[id]", params: { id: item.id } });
    else router.push({ pathname: "/(app)/generation/[id]", params: { id: item.id } });
  }

  return (
    <View style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
            <Text style={styles.brand}>Loyihalar</Text>
          </View>
          <View style={styles.creditPill}>
            <Text style={styles.creditText}>{formatNumber(balance)}</Text>
            <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
          </View>
        </View>

        <CreateDeckButton onPress={() => router.push("/(app)/create")} />

        {/**
          * The other three things this account can make.
          *
          * Peers with each other and deliberately not with the button above:
          * making a deck is what most people opened the app to do, and a row of
          * four equal cards would say the opposite. Each is one tap to its own
          * workflow.
          */}
        <View style={styles.tools}>
          {[
            { key: "portrait", label: "3×4 rasm", detail: "Hujjatga", Glyph: Image_, href: "/(app)/portrait" as const },
            { key: "objective", label: "Obyektivka", detail: "DOCX / PDF", Glyph: FileText, href: "/(app)/obyektivka" as const },
            { key: "academic", label: "Ilmiy ish", detail: "Maqola, referat", Glyph: GraduationCap, href: "/(app)/ilmiy" as const },
          ].map((tool) => (
            <Pressable
              key={tool.key}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              onPress={() => router.push(tool.href)}
              style={({ pressed }) => [styles.tool, pressed && styles.toolPressed]}
            >
              <View style={styles.toolIcon}><tool.Glyph color={colors.primary} size={20} strokeWidth={2} /></View>
              <Text style={styles.toolLabel} numberOfLines={1}>{tool.label}</Text>
              <Text style={styles.toolDetail} numberOfLines={1}>{tool.detail}</Text>
            </Pressable>
          ))}
        </View>

        {/* Second on purpose: generating is the product, importing is the door
            for people who already have a deck. */}
        <View style={styles.secondaryRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/import")}
            style={({ pressed }) => [styles.secondary, pressed && styles.toolPressed]}
          >
            <FileUp color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
            <Text style={styles.secondaryText}>PowerPoint’dan yuklash</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/present/scan")}
            style={({ pressed }) => [styles.secondary, pressed && styles.toolPressed]}
          >
            <MonitorPlay color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
            <Text style={styles.secondaryText}>Taqdimot qilish</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Oxirgi prezentatsiyalar</Text>
          {items.length > 0 ? <Text style={styles.sectionCount}>{items.length}</Text> : null}
        </View>

        {loading ? <View style={styles.list}><SkeletonCard /><SkeletonCard /></View> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && items.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="Birinchi taqdimotingizni yarating"
            message="Faqat mavzu kifoya — qolganini Jaxongir AI bajaradi."
          />
        ) : null}
        <View style={styles.list}>
          {items.map((item) => <PresentationCard item={item} key={item.id} onPress={() => openPresentation(item)} />)}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.xl },
  presentButton: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  presentText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  brand: { ...typography.title, color: colors.ink, marginTop: 2 },
  creditPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.primarySoft, borderRadius: radius.pill, height: 40, paddingHorizontal: spacing.lg },
  // The coin art is square, so a square box with `contain` keeps its proportions.
  coinIcon: { width: 28, height: 28 },
  creditText: { ...typography.bodyMedium, color: colors.primaryDeep },
  tools: { flexDirection: "row", gap: spacing.sm },
  tool: {
    flex: 1,
    // Square-ish, so three sit across a phone without the labels wrapping.
    aspectRatio: 0.92,
    justifyContent: "flex-end",
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolPressed: { opacity: 0.72 },
  toolIcon: {
    width: 38, height: 38, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
    marginBottom: "auto",
  },
  toolLabel: { ...typography.caption, fontWeight: "700", color: colors.ink },
  toolDetail: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  secondaryRow: { flexDirection: "row", gap: spacing.sm },
  secondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  secondaryText: { ...typography.caption, fontSize: 12, fontWeight: "600", color: colors.inkMuted },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.lg },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  list: { gap: spacing.md },
});

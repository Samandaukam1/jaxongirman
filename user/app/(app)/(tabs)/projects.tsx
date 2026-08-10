import type { Tables } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowUpRight, FileUp, MonitorPlay, Plus, Sparkles } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { IconChip } from "@/components/IconChip";
import { PresentationCard } from "@/components/PresentationCard";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { colors, gradients, icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Taqdimot qilish"
            onPress={() => router.push("/(app)/present/scan")}
            style={styles.presentButton}
          >
            <MonitorPlay color={colors.primary} size={icon.sm} strokeWidth={2.2} />
            <Text style={styles.presentText}>Taqdimot qilish</Text>
          </Pressable>
          <View style={styles.creditPill}>
            <Text style={styles.creditText}>{formatNumber(balance)}</Text>
            <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
          </View>
        </View>

        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroOrb} />
          <View style={styles.heroOrbSmall} />
          <IconChip icon={Sparkles} variant="glass" size="sm" />
          <Text style={styles.heroTitle}>G‘oyangizni{`\n`}taqdimotga aylantiring.</Text>
          <Text style={styles.heroCopy}>Mavzuni yozing. Jaxongir AI mazmun, vizual uslub va mukammal kompozitsiyani yaratadi.</Text>
          <Pressable onPress={() => router.push("/(app)/create")} style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
            <View style={styles.ctaIcon}><Plus color={colors.primary} size={icon.md} strokeWidth={icon.strokeBold} /></View>
            <Text style={styles.ctaText}>Slayd tayyorlash</Text>
            <ArrowUpRight color={colors.onPrimary} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
          {/* Second on purpose: generating is the product, importing is the
              door for people who already have a deck. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/import")}
            style={({ pressed }) => [styles.secondaryCta, pressed && styles.ctaPressed]}
          >
            <FileUp color={colors.onPrimary} size={icon.sm} strokeWidth={icon.stroke} />
            <Text style={styles.secondaryCtaText}>PowerPoint’dan yuklash</Text>
          </Pressable>
        </LinearGradient>

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
  hero: { minHeight: 330, borderRadius: radius.xl, padding: spacing.xl, overflow: "hidden", justifyContent: "flex-end", ...shadowLifted },
  heroOrb: { position: "absolute", width: 250, height: 250, borderRadius: 125, borderWidth: 1, borderColor: "rgba(255,255,255,.16)", right: -80, top: -100 },
  heroOrbSmall: { position: "absolute", width: 130, height: 130, borderRadius: 65, backgroundColor: "rgba(255,255,255,.06)", right: -20, top: -30 },
  heroTitle: { ...typography.display, color: colors.onPrimary, marginTop: spacing.lg },
  heroCopy: { ...typography.body, color: colors.onPrimaryMuted, maxWidth: 320, marginTop: spacing.md, marginBottom: spacing.xl },
  cta: { height: 58, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,.14)", borderWidth: 1, borderColor: "rgba(255,255,255,.2)", flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.md },
  ctaPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  ctaIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  ctaText: { ...typography.bodyMedium, color: colors.onPrimary, flex: 1 },
  secondaryCta: {
    height: 44, borderRadius: radius.md, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, marginTop: spacing.sm,
  },
  secondaryCtaText: { ...typography.caption, color: colors.onPrimary, opacity: 0.92 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.lg },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  list: { gap: spacing.md },
});

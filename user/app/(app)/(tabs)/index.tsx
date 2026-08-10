import { DATA_COLLECTION_MODULE } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowRight, Bell, CirclePlus, ClipboardList, HandCoins, Plus, Store } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Avatar } from "@/components/Avatar";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { SurveyCard, type SurveySummary } from "@/components/SurveyCard";
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from "@/components/StateBlocks";
import { formatClock, formatLongDate, formatRemainingWindow } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { useModuleAccess } from "@/lib/modules";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { displayFirstName, profileInitials, useAccount } from "@/providers/AccountProvider";
import { colors, gradients, icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";

/** How many survey cards the home screen shows before deferring to the module. */
const ACTIVITY_LIMIT = 2;

/**
 * The control centre.
 *
 * Three things have to be answerable at a glance, in this order: how many tanga
 * you hold, that Ma'lumotlarni yig'ish is here, and whether anything is waiting
 * in the inbox. Everything below that is context, and every section states
 * plainly when it has nothing to show rather than filling itself with examples.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { profile, balance, unreadCount, entitlements, loading: accountLoading, error: accountError, refresh } = useAccount();
  const { state: moduleState } = useModuleAccess(DATA_COLLECTION_MODULE);

  const [now, setNow] = useState(() => new Date());
  const [activity, setActivity] = useState<SurveySummary[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The clock only ever renders to the minute, so it is only worth a re-render
  // when the minute actually turns.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow((current) => (Math.floor(Date.now() / 60_000) === Math.floor(current.getTime() / 60_000) ? current : new Date()));
    }, 1000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(new Date());
    });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    const { data, error: requestError } = await supabase.rpc("my_surveys");
    if (requestError) {
      setActivityError(asErrorMessage(requestError));
    } else {
      const payload = data as unknown as { created?: SurveySummary[]; participating?: SurveySummary[] } | null;
      const merged = [...(payload?.created ?? []), ...(payload?.participating ?? [])];
      // Live surveys first, then the most recently created — the home screen is
      // about what still needs attention, not a complete archive.
      merged.sort((left, right) => {
        const leftLive = left.status === "open" ? 0 : 1;
        const rightLive = right.status === "open" ? 0 : 1;
        if (leftLive !== rightLive) return leftLive - rightLive;
        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      });
      setActivity(merged.slice(0, ACTIVITY_LIMIT));
      setActivityError(null);
    }
    setActivityLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    void loadActivity();
  }, [loadActivity, refresh]));

  async function pullToRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), loadActivity()]);
    setRefreshing(false);
  }

  const dataCollection = entitlements.find((item) => item.module_code === DATA_COLLECTION_MODULE);
  const planLabel = dataCollection ? (moduleState?.label ?? "Ma’lumotlarni yig‘ish") : "Bepul";
  const planDetail = dataCollection
    ? formatRemainingWindow(dataCollection.expires_at)
    : "Pullik modul ulanmagan";

  return (
    <View style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={colors.primary} />}
      >
        {/* ------------------------------------------------------- header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profil"
            onPress={() => router.push("/(app)/(tabs)/profile")}
            style={styles.headerIdentity}
          >
            <Avatar uri={profile?.avatar_url} initials={profileInitials(profile)} size={52} ring />
            <View style={styles.headerCopy}>
              {accountLoading && !profile ? (
                <>
                  <Skeleton height={19} width={168} />
                  <Skeleton height={12} width={132} style={styles.headerSkeletonGap} />
                </>
              ) : (
                <>
                  <Text numberOfLines={1} style={styles.greeting}>Salom, {displayFirstName(profile)} 👋</Text>
                  <Text numberOfLines={1} style={styles.dateLine}>{formatLongDate(now)} · {formatClock(now)}</Text>
                </>
              )}
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadCount ? `Xabarnomalar, ${unreadCount} ta o‘qilmagan` : "Xabarnomalar"}
            onPress={() => router.push("/(app)/notifications")}
            style={styles.bell}
          >
            <Bell color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
            {unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {accountError ? <ErrorState message={accountError} onRetry={() => void refresh()} /> : null}

        {/* ------------------------------------------------- account card */}
        <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.account}>
          <View style={styles.accountOrb} />
          <View style={styles.accountHeader}>
            <Text style={styles.accountEyebrow}>HISOB</Text>
            <View style={styles.planChip}>
              <Text style={styles.planChipText}>{planLabel}</Text>
            </View>
          </View>

          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>Joriy balans</Text>
            {accountLoading ? (
              <Skeleton height={44} width={180} radius={14} style={styles.balanceSkeleton} />
            ) : (
              // The coin sits at the end of the figure and carries the unit, so
              // the number is read as money without a letter doing that job.
              <View style={styles.balanceRow}>
                <Text style={styles.balanceValue}>{formatNumber(balance)}</Text>
                <Image source={coinIcon} resizeMode="contain" style={styles.balanceCoin} />
              </View>
            )}
          </View>

          <Text style={styles.planDetail}>
            Tarif: {planLabel}{planDetail ? ` · ${planDetail}` : ""}
          </Text>

          {/* A matched pair: same height, same icon chip, same two-line label —
              only the fill separates the primary action from the secondary. */}
          <View style={styles.accountActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tangalarni yuborish"
              onPress={() => router.push("/(app)/coins/send")}
              style={({ pressed }) => [styles.accountAction, styles.accountActionPrimary, pressed && styles.pressedSoft]}
            >
              <View style={[styles.accountActionIcon, styles.accountActionIconPrimary]}>
                <HandCoins color={colors.onPrimary} size={18} strokeWidth={2} />
              </View>
              <Text style={styles.accountActionPrimaryText}>Tangalarni{"\n"}yuborish</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tangalarni sotib olish"
              onPress={() => router.push("/(app)/coins/buy")}
              style={({ pressed }) => [styles.accountAction, styles.accountActionGhost, pressed && styles.pressedSoft]}
            >
              <View style={[styles.accountActionIcon, styles.accountActionIconGhost]}>
                <CirclePlus color={colors.onPrimary} size={18} strokeWidth={2} />
              </View>
              <Text style={styles.accountActionGhostText}>Tangalarni{"\n"}sotib olish</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* --------------------------------------------- data collection */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/survey")}
          style={({ pressed }) => [styles.feature, pressed && styles.pressedSoft]}
        >
          <View style={styles.featureIcon}>
            <ClipboardList color={colors.onPrimary} size={26} strokeWidth={2} />
          </View>
          <View style={styles.featureCopy}>
            <Text style={styles.featureTitle}>Ma’lumotlarni yig‘ish</Text>
            <Text style={styles.featureSubtitle}>
              So‘rovnoma yarating, yuboring va natijalarni jadval ko‘rinishida oling.
            </Text>
          </View>
          <View style={styles.featureCta}>
            <Text style={styles.featureCtaText}>Ochish</Text>
            <ArrowRight color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} />
          </View>
        </Pressable>

        {/* ------------------------------------------- survey activity */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>So‘rovnoma faoliyati</Text>
          {activity.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/survey")}>
              <Text style={styles.sectionLink}>Barchasini ko‘rish</Text>
            </Pressable>
          ) : null}
        </View>

        {activityLoading ? <SkeletonCard /> : null}
        {activityError && !activityLoading ? <ErrorState message={activityError} onRetry={() => void loadActivity()} /> : null}
        {!activityLoading && !activityError && activity.length === 0 ? (
          <View style={styles.quietState}>
            <Text style={styles.quietTitle}>Hozircha so‘rovnoma yo‘q</Text>
            <Text style={styles.quietCopy}>Birinchi so‘rovnomangizni yarating yoki havola orqali qatnashing.</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/survey/create")} style={styles.quietAction}>
              <Plus color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} />
              <Text style={styles.quietActionText}>Yangi so‘rovnoma</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.list}>
          {activity.map((item) => (
            <SurveyCard
              key={item.id}
              item={item}
              onPress={() => router.push(
                item.is_owner
                  ? { pathname: "/(app)/survey/results/[id]", params: { id: item.id } }
                  : { pathname: "/(app)/survey/[id]", params: { id: item.id } },
              )}
            />
          ))}
        </View>

        {/* ------------------------------------------------ marketplace */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Do‘kon</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/(tabs)/marketplace")}>
            <Text style={styles.sectionLink}>Barchasini ko‘rish</Text>
          </Pressable>
        </View>
        {/* Marketplace has no catalogue in the database yet. An empty state is
            the honest thing to render; sample products would be indistinguishable
            from real ones the day the first seller arrives. */}
        <EmptyState
          icon={Store}
          title="Do‘kon tayyorlanmoqda"
          message="Do‘kon ochilganda tayyor shablonlar va loyihalar shu yerda ko‘rinadi."
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },

  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  headerIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  headerCopy: { flex: 1, gap: 3 },
  headerSkeletonGap: { marginTop: 4 },
  greeting: { ...typography.heading, color: colors.ink, fontSize: 19 },
  dateLine: { ...typography.caption, color: colors.inkMuted },
  bell: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute", top: -2, right: -2, minWidth: 20, height: 20, paddingHorizontal: 5,
    borderRadius: 10, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.canvas,
  },
  badgeText: { fontFamily: "Manrope_700Bold", fontSize: 10, color: colors.onPrimary },

  account: { borderRadius: radius.xl, padding: spacing.xl, overflow: "hidden", gap: spacing.lg, marginTop: spacing.sm, ...shadowLifted },
  accountOrb: { position: "absolute", width: 220, height: 220, borderRadius: 110, borderWidth: 1, borderColor: "rgba(255,255,255,.14)", right: -70, top: -90 },
  accountHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  accountEyebrow: { ...typography.caption, color: colors.onPrimaryMuted, letterSpacing: 1.8 },
  planChip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,.16)" },
  planChipText: { ...typography.caption, color: colors.onPrimary },
  balanceBlock: { gap: 2 },
  balanceRow: { flexDirection: "row", alignItems: "center" },
  // Sized and nudged against the digits themselves, not the text box: Manrope's
  // line box is taller than its cap height, so centring on it alone would leave
  // the coin sitting low.
  balanceCoin: { width: 54, height: 54, marginLeft: 8, marginTop: 3 },
  balanceLabel: { ...typography.caption, color: colors.onPrimaryMuted },
  balanceValue: { fontFamily: "Manrope_700Bold", fontSize: 46, lineHeight: 54, color: colors.onPrimary, letterSpacing: -1.4 },
  balanceSkeleton: { backgroundColor: "rgba(255,255,255,.18)" },
  planDetail: { ...typography.caption, color: colors.onPrimaryMuted },
  accountActions: { flexDirection: "row", gap: spacing.md },
  accountAction: {
    flex: 1, minHeight: 62, borderRadius: radius.lg, flexDirection: "row",
    alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md,
  },
  accountActionPrimary: {
    backgroundColor: colors.onPrimary,
    shadowColor: colors.shadow, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  accountActionPrimaryText: { fontFamily: "Manrope_700Bold", fontSize: 13, lineHeight: 17, color: colors.primaryDeep, flex: 1 },
  accountActionGhost: { backgroundColor: "rgba(255,255,255,.16)", borderWidth: 1, borderColor: "rgba(255,255,255,.3)" },
  accountActionGhostText: { fontFamily: "Manrope_700Bold", fontSize: 13, lineHeight: 17, color: colors.onPrimary, flex: 1 },
  accountActionIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountActionIconPrimary: { backgroundColor: colors.primary },
  accountActionIconGhost: { backgroundColor: "rgba(255,255,255,.22)", borderWidth: 1, borderColor: "rgba(255,255,255,.28)" },
  pressedSoft: { opacity: 0.9, transform: [{ scale: 0.99 }] },

  feature: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, ...shadow,
  },
  featureIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  featureCopy: { flex: 1, gap: 3 },
  featureTitle: { ...typography.heading, color: colors.ink },
  featureSubtitle: { ...typography.caption, color: colors.inkMuted, lineHeight: 17 },
  featureCta: { alignItems: "center", gap: 2 },
  featureCtaText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionLink: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  list: { gap: spacing.md },

  quietState: { padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, gap: spacing.sm, alignItems: "flex-start" },
  quietTitle: { ...typography.bodyMedium, color: colors.ink },
  quietCopy: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  quietAction: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  quietActionText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
});

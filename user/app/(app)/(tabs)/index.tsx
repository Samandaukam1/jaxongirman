import { DATA_COLLECTION_MODULE } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowRight, Bell, CirclePlus, ClipboardList, HandCoins, Plus, Store } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { AppState, Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Appear } from "@/components/Appear";
import { Avatar } from "@/components/Avatar";
import { BrandSurface } from "@/components/BrandSurface";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { MarathonSection } from "@/components/MarathonSection";
import { MarathonVoteButton } from "@/components/MarathonVoteButton";
import { NewDeviceCard } from "@/components/NewDeviceCard";
import { PlanUsageCard } from "@/components/PlanUsageCard";
import { SurveyCard, type SurveySummary } from "@/components/SurveyCard";
import { WelcomeHero } from "@/components/WelcomeHero";
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from "@/components/StateBlocks";
import { formatClock, formatLongDate, formatRemainingWindow } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { useModuleAccess } from "@/lib/modules";
import { formatNumber } from "@/lib/money";
import { myMembership, type Membership } from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { fetchWallet, type Wallet } from "@/lib/wallet";
import { displayFirstName, profileInitials, useAccount } from "@/providers/AccountProvider";
import { brandInk, icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

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
  const { colors } = useTheme();
  const { t } = useTranslation(["home", "common"]);
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, balance, unreadCount, entitlements, loading: accountLoading, error: accountError, refresh } = useAccount();
  const { state: moduleState } = useModuleAccess(DATA_COLLECTION_MODULE);

  const [now, setNow] = useState(() => new Date());
  const [activity, setActivity] = useState<SurveySummary[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);

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

  const loadMembership = useCallback(async () => {
    setMembership(await myMembership().catch(() => null));
  }, []);

  // Null on a server that predates page pricing: the J Tanga card stays as it was.
  const loadWallet = useCallback(async () => {
    setWallet(await fetchWallet().catch(() => null));
  }, []);

  useFocusEffect(useCallback(() => {
    void refresh();
    void loadActivity();
    void loadMembership();
    void loadWallet();
  }, [loadActivity, loadMembership, loadWallet, refresh]));

  async function pullToRefresh() {
    setRefreshing(true);
    await Promise.all([refresh(), loadActivity(), loadMembership(), loadWallet()]);
    setRefreshing(false);
  }

  const dataCollection = entitlements.find((item) => item.module_code === DATA_COLLECTION_MODULE);
  // The plan a person pays for is the plan; a module is named only without one.
  const planLabel = membership?.member
    ? membership.planName ?? t("planPremium")
    : dataCollection ? (moduleState?.label ?? t("dataCollection")) : t("planFree");
  const planDetail = membership?.member
    ? formatRemainingWindow(membership.expiresAt)
    : dataCollection ? formatRemainingWindow(dataCollection.expires_at) : null;

  return (
    <View style={[styles.safe, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={colors.primary} />}
      >
        {/* ------------------------------------------------------- header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("profile")}
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
                  <Text numberOfLines={1} style={styles.greeting}>{t("greeting", { name: displayFirstName(profile) })}</Text>
                  <Text numberOfLines={1} style={styles.dateLine}>{formatLongDate(now)} · {formatClock(now)}</Text>
                </>
              )}
            </View>
          </Pressable>

          <MarathonVoteButton />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unreadCount ? t("notificationsUnread", { count: unreadCount }) : t("notifications")}
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

        {/* A device nobody has answered for comes before everything else. */}
        <NewDeviceCard />

        {/* ------------------------------------------------- account card */}
        {/* The balance is the card. It used to share its body with a column
            kept for an animated character, which left the figure small and the
            card mostly empty; the character can come back when it is ready,
            and until then the number has the width. */}
        {/* While the welcome decks last they are the card; the J Tanga figure
            moves to its foot. Spent, the J Tanga card returns. */}
        {wallet && wallet.welcome.remaining > 0 ? (
          <Appear index={0}><WelcomeHero wallet={wallet} /></Appear>
        ) : (
        <BrandSurface radius={radius.xl} style={styles.account}>
          <View style={styles.accountHeader}>
            <Text style={styles.accountEyebrow}>{t("balance")}</Text>
            <View style={styles.planChip}>
              <Text style={styles.planChipText} numberOfLines={1}>{planLabel}</Text>
            </View>
          </View>

          <View style={styles.balanceBlock}>
            {accountLoading ? (
              <Skeleton height={52} width={210} radius={14} style={styles.balanceSkeleton} />
            ) : (
              // The coin sits at the end of the figure and carries the unit,
              // so the number is read as money without a letter doing that job.
              <View style={styles.balanceRow}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={styles.balanceValue}>{formatNumber(balance)}</Text>
                <Image source={coinIcon} resizeMode="contain" style={styles.balanceCoin} />
              </View>
            )}
            {/* The chip already names the plan; this line is only for how long it runs. */}
            {planDetail ? <Text style={styles.planDetail} numberOfLines={1}>{planLabel} · {planDetail}</Text> : null}
            {/* What the balance holds besides spendable J Tanga, never folded into it. */}
            {wallet && wallet.planCoins > 0 ? (
              <Text style={styles.planDetail} numberOfLines={1}>
                {t("planCoins", { coins: formatNumber(wallet.planCoins) })}{wallet.planCoinsExpireAt ? ` · ${formatRemainingWindow(wallet.planCoinsExpireAt)}` : ""}
              </Text>
            ) : null}
            {wallet && wallet.presentationPages.remaining > 0 ? (
              <Text style={styles.planDetail} numberOfLines={1}>
                {t("presentationPages", { count: formatNumber(wallet.presentationPages.remaining) })}
              </Text>
            ) : null}
          </View>

          {/* A matched pair: same height, same weight, one line each — only the
              fill separates the primary action from the secondary. */}
          <View style={styles.accountActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("sendLabel")}
              onPress={() => router.push("/(app)/coins/send")}
              style={({ pressed }) => [styles.accountAction, styles.accountActionPrimary, pressed && styles.pressedSoft]}
            >
              <HandCoins color={brandInk.onPlate} size={18} strokeWidth={2.2} />
              <Text style={styles.accountActionPrimaryText} numberOfLines={1}>{t("send")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("buyLabel")}
              onPress={() => router.push("/(app)/coins/buy")}
              style={({ pressed }) => [styles.accountAction, styles.accountActionGhost, pressed && styles.pressedSoft]}
            >
              <CirclePlus color={brandInk.strong} size={18} strokeWidth={2.2} />
              <Text style={styles.accountActionGhostText} numberOfLines={1}>{t("buy")}</Text>
            </Pressable>
          </View>
        </BrandSurface>
        )}

        {/* What is left of the plan, and the restart when it runs out. */}
        <PlanUsageCard variant="home" />

        {/* ----------------------------------------------- marathon */}
        {/* Directly under the account card, because the marathon is about the
            money that card shows and about a deadline — both of which lose
            their point at the bottom of a scroll. It draws nothing at all
            unless a campaign is running. */}
        <MarathonSection />

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
            <Text style={styles.featureTitle}>{t("dataCollection")}</Text>
            <Text style={styles.featureSubtitle}>
              {t("featureBody")}
            </Text>
          </View>
          <View style={styles.featureCta}>
            <Text style={styles.featureCtaText}>{t("open")}</Text>
            <ArrowRight color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} />
          </View>
        </Pressable>

        {/* ------------------------------------------- survey activity */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("surveyActivity")}</Text>
          {activity.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/survey")}>
              <Text style={styles.sectionLink}>{t("common:seeAll")}</Text>
            </Pressable>
          ) : null}
        </View>

        {activityLoading ? <SkeletonCard /> : null}
        {activityError && !activityLoading ? <ErrorState message={activityError} onRetry={() => void loadActivity()} /> : null}
        {!activityLoading && !activityError && activity.length === 0 ? (
          <View style={styles.quietState}>
            <Text style={styles.quietTitle}>{t("noSurveys")}</Text>
            <Text style={styles.quietCopy}>{t("noSurveysBody")}</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/survey/create")} style={styles.quietAction}>
              <Plus color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} />
              <Text style={styles.quietActionText}>{t("newSurvey")}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.list}>
          {activity.map((item, index) => (
            <Appear key={item.id} index={index}>
              <SurveyCard
                item={item}
                onPress={() => router.push(
                  item.is_owner
                    ? { pathname: "/(app)/survey/results/[id]", params: { id: item.id } }
                    : { pathname: "/(app)/survey/[id]", params: { id: item.id } },
                )}
              />
            </Appear>
          ))}
        </View>

        {/* ------------------------------------------------ marketplace */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("store")}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/(tabs)/marketplace")}>
            <Text style={styles.sectionLink}>{t("common:seeAll")}</Text>
          </Pressable>
        </View>
        {/* Marketplace has no catalogue in the database yet. An empty state is
            the honest thing to render; sample products would be indistinguishable
            from real ones the day the first seller arrives. */}
        <EmptyState
          icon={Store}
          title={t("storeSoon")}
          message={t("storeSoonBody")}
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
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

  account: { padding: spacing.xl, paddingBottom: spacing.lg + 4, marginTop: spacing.sm },
  accountHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  accountEyebrow: { ...typography.caption, fontFamily: "Manrope_600SemiBold", fontSize: 11, color: brandInk.muted, letterSpacing: 1.6 },
  // Darker than the card rather than lighter: the chip sits in the lit corner,
  // and a pale plate there would take the white label's contrast with it.
  planChip: {
    paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill, maxWidth: "50%",
    backgroundColor: "rgba(16,6,48,0.24)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  planChipText: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: brandInk.strong },
  balanceBlock: { marginTop: spacing.xl, minHeight: 58, justifyContent: "center", gap: 4 },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // Sized against the digits rather than the line box: Manrope's line is taller
  // than its figures, so the coin is nudged to their optical centre.
  balanceCoin: { width: 44, height: 44, marginTop: 2 },
  balanceValue: { fontFamily: "Manrope_800ExtraBold", fontSize: 50, lineHeight: 58, flexShrink: 1, color: brandInk.strong, letterSpacing: -2 },
  balanceSkeleton: { backgroundColor: "rgba(255,255,255,.18)" },
  planDetail: { ...typography.caption, fontSize: 12.5, color: brandInk.muted },
  accountActions: { flexDirection: "row", gap: spacing.md - 2, marginTop: spacing.xl },
  accountAction: {
    flex: 1, height: 50, borderRadius: radius.md, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md,
  },
  accountActionPrimary: {
    backgroundColor: brandInk.plate,
    shadowColor: "#14063C", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  accountActionPrimaryText: { fontFamily: "Manrope_700Bold", fontSize: 14, color: brandInk.onPlate, flexShrink: 1 },
  accountActionGhost: { backgroundColor: "rgba(255,255,255,.12)", borderWidth: 1, borderColor: "rgba(255,255,255,.24)" },
  accountActionGhostText: { fontFamily: "Manrope_700Bold", fontSize: 14, color: brandInk.strong, flexShrink: 1 },
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
}));

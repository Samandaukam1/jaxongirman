import {
  cardLines, coinRate, detailSections, planWorth, priceLine, resetLabel, usageLines,
  type QuotaStatus,
} from "@jaxongirman/tariff-card";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import type { TFunction } from "i18next";
import { Crown, Info, RotateCcw, Sparkles, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { TariffRail, TariffTag } from "@/components/TariffTag";
import { formatDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { createSubscriptionOrder } from "@/lib/orders";
import {
  myMembership, myUsage, restartPreview, subscriptionPlans, type RestartPreview,
  type Membership, type TariffPlan,
} from "@/lib/subscription";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useLanguage } from "@/providers/LanguageProvider";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { metalsOf } from "@/theme/metals";
import { brandInk, gradients, icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The tariff screen.
 *
 * Three questions, in the order somebody asks them: am I a member, what have I
 * got left, and what would I get if I paid. A member arriving to check their
 * remaining presentations should not have to scroll past a sales pitch to find
 * the number, so usage comes first for them and the plan first for everybody
 * else.
 *
 * Every line on the card is drawn by `@jaxongirman/tariff-card`, the same
 * functions the admin console previews with — a plan an admin approved on one
 * screen cannot read differently on the other.
 */
export default function TariffScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const policy = usePaymentPolicy();
  const { t } = useTranslation(["wallet", "common"]);
  const { language } = useLanguage();

  const [plans, setPlans] = useState<TariffPlan[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [usage, setUsage] = useState<QuotaStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<TariffPlan | null>(null);
  const [restart, setRestart] = useState<RestartPreview | null>(null);
  /** So'm per J Tanga at the cheapest package on sale: what a plan is compared with. */
  const [rate, setRate] = useState<number | null>(null);
  const [room, setRoom] = useState(0);
  const { refreshWallet } = useAccount();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [planRows, member, usageRows, preview, packages] = await Promise.all([
        subscriptionPlans(), myMembership(), myUsage(),
        restartPreview().catch(() => null),
        supabase.from("coin_packages").select("coins,bonus_coins,price_amount,currency").eq("is_active", true),
      ]);
      setRate(coinRate((packages.data ?? []).map((row) => ({
        coins: row.coins, bonusCoins: row.bonus_coins ?? 0, priceAmount: Number(row.price_amount), currency: row.currency,
      }))));
      setPlans(planRows);
      setMembership(member);
      setUsage(usageRows);
      setRestart(preview);
      setError(null);
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /**
   * Opens an order and hands off to the checkout every other purchase uses.
   *
   * Only the plan's code is sent. The price on the next screen is the one the
   * server read from the plan — there is no parameter here that could carry a
   * different figure.
   */
  async function buy(planCode: string, restart = false) {
    // In a browser the site's own checkout takes the payment (same session).
    if (Platform.OS === "web") { window.location.assign("/tarif"); return; }
    setOpening(planCode);
    setError(null);
    try {
      const order = await createSubscriptionOrder(planCode, restart);
      refreshWallet(true);
      router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } });
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  }

  /**
   * Restarting is offered only to somebody who has something to give up.
   *
   * Shown to a person with no membership it is a second, more confusing way to
   * buy one; shown on the first day of a cycle it is an invitation to throw
   * away twenty-nine days. It appears when there is a live plan, and it says
   * exactly what is being given up.
   */
  function confirmRestart() {
    if (!restart?.member || !restart.planCode) return;
    const spent = restart.used.reduce((sum, entry) => sum + entry.used, 0);
    Alert.alert(
      t("tariff.restart"),
      t("wallet:tariff.restartBody", { plan: restart.planName ?? t("wallet:tariff.restartPlan"), days: restart.remainingDays })
      + (spent > 0 ? t("wallet:tariff.restartSpent", { count: spent }) : ""),
      [
        { text: t("common:cancel"), style: "cancel" },
        { text: t("tariff.restartConfirm"), style: "destructive", onPress: () => void buy(restart.planCode!, true) },
      ],
    );
  }

  const lines = usageLines(usage, language);
  const metalOf = metalsOf(plans);
  // Side by side on a desktop, one under another on a phone.
  const wide = room >= 900 && plans.length > 1;
  const best = plans.reduce((top, plan) => Math.max(top, planWorth(plan, rate)?.percent ?? 0), 0);
  const nextReset = resetLabel(usage.find((row) => row.resets_at)?.resets_at, language);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t("tariff.title")}
        subtitle={membership?.member ? membership.planName ?? t("tariff.active") : t("tariff.extend")}
      />

      <ScrollView
        onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />
        }
      >
        {loading ? <SkeletonCard lines={4} /> : null}
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {/* A member's own state, first: the badge says they paid, the bars say
            what they came here to find out. */}
        {!loading && membership?.member ? (
          <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statusCard}>
            <View style={styles.statusTop}>
              <View style={styles.statusBadge}>
                <Crown color={brandInk.strong} size={icon.sm} strokeWidth={icon.strokeBold} />
                <Text style={styles.statusBadgeText}>{membership.planName ?? "Premium"}</Text>
              </View>
              {membership.expiresAt ? (
                <Text style={styles.statusExpiry}>
                  {t("tariff.until", { date: formatDate(membership.expiresAt) })}
                </Text>
              ) : null}
            </View>

            {lines.length > 0 ? (
              <View style={styles.usage}>
                {lines.map((line) => {
                  const filled = line.unlimited || !line.limit
                    ? 0
                    : Math.min(line.used / line.limit, 1);
                  return (
                    <View key={line.key} style={styles.usageRow}>
                      <View style={styles.usageHead}>
                        <Text style={styles.usageLabel}>{line.label}</Text>
                        <Text style={styles.usageDetail}>{line.detail}</Text>
                      </View>
                      <View style={styles.track}>
                        {/* An unlimited allowance draws a full, quiet bar rather
                            than an empty one: there is nothing to run out of. */}
                        <View style={[styles.fill, { width: `${line.unlimited ? 100 : filled * 100}%` }]} />
                      </View>
                    </View>
                  );
                })}
                {nextReset ? <Text style={styles.reset}>{nextReset}</Text> : null}
              </View>
            ) : null}

            {/* Offered only to somebody who has something to give up: shown
                without a membership it is a second, more confusing way to buy
                one. */}
            {restart?.member && policy.paymentsEnabled ? (
              <Pressable
                accessibilityRole="button"
                disabled={opening !== null}
                onPress={confirmRestart}
                style={[styles.restart, opening !== null && styles.restartBusy]}
              >
                <RotateCcw color={brandInk.strong} size={icon.sm} strokeWidth={2.1} />
                <Text style={styles.restartText}>{t("tariff.restart")}</Text>
              </Pressable>
            ) : null}
          </LinearGradient>
        ) : null}

        {/* Somebody without a membership is told what the free tier gives them
            before being sold anything — a limit that arrives as a surprise
            halfway through making something is the worse way to learn it. */}
        {!loading && membership && !membership.member && lines.length > 0 ? (
          <View style={styles.freeCard}>
            <Text style={styles.freeTitle}>{t("tariff.freeLimit")}</Text>
            {lines.map((line) => (
              <View key={line.key} style={styles.freeRow}>
                <Text style={styles.freeLabel}>{line.label}</Text>
                <Text style={styles.freeValue}>{line.detail}</Text>
              </View>
            ))}
            {nextReset ? <Text style={styles.freeReset}>{nextReset}</Text> : null}
          </View>
        ) : null}

        {!loading && !policy.paymentsEnabled ? (
          <View style={styles.notice}>
            <Info color={colors.warning} size={icon.sm} strokeWidth={2} />
            <Text style={styles.noticeText}>{policy.unavailableMessage("subscription")}</Text>
          </View>
        ) : null}

        {/* The case for a plan, in one line and one number — the largest saving
            any plan makes on its own J Tanga, so it is true of at least one. */}
        {!loading && !membership?.member && best > 0 ? (
          <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.pitch}>
            <View style={styles.pitchIcon}><Sparkles color={brandInk.strong} size={18} strokeWidth={2.2} /></View>
            <View style={styles.pitchCopy}>
              <Text style={styles.pitchTitle}>{t("tariff.pitchTitle")}</Text>
              <Text style={styles.pitchBody}>{t("tariff.pitchBody", { percent: best })}</Text>
            </View>
          </LinearGradient>
        ) : null}

        {plans.length > 0 ? (
          <View>
            <TariffRail />
            <View style={wide ? styles.row : styles.column}>
              {plans.map((plan, index) => {
                const price = priceLine(plan, language);
                const owned = membership?.planCode === plan.code;
                return (
                  <TariffTag
                    key={plan.code}
                    index={index}
                    style={wide ? styles.rowItem : null}
                    metal={metalOf.get(plan.code)!}
                    name={plan.name}
                    subtitle={plan.subtitle}
                    badge={plan.badge}
                    priceAmount={plan.priceAmount}
                    amount={price.amount}
                    unit={price.unit}
                    worth={planWorth(plan, rate)}
                    usual={plan.compareAtAmount > plan.priceAmount ? plan.compareAtAmount : null}
                    lines={[...coinLines(plan, t), ...cardLines(plan, language)]}
                    owned={owned}
                    // Payment surfaces are drawn only where a payment can actually
                    // be made: a price with no way to pay it advertises a purchase
                    // this build cannot complete.
                    cta={policy.paymentsEnabled ? (owned ? t("tariff.renew") : t("tariff.take", { plan: plan.name })) : null}
                    busy={opening === plan.code}
                    disabled={opening !== null}
                    onBuy={() => void buy(plan.code)}
                    onDetails={() => setDetailFor(plan)}
                    detailsLabel={t("tariff.allFeatures")}
                  />
                );
              })}
            </View>
            {best > 0 ? <Text style={styles.worthNote}>{t("tariff.worthNote")}</Text> : null}
          </View>
        ) : null}

        {!loading && plans.length === 0 && !error ? (
          <Text style={styles.emptyNote}>{t("tariff.none")}</Text>
        ) : null}
      </ScrollView>

      {/* The full picture, where a capability that is switched off is shown as
          switched off — here the reader is comparing rather than being sold to. */}
      <Modal visible={detailFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailFor(null)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.sheetName}>
              {detailFor && metalOf.get(detailFor.code) ? (
                <LinearGradient colors={metalOf.get(detailFor.code)!.face} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={styles.sheetMedal} />
              ) : null}
              <Text style={styles.sheetTitle}>{detailFor?.name ?? ""}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("common:close")} onPress={() => setDetailFor(null)} style={styles.sheetClose}>
              <X color={colors.ink} size={icon.md} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            {detailFor ? detailSections(detailFor, language).map((section) => (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.rows.map((row) => (
                  <View key={row.label} style={styles.sectionRow}>
                    <Text style={styles.sectionLabel}>{row.label}</Text>
                    <Text style={[styles.sectionValue, !row.included && styles.sectionValueOff]}>{row.value}</Text>
                  </View>
                ))}
              </View>
            )) : null}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },

  statusCard: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.lg, ...shadowLifted },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,255,255,0.18)", paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  statusBadgeText: { ...typography.caption, color: brandInk.strong, textTransform: "uppercase", letterSpacing: 0.6 },
  statusExpiry: { ...typography.caption, color: brandInk.muted },

  usage: { gap: spacing.md },
  usageRow: { gap: spacing.xs },
  usageHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  usageLabel: { ...typography.bodyMedium, color: brandInk.strong },
  usageDetail: { ...typography.caption, color: brandInk.muted },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: brandInk.strong },
  restart: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginTop: spacing.md, minHeight: 46, borderRadius: radius.pill,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.4)",
  },
  restartBusy: { opacity: 0.5 },
  restartText: { ...typography.caption, fontWeight: "700", color: brandInk.strong },
  reset: { ...typography.caption, color: brandInk.muted },

  freeCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  freeTitle: { ...typography.heading, color: colors.ink },
  freeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  freeLabel: { ...typography.body, color: colors.inkMuted },
  freeValue: { ...typography.bodyMedium, color: colors.ink },
  freeReset: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.xs },

  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  noticeText: { ...typography.caption, color: colors.ink, flex: 1 },

  pitch: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, ...shadowLifted },
  pitchIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  pitchCopy: { flex: 1, gap: 2 },
  pitchTitle: { ...typography.heading, color: brandInk.strong },
  pitchBody: { ...typography.body, fontSize: 14, color: brandInk.muted },

  column: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  rowItem: { flex: 1, minWidth: 0 },
  worthNote: { ...typography.caption, color: colors.inkSoft, textAlign: "center", marginTop: spacing.lg },

  emptyNote: { ...typography.body, color: colors.inkSoft, textAlign: "center", paddingVertical: spacing.xl },

  sheet: { flex: 1, backgroundColor: colors.canvas },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetName: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sheetMedal: { width: 26, height: 26, borderRadius: 13 },
  sheetTitle: { ...typography.heading, color: colors.ink, letterSpacing: 1 },
  sheetClose: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  sheetBody: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md },
  sectionLabel: { ...typography.body, color: colors.inkMuted, flex: 1 },
  sectionValue: { ...typography.bodyMedium, color: colors.ink },
  sectionValueOff: { color: colors.inkSoft },
}));

/**
 * What a coin tariff gives, before its other perks: the month's J Tanga, the
 * decks they make at the tariff's own rate, and what happens at the month's end.
 */
function coinLines(plan: TariffPlan, t: TFunction<"wallet">): { key: string; label: string }[] {
  if (plan.billingModel !== "coins" || plan.includedCoins <= 0) return [];
  const lines = [{ key: "coins", label: t("tariff.monthlyCoins", { coins: formatNumber(plan.includedCoins) }) }];
  if (plan.presentationUnits > 0) {
    lines.push({
      key: "decks",
      label: t("tariff.decks", { units: plan.presentationUnits, pages: plan.pagesPerUnit, total: plan.presentationUnits * plan.pagesPerUnit }),
    });
  }
  lines.push({ key: "rollover", label: t("tariff.rollover") });
  return lines;
}

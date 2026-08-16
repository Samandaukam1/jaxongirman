import {
  cardLines, detailSections, priceLine, resetLabel, usageLines,
  type QuotaStatus,
} from "@jaxongirman/tariff-card";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Check, Crown, Info, Sparkles, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { createSubscriptionOrder } from "@/lib/orders";
import {
  myMembership, myUsage, subscriptionPlans,
  type Membership, type TariffPlan,
} from "@/lib/subscription";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { colors, gradients, icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";

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
  const router = useRouter();
  const policy = usePaymentPolicy();

  const [plans, setPlans] = useState<TariffPlan[]>([]);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [usage, setUsage] = useState<QuotaStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<TariffPlan | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [planRows, member, usageRows] = await Promise.all([
        subscriptionPlans(), myMembership(), myUsage(),
      ]);
      setPlans(planRows);
      setMembership(member);
      setUsage(usageRows);
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
  async function buy(planCode: string) {
    setOpening(planCode);
    setError(null);
    try {
      const order = await createSubscriptionOrder(planCode);
      router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } });
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  }

  const lines = usageLines(usage);
  const nextReset = resetLabel(usage.find((row) => row.resets_at)?.resets_at);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Tarif"
        subtitle={membership?.member ? membership.planName ?? "Faol obuna" : "Imkoniyatlarni kengaytiring"}
      />

      <ScrollView
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
                <Crown color={colors.onPrimary} size={icon.sm} strokeWidth={icon.strokeBold} />
                <Text style={styles.statusBadgeText}>{membership.planName ?? "Premium"}</Text>
              </View>
              {membership.expiresAt ? (
                <Text style={styles.statusExpiry}>
                  {new Date(membership.expiresAt).toLocaleDateString("uz-UZ", { day: "numeric", month: "long" })}gacha
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
          </LinearGradient>
        ) : null}

        {/* Somebody without a membership is told what the free tier gives them
            before being sold anything — a limit that arrives as a surprise
            halfway through making something is the worse way to learn it. */}
        {!loading && membership && !membership.member && lines.length > 0 ? (
          <View style={styles.freeCard}>
            <Text style={styles.freeTitle}>Hozirgi bepul limitingiz</Text>
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

        {plans.map((plan) => {
          const price = priceLine(plan);
          const owned = membership?.planCode === plan.code;
          return (
            <View key={plan.code} style={[styles.card, plan.isFeatured && styles.cardFeatured]}>
              {plan.badge ? (
                <View style={styles.cardBadge}>
                  <Sparkles color={colors.primary} size={icon.xs} strokeWidth={icon.strokeBold} />
                  <Text style={styles.cardBadgeText}>{plan.badge}</Text>
                </View>
              ) : null}

              <Text style={styles.cardName}>{plan.name}</Text>
              {plan.subtitle ? <Text style={styles.cardSubtitle}>{plan.subtitle}</Text> : null}

              <View style={styles.priceRow}>
                <Text style={styles.price}>{price.amount}</Text>
                <Text style={styles.priceUnit}>{price.unit}</Text>
              </View>
              {plan.compareAtAmount > plan.priceAmount ? (
                <Text style={styles.compareAt}>{plan.compareAtAmount.toLocaleString("uz-UZ")} so‘m</Text>
              ) : null}

              <View style={styles.features}>
                {cardLines(plan).map((line) => (
                  <View key={line.key} style={styles.featureRow}>
                    <View style={styles.tick}>
                      <Check color={colors.primary} size={12} strokeWidth={3} />
                    </View>
                    <Text style={styles.featureText}>{line.label}</Text>
                  </View>
                ))}
              </View>

              {/* Payment surfaces are drawn only where a payment can actually be
                  made: a price with no way to pay it advertises a purchase this
                  build cannot complete. */}
              {policy.paymentsEnabled ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={opening !== null}
                  onPress={() => void buy(plan.code)}
                  style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, opening !== null && styles.ctaDisabled]}
                >
                  {opening === plan.code ? (
                    <ActivityIndicator color={colors.onPrimary} size="small" />
                  ) : (
                    <Text style={styles.ctaText}>
                      {owned ? "Muddatni uzaytirish" : plan.ctaLabel || "Tarifni tanlash"}
                    </Text>
                  )}
                </Pressable>
              ) : null}

              <Pressable accessibilityRole="button" onPress={() => setDetailFor(plan)} style={styles.detailLink}>
                <Text style={styles.detailLinkText}>Barcha imkoniyatlar</Text>
              </Pressable>
            </View>
          );
        })}

        {!loading && plans.length === 0 && !error ? (
          <Text style={styles.emptyNote}>Hozircha sotuvda tarif yo‘q.</Text>
        ) : null}
      </ScrollView>

      {/* The full picture, where a capability that is switched off is shown as
          switched off — here the reader is comparing rather than being sold to. */}
      <Modal visible={detailFor !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailFor(null)}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{detailFor?.name ?? ""}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Yopish" onPress={() => setDetailFor(null)} style={styles.sheetClose}>
              <X color={colors.ink} size={icon.md} strokeWidth={2} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            {detailFor ? detailSections(detailFor).map((section) => (
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },

  statusCard: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.lg, ...shadowLifted },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: "rgba(255,255,255,0.18)", paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  statusBadgeText: { ...typography.caption, color: colors.onPrimary, textTransform: "uppercase", letterSpacing: 0.6 },
  statusExpiry: { ...typography.caption, color: colors.onPrimaryMuted },

  usage: { gap: spacing.md },
  usageRow: { gap: spacing.xs },
  usageHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  usageLabel: { ...typography.bodyMedium, color: colors.onPrimary },
  usageDetail: { ...typography.caption, color: colors.onPrimaryMuted },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.22)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.onPrimary },
  reset: { ...typography.caption, color: colors.onPrimaryMuted },

  freeCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  freeTitle: { ...typography.heading, color: colors.ink },
  freeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  freeLabel: { ...typography.body, color: colors.inkMuted },
  freeValue: { ...typography.bodyMedium, color: colors.ink },
  freeReset: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.xs },

  notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: "#FDF6E9" },
  noticeText: { ...typography.caption, color: colors.ink, flex: 1 },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm, ...shadow },
  cardFeatured: { borderColor: colors.primary, borderWidth: 1.5 },
  cardBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.primarySoft, paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  cardBadgeText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_700Bold" },
  cardName: { ...typography.title, color: colors.ink },
  cardSubtitle: { ...typography.body, color: colors.inkMuted },

  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, marginTop: spacing.xs },
  price: { ...typography.display, color: colors.ink },
  priceUnit: { ...typography.bodyMedium, color: colors.inkMuted },
  compareAt: { ...typography.caption, color: colors.inkSoft, textDecorationLine: "line-through" },

  features: { gap: spacing.sm, marginTop: spacing.sm },
  featureRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tick: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  featureText: { ...typography.body, color: colors.ink, flex: 1 },

  cta: { marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center", ...shadowLifted },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { ...typography.bodyMedium, color: colors.onPrimary },
  detailLink: { alignSelf: "center", paddingVertical: spacing.sm },
  detailLinkText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },

  emptyNote: { ...typography.body, color: colors.inkSoft, textAlign: "center", paddingVertical: spacing.xl },

  sheet: { flex: 1, backgroundColor: colors.canvas },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetTitle: { ...typography.heading, color: colors.ink },
  sheetClose: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  sheetBody: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxxl },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md },
  sectionLabel: { ...typography.body, color: colors.inkMuted, flex: 1 },
  sectionValue: { ...typography.bodyMedium, color: colors.ink },
  sectionValueOff: { color: colors.inkSoft },
});

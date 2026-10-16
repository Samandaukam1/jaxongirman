import type { Tables } from "@jaxongirman/types";
import { useRouter } from "expo-router";
import { ChevronRight, CreditCard, Crown, Info, PackageOpen, Presentation } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Appear } from "@/components/Appear";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { localized } from "@/lib/content";
import { asErrorMessage } from "@/lib/format";
import { formatCoins, formatNumber, formatPrice } from "@/lib/money";
import { createJcoinOrder } from "@/lib/orders";
import { supabase } from "@/lib/supabase";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { useAccount } from "@/providers/AccountProvider";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Package = Tables<"coin_packages">;
type PaymentConfig = { provider: string | null; configured: boolean };

/**
 * J Tanga do‘koni.
 *
 * Two things are sold here and they are kept apart on purpose: J Tanga, spent
 * on any service at the buyer's rate, and presentation pages, spent on decks
 * only and never turned into J Tanga. The tariffs are one tap away.
 *
 * The catalogue is whatever the admin console has published — no package is
 * hard-coded here. When no payment provider is wired up, the screen says so and
 * offers no button that could look like a purchase: a simulated success would
 * be a lie about money, and the balance it implied would never arrive.
 */
export default function BuyCoinsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation("wallet", { keyPrefix: "shop" });
  const { balance } = useAccount();
  const [packages, setPackages] = useState<Package[]>([]);
  const [payments, setPayments] = useState<PaymentConfig>({ provider: null, configured: false });
  const policy = usePaymentPolicy();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  /** When the catalogue was read: sale windows are judged against it. */
  const [readAt, setReadAt] = useState(() => Date.now());

  /**
   * Opens an order and hands off to checkout. The package id is all that is
   * sent: the price on the next screen is the one the server wrote.
   */
  async function buy(packageId: string) {
    setOpening(packageId);
    setError(null);
    try {
      const order = await createJcoinOrder(packageId);
      router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } });
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  }

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [packagesResult, settingsResult] = await Promise.all([
        supabase.from("coin_packages").select("*").eq("is_active", true).order("sort_order").order("coins"),
        supabase.from("app_settings").select("value").eq("key", "payments.config").maybeSingle(),
      ]);
      if (packagesResult.error) throw packagesResult.error;
      setPackages(packagesResult.data ?? []);
      setReadAt(Date.now());

      const value = settingsResult.data?.value as PaymentConfig | null;
      setPayments({ provider: value?.provider ?? null, configured: Boolean(value?.configured) });
      setError(null);
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A pack outside its sale window is not offered; the server refuses it anyway.
  const onSale = packages.filter((item) =>
    (!item.starts_at || Date.parse(item.starts_at) <= readAt) && (!item.ends_at || Date.parse(item.ends_at) > readAt));
  const pagePackages = onSale.filter((item) => item.presentation_pages > 0);
  const coinPackages = onSale.filter((item) => item.presentation_pages === 0);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("title")} subtitle={t("balance", { balance: formatCoins(balance) })} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {/* Nothing about buying is drawn on a platform that may not buy — not
            the packages, not the prices. A price with no way to pay it is an
            advertisement for a purchase this build cannot make. */}
        {!loading && !policy.paymentsEnabled ? (
          <View style={[styles.notice, styles.noticePending]}>
            <Info color={colors.warning} size={18} strokeWidth={2} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>{policy.unavailableMessage("jcoin")}</Text>
              <Text style={styles.noticeBody}>{t("iosBalance")}</Text>
            </View>
          </View>
        ) : null}

        {/* The provider state is stated once, at the top, so it frames every
            price below it rather than surprising someone at the last tap. */}
        {!loading && policy.paymentsEnabled ? (
          <View style={[styles.notice, payments.configured ? styles.noticeReady : styles.noticePending]}>
            <Info color={payments.configured ? colors.success : colors.warning} size={18} strokeWidth={2} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>
                {payments.configured ? t("provider", { provider: payments.provider ?? t("providerConnected") }) : t("providerMissing")}
              </Text>
              <Text style={styles.noticeBody}>
                {payments.configured ? t("providerReadyBody") : t("providerMissingBody")}
              </Text>
            </View>
          </View>
        ) : null}

        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && policy.paymentsEnabled && !error && packages.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title={t("noPackages")}
            message={t("noPackagesBody")}
          />
        ) : null}

        {/* Tariffs: a month of J Tanga at a lower page rate. */}
        {!loading ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/tarif")}
            style={({ pressed }) => [styles.tariffLink, pressed && styles.packagePressed]}
          >
            <View style={styles.tariffIcon}><Crown color={colors.primary} size={20} strokeWidth={2.1} /></View>
            <View style={styles.packageCopy}>
              <Text style={styles.tariffTitle}>{t("tariffs")}</Text>
              <Text style={styles.packageDescription}>{t("tariffsBody")}</Text>
            </View>
            <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2} />
          </Pressable>
        ) : null}

        {(policy.paymentsEnabled ? pagePackages : []).length > 0 ? (
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t("forDecks")}</Text>
            <Text style={styles.sectionNote}>{t("forDecksBody")}</Text>
          </View>
        ) : null}
        <View style={styles.list}>
          {(policy.paymentsEnabled ? pagePackages : []).map((item, index) => (
            <Appear key={item.id} index={index}>
              <Pressable
                disabled={!payments.configured || opening !== null}
                onPress={() => void buy(item.id)}
                style={({ pressed }) => [styles.package, styles.pagesPackage, pressed && payments.configured && styles.packagePressed]}
                accessibilityRole={payments.configured ? "button" : undefined}
              >
                <View style={styles.pagesIcon}><Presentation color={colors.primary} size={22} strokeWidth={2} /></View>
                <View style={styles.packageCopy}>
                  <Text style={styles.packageLabel}>{t("decksOnly")}</Text>
                  <Text style={styles.packageCoins}>{t("pages", { count: formatNumber(item.presentation_pages) })}</Text>
                  <Text style={styles.packageDescription}>{localized(item.label, item.label_i18n)}</Text>
                </View>
                <View style={styles.packagePrice}>
                  <Text style={styles.priceValue}>{formatPrice(Number(item.price_amount), item.currency)}</Text>
                  <View style={[styles.priceState, payments.configured ? styles.priceStateReady : styles.priceStateLocked]}>
                    {opening === item.id ? <ActivityIndicator color={colors.success} size="small" /> : (
                      <CreditCard color={payments.configured ? colors.success : colors.inkSoft} size={13} strokeWidth={2} />
                    )}
                    <Text style={[styles.priceStateText, payments.configured ? styles.priceStateTextReady : null]}>
                      {opening === item.id ? t("opening") : payments.configured ? t("buy") : t("waiting")}
                    </Text>
                  </View>
                </View>
              </Pressable>
            </Appear>
          ))}
        </View>

        {(policy.paymentsEnabled ? coinPackages : []).length > 0 ? (
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t("coins")}</Text>
            <Text style={styles.sectionNote}>{t("coinsBody")}</Text>
          </View>
        ) : null}
        <View style={styles.list}>
          {(policy.paymentsEnabled ? coinPackages : []).map((item, index) => (
            <Appear key={item.id} index={index}>
              <Pressable
                key={item.id}
                // Pressable only where a purchase is actually possible: an inert
                // row that highlights on touch promises something it cannot do.
                disabled={!payments.configured || opening !== null}
                onPress={() => void buy(item.id)}
                style={({ pressed }) => [styles.package, pressed && payments.configured && styles.packagePressed]}
                accessibilityRole={payments.configured ? "button" : undefined}
              >
                <Image source={coinIcon} resizeMode="contain" style={styles.packageCoin} />
                <View style={styles.packageCopy}>
                  <Text style={styles.packageLabel}>{localized(item.label, item.label_i18n)}</Text>
                  <Text style={styles.packageCoins}>
                    {formatCoins(item.coins)}
                    {item.bonus_coins > 0 ? <Text style={styles.packageBonus}>  {t("bonus", { count: formatNumber(item.bonus_coins) })}</Text> : null}
                  </Text>
                  {item.description ? <Text style={styles.packageDescription}>{localized(item.description, item.description_i18n)}</Text> : null}
                </View>
                <View style={styles.packagePrice}>
                  <Text style={styles.priceValue}>{formatPrice(Number(item.price_amount), item.currency)}</Text>
                  <View style={[styles.priceState, payments.configured ? styles.priceStateReady : styles.priceStateLocked]}>
                    {opening === item.id ? (
                      <ActivityIndicator color={colors.success} size="small" />
                    ) : (
                      <CreditCard color={payments.configured ? colors.success : colors.inkSoft} size={13} strokeWidth={2} />
                    )}
                    <Text style={[styles.priceStateText, payments.configured ? styles.priceStateTextReady : null]}>
                      {opening === item.id ? t("opening") : payments.configured ? t("buy") : t("waiting")}
                    </Text>
                  </View>
                </View>
              </Pressable>

            </Appear>          ))}
        </View>

        {!loading && packages.length > 0 && !payments.configured ? (
          <Text style={styles.footnote}>
            {t("footnote")}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  notice: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  noticeReady: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  noticePending: { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  noticeBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },

  list: { gap: spacing.md },
  sectionHead: { gap: 2, marginTop: spacing.xs },
  sectionTitle: { ...typography.heading, fontSize: 17, color: colors.ink },
  sectionNote: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  tariffLink: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.border,
  },
  tariffIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  tariffTitle: { ...typography.bodyMedium, color: colors.ink },
  pagesPackage: { borderColor: colors.primary },
  pagesIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  packagePressed: { transform: [{ scale: 0.985 }], opacity: 0.94 },
  package: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  packageCoin: { width: 44, height: 44 },
  packageCopy: { flex: 1, gap: 2 },
  packageLabel: { ...typography.caption, color: colors.inkSoft, letterSpacing: 0.6, textTransform: "uppercase" },
  packageCoins: { ...typography.heading, color: colors.ink },
  packageBonus: { ...typography.caption, color: colors.success },
  packageDescription: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  packagePrice: { alignItems: "flex-end", gap: 6 },
  priceValue: { ...typography.bodyMedium, color: colors.primaryDeep },
  priceState: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  priceStateReady: { backgroundColor: colors.successSoft },
  priceStateLocked: { backgroundColor: colors.surfaceMuted },
  priceStateText: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  priceStateTextReady: { color: colors.success },

  footnote: { ...typography.caption, color: colors.inkSoft, textAlign: "center", lineHeight: 18 },
}));

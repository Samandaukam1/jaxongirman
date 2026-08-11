import type { Tables } from "@jaxongirman/types";
import { CreditCard, Info, PackageOpen } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatCoins, formatNumber, formatPrice } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { useAccount } from "@/providers/AccountProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

type Package = Tables<"coin_packages">;
type PaymentConfig = { provider: string | null; configured: boolean };

/**
 * Buying tanga.
 *
 * The catalogue is whatever the admin console has published — no package is
 * hard-coded here. When no payment provider is wired up, the screen says so and
 * offers no button that could look like a purchase: a simulated success would
 * be a lie about money, and the balance it implied would never arrive.
 */
export default function BuyCoinsScreen() {
  const { balance } = useAccount();
  const [packages, setPackages] = useState<Package[]>([]);
  const [payments, setPayments] = useState<PaymentConfig>({ provider: null, configured: false });
  const policy = usePaymentPolicy();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const [packagesResult, settingsResult] = await Promise.all([
        supabase.from("coin_packages").select("*").eq("is_active", true).order("sort_order").order("coins"),
        supabase.from("app_settings").select("value").eq("key", "payments.config").maybeSingle(),
      ]);
      if (packagesResult.error) throw packagesResult.error;
      setPackages(packagesResult.data ?? []);

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

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Tangalarni sotib olish" subtitle={`Balans: ${formatCoins(balance)}`} />

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
              <Text style={styles.noticeBody}>
                Mavjud J Coin balansingizdan ilovada odatdagidek foydalanishingiz mumkin.
              </Text>
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
                {payments.configured ? `To‘lov tizimi: ${payments.provider ?? "ulangan"}` : "To‘lov tizimi hali ulanmagan"}
              </Text>
              <Text style={styles.noticeBody}>
                {payments.configured
                  ? "To‘lovni tanlangan paket orqali amalga oshirishingiz mumkin."
                  : "Hozircha ilova orqali to‘lov qabul qilinmaydi. Paketlar narxi ko‘rsatilgan, lekin xarid qilish imkoni to‘lov provayderi ulangach ochiladi."}
              </Text>
            </View>
          </View>
        ) : null}

        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && policy.paymentsEnabled && !error && packages.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="Paketlar hali e’lon qilinmagan"
            message="Administrator tanga paketlarini sozlagach, ular shu yerda narxi bilan ko‘rinadi."
          />
        ) : null}

        <View style={styles.list}>
          {(policy.paymentsEnabled ? packages : []).map((item) => (
            <View key={item.id} style={styles.package}>
              <Image source={coinIcon} resizeMode="contain" style={styles.packageCoin} />
              <View style={styles.packageCopy}>
                <Text style={styles.packageLabel}>{item.label}</Text>
                <Text style={styles.packageCoins}>
                  {formatCoins(item.coins)}
                  {item.bonus_coins > 0 ? <Text style={styles.packageBonus}>  +{formatNumber(item.bonus_coins)} bonus</Text> : null}
                </Text>
                {item.description ? <Text style={styles.packageDescription}>{item.description}</Text> : null}
              </View>
              <View style={styles.packagePrice}>
                <Text style={styles.priceValue}>{formatPrice(Number(item.price_amount), item.currency)}</Text>
                <View style={[styles.priceState, payments.configured ? styles.priceStateReady : styles.priceStateLocked]}>
                  <CreditCard color={payments.configured ? colors.success : colors.inkSoft} size={13} strokeWidth={2} />
                  <Text style={[styles.priceStateText, payments.configured ? styles.priceStateTextReady : null]}>
                    {payments.configured ? "To‘lovga tayyor" : "Kutilmoqda"}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {!loading && packages.length > 0 && !payments.configured ? (
          <Text style={styles.footnote}>
            Narxlar administrator panelida boshqariladi. To‘lov provayderi ulangach, har bir paket yonida to‘lov tugmasi paydo bo‘ladi.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  notice: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  noticeReady: { backgroundColor: colors.successSoft, borderColor: "#BEE7DA" },
  noticePending: { backgroundColor: "#FDF4E5", borderColor: "#F0DFC0" },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  noticeBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },

  list: { gap: spacing.md },
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
});

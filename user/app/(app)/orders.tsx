import { useFocusEffect, useRouter } from "expo-router";
import { Receipt } from "lucide-react-native";
import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { formatSom } from "@/lib/money";
import { myOrders } from "@/lib/orders";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Row = Awaited<ReturnType<typeof myOrders>>[number];

const PURPOSE_LABELS: Record<string, string> = {
  subscription: "Tarif",
  jcoin: "J Coin",
  data_collection: "Ma’lumotlarni yig‘ish",
  marketplace_presentation: "Taqdimot",
  marketplace_reference: "Referat",
  marketplace_independent_work: "Mustaqil ish",
  marketplace_game: "O‘yin",
  other_marketplace_product: "Material",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Kutilmoqda",
  awaiting_verification: "Tasdiqlanmoqda",
  processing: "Amalga oshirilmoqda",
  paid: "To‘langan",
  failed: "Amalga oshmadi",
  cancelled: "Bekor qilingan",
  refunded: "Qaytarilgan",
  expired: "Muddati tugagan",
};

/**
 * Payment history.
 *
 * Deliberately thin: an order number, what it was for, what it cost and what
 * happened. No card data appears because `my_orders()` returns none — not
 * masked, not hinted, nothing. A receipt does not need it.
 */
export default function OrdersScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await myOrders());
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.screen}>
      <ScreenHeader title="To‘lovlar tarixi" onLeave={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={colors.primary}
            onRefresh={() => { setRefreshing(true); void load(); }} />
        }
      >
        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Hali to‘lov qilinmagan"
            message="Xaridlaringiz shu yerda buyurtma raqami bilan ko‘rinadi."
          />
        ) : null}

        {rows.map((row) => (
          <View key={row.order_number} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{row.title || PURPOSE_LABELS[row.purpose] || "Xarid"}</Text>
              <Text style={styles.meta}>
                {PURPOSE_LABELS[row.purpose] ?? row.purpose} · {row.order_number}
              </Text>
              <Text style={styles.meta}>{formatShortDateTime(row.paid_at ?? row.created_at)}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.amount}>{formatSom(row.total_amount)}</Text>
              <View style={[
                styles.badge,
                row.status === "paid" ? styles.badgePaid
                  : ["failed", "cancelled", "expired"].includes(row.status) ? styles.badgeFailed
                  : styles.badgePending,
              ]}>
                <Text style={[
                  styles.badgeText,
                  row.status === "paid" ? styles.badgeTextPaid
                    : ["failed", "cancelled", "expired"].includes(row.status) ? styles.badgeTextFailed
                    : styles.badgeTextPending,
                ]}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Text>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  title: { ...typography.bodyMedium, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
  right: { alignItems: "flex-end", gap: 4 },
  amount: { ...typography.bodyMedium, color: colors.ink },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgePaid: { backgroundColor: colors.successSoft },
  badgeFailed: { backgroundColor: colors.dangerSoft },
  badgePending: { backgroundColor: colors.surfaceMuted },
  badgeText: { ...typography.caption, fontSize: 11 },
  badgeTextPaid: { color: colors.success },
  badgeTextFailed: { color: colors.danger },
  badgeTextPending: { color: colors.inkMuted },
  icon: { width: icon.md },
}));

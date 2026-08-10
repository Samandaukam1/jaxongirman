import { MARKETPLACE_STATUS_LABELS, type MarketplaceProductStatus } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { Package, Plus, Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { formatSom } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

type Product = {
  id: string; title: string; status: MarketplaceProductStatus; base_price: number;
  sales_count: number; rating_sum: number; rating_count: number;
  rejection_reason: string | null; created_at: string;
};

type Summary = { sales_count: number; net_total: number; pending_total: number; paid_total: number };

/** The seller's shelf: what is listed, what state each listing is in, what it earned. */
export default function SellerDashboardScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [productResult, summaryResult] = await Promise.all([
      supabase
        .from("marketplace_products")
        .select("id,title,status,base_price,sales_count,rating_sum,rating_count,rejection_reason,created_at")
        .order("created_at", { ascending: false }),
      supabase.rpc("seller_earnings_summary", {}),
    ]);
    if (productResult.error) {
      setError(asErrorMessage(productResult.error));
    } else {
      setProducts((productResult.data ?? []) as Product[]);
      if (!summaryResult.error) setSummary(summaryResult.data as unknown as Summary);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Mahsulotlarim"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Daromadlar"
            onPress={() => router.push("/(app)/earnings")}
            style={styles.headerAction}
          >
            <Wallet color={colors.primary} size={icon.sm} strokeWidth={2.2} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {summary ? (
          <Pressable accessibilityRole="button" onPress={() => router.push("/(app)/earnings")} style={styles.summaryCard}>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{summary.sales_count}</Text>
              <Text style={styles.summaryLabel}>Sotuv</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{formatSom(summary.pending_total)}</Text>
              <Text style={styles.summaryLabel}>Kutilmoqda</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{formatSom(summary.paid_total)}</Text>
              <Text style={styles.summaryLabel}>To‘langan</Text>
            </View>
          </Pressable>
        ) : null}

        <PrimaryButton label="Yangi material" icon={Plus} onPress={() => router.push("/(app)/marketplace/sell")} />

        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Hali material joylamagansiz"
            message="Taqdimot, mustaqil ish yoki referatingizni joylang — tasdiqlangach Do‘konda sotuvga chiqadi."
          />
        ) : null}

        <View style={styles.list}>
          {products.map((product) => (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/(app)/marketplace/[id]", params: { id: product.id } })}
              style={styles.card}
            >
              <View style={styles.cardHead}>
                <Text numberOfLines={2} style={styles.cardTitle}>{product.title}</Text>
                <View style={[styles.badge, styles[`badge_${product.status}`] ?? styles.badge_draft]}>
                  <Text style={styles.badgeText}>{MARKETPLACE_STATUS_LABELS[product.status]}</Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>
                {formatSom(product.base_price)} · {product.sales_count} sotuv · {formatShortDateTime(product.created_at)}
              </Text>
              {product.status === "rejected" && product.rejection_reason ? (
                <Text style={styles.rejection}>Sabab: {product.rejection_reason}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  headerAction: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },

  summaryCard: { flexDirection: "row", alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow },
  summaryCell: { flex: 1, alignItems: "center", gap: 2 },
  summaryDivider: { width: 1, height: 30, backgroundColor: colors.border },
  summaryValue: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  summaryLabel: { ...typography.caption, fontSize: 10, color: colors.inkSoft },

  list: { gap: spacing.md },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  cardTitle: { ...typography.bodyMedium, color: colors.ink, flex: 1, fontSize: 15 },
  cardMeta: { ...typography.caption, color: colors.inkSoft },
  rejection: { ...typography.caption, color: colors.danger, marginTop: 2 },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { ...typography.caption, fontSize: 10, color: colors.inkMuted },
  badge_draft: { backgroundColor: colors.surfaceMuted },
  badge_pending_review: { backgroundColor: "#FDF4E5" },
  badge_approved: { backgroundColor: colors.successSoft },
  badge_rejected: { backgroundColor: colors.dangerSoft },
  badge_hidden: { backgroundColor: colors.surfaceMuted },
  badge_archived: { backgroundColor: colors.surfaceMuted },
});

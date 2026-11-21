import { useFocusEffect, useRouter } from "expo-router";
import { BookOpenText, Download, Library } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { Appear } from "@/components/Appear";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { useSuccessToast } from "@/components/SuccessToast";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { downloadPurchasedFile, shareFile, listingPrice } from "@/lib/marketplace";
import { formatCoins } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Purchase = {
  id: string;
  product_id: string;
  buyer_total: number;
  /** Set when the listing was paid for in J Tanga; the row then shows coins, not so‘m. */
  paid_coins?: number;
  purchased_at: string;
  marketplace_products: { title: string; material_type: string; file_format: string | null; has_study_guide: boolean } | null;
};

/**
 * Xaridlarim.
 *
 * The rows come from `marketplace_purchases` (so‘m), `marketplace_coin_purchases`
 * (J Tanga) and free entitlements, all under RLS, so a person sees only their
 * own — a listing bought for coins sits here exactly like one bought for so‘m. Downloading is not a link on this screen: the file is reached
 * through the entitlement-checked signing step, which is why each row offers an
 * action rather than a URL.
 */
export default function LibraryScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("market");
  const notify = useSuccessToast();
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [bought, taken, coins] = await Promise.all([
      supabase
        .from("marketplace_purchases")
        .select("id,product_id,buyer_total,purchased_at,marketplace_products(title,material_type,file_format,has_study_guide)")
        // Mine, stated. The policy also lets an admin read every purchase.
        .eq("buyer_id", user.id)
        .order("purchased_at", { ascending: false }),
      // Free listings are taken, not bought: they live as entitlements alone.
      supabase
        .from("purchase_entitlements")
        .select("id,product_id,granted_at,marketplace_products(title,material_type,file_format,has_study_guide)")
        .eq("user_id", user.id)
        .eq("source", "free")
        .is("revoked_at", null),
      supabase
        .from("marketplace_coin_purchases")
        .select("id,product_id,price,purchased_at,marketplace_products(title,material_type,file_format,has_study_guide)")
        // Mine as the buyer: the policy also shows a seller the coin sales they made.
        .eq("buyer_id", user.id),
    ]);
    const requestError = bought.error ?? taken.error ?? coins.error;
    if (requestError) setError(asErrorMessage(requestError));
    else {
      const free = (taken.data ?? []).map((row) => ({
        id: row.id, product_id: row.product_id, buyer_total: 0, purchased_at: row.granted_at,
        marketplace_products: row.marketplace_products,
      }));
      const paidInCoins = (coins.data ?? []).map((row) => ({
        id: row.id, product_id: row.product_id, buyer_total: 0, paid_coins: row.price, purchased_at: row.purchased_at,
        marketplace_products: row.marketplace_products,
      }));
      const all = [
        ...((bought.data ?? []) as unknown as Purchase[]),
        ...(free as unknown as Purchase[]),
        ...(paidInCoins as unknown as Purchase[]),
      ]
        .sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
      setPurchases(all);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function download(productId: string, kind: "main" | "study_guide") {
    setBusyId(`${productId}:${kind}`);
    try {
      const file = await downloadPurchasedFile(productId, kind);
      const shared = await shareFile(file.uri, file.mimeType);
      if (!shared) notify(t("library.saved"), t("library.savedBody"));
    } catch (downloadError) {
      Alert.alert(t("library.failed"), await asFunctionErrorMessage(downloadError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("library.title")} subtitle={purchases.length ? t("library.count", { count: purchases.length }) : undefined} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && purchases.length === 0 ? (
          <EmptyState
            icon={Library}
            title={t("library.empty")}
            message={t("library.emptyBody")}
          />
        ) : null}

        <View style={styles.list}>
          {purchases.map((purchase, index) => (
            <Appear key={purchase.id} index={index}>
              <View key={purchase.id} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/(app)/marketplace/[id]", params: { id: purchase.product_id } })}
                  style={styles.cardCopy}
                >
                  <Text numberOfLines={2} style={styles.cardTitle}>
                    {purchase.marketplace_products?.title ?? t("library.fallback")}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {purchase.paid_coins ? formatCoins(purchase.paid_coins) : listingPrice(purchase.buyer_total)} · {formatShortDateTime(purchase.purchased_at)}
                    {purchase.marketplace_products?.file_format ? ` · ${purchase.marketplace_products.file_format.toUpperCase()}` : ""}
                  </Text>
                </Pressable>

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyId !== null}
                    onPress={() => void download(purchase.product_id, "main")}
                    style={styles.action}
                  >
                    {busyId === `${purchase.product_id}:main`
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <Download color={colors.primary} size={16} strokeWidth={2} />}
                    <Text style={styles.actionText}>{t("library.download")}</Text>
                  </Pressable>
                  {purchase.marketplace_products?.has_study_guide ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busyId !== null}
                      onPress={() => void download(purchase.product_id, "study_guide")}
                      style={styles.action}
                    >
                      {busyId === `${purchase.product_id}:study_guide`
                        ? <ActivityIndicator color={colors.primary} size="small" />
                        : <BookOpenText color={colors.primary} size={16} strokeWidth={2} />}
                      <Text style={styles.actionText}>{t("library.guide")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

            </Appear>          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  list: { gap: spacing.md },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadow },
  cardCopy: { gap: 2 },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  actionText: { ...typography.caption, color: colors.primary, fontFamily: "JaxongirmanSans_600SemiBold" },
  cardTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 15 },
  cardMeta: { ...typography.caption, color: colors.inkSoft },
}));

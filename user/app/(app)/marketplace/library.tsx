import { useFocusEffect, useRouter } from "expo-router";
import { BookOpenText, Download, Library } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import { downloadPurchasedFile, shareFile } from "@/lib/marketplace";
import { formatSom } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Purchase = {
  id: string;
  product_id: string;
  buyer_total: number;
  purchased_at: string;
  marketplace_products: { title: string; material_type: string; file_format: string | null; has_study_guide: boolean } | null;
};

/**
 * Xaridlarim.
 *
 * The rows come from `marketplace_purchases` under RLS, so a person sees only
 * their own. Downloading is not a link on this screen: the file is reached
 * through the entitlement-checked signing step, which is why each row offers an
 * action rather than a URL.
 */
export default function LibraryScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase
      .from("marketplace_purchases")
      .select("id,product_id,buyer_total,purchased_at,marketplace_products(title,material_type,file_format,has_study_guide)")
      .order("purchased_at", { ascending: false });
    if (requestError) setError(asErrorMessage(requestError));
    else { setPurchases((data ?? []) as unknown as Purchase[]); setError(null); }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function download(productId: string, kind: "main" | "study_guide") {
    setBusyId(`${productId}:${kind}`);
    try {
      const file = await downloadPurchasedFile(productId, kind);
      const shared = await shareFile(file.uri, file.mimeType);
      if (!shared) Alert.alert("Yuklab olindi", "Fayl qurilmaga saqlandi.");
    } catch (downloadError) {
      Alert.alert("Yuklab olinmadi", await asFunctionErrorMessage(downloadError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Xaridlarim" subtitle={purchases.length ? `${purchases.length} ta material` : undefined} />

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
            title="Kutubxonangiz bo‘sh"
            message="Do‘kondan material sotib olsangiz, u shu yerda saqlanadi va istalgan vaqtda yuklab olasiz."
          />
        ) : null}

        <View style={styles.list}>
          {purchases.map((purchase) => (
            <View key={purchase.id} style={styles.card}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/(app)/marketplace/[id]", params: { id: purchase.product_id } })}
                style={styles.cardCopy}
              >
                <Text numberOfLines={2} style={styles.cardTitle}>
                  {purchase.marketplace_products?.title ?? "Material"}
                </Text>
                <Text style={styles.cardMeta}>
                  {formatSom(purchase.buyer_total)} · {formatShortDateTime(purchase.purchased_at)}
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
                  <Text style={styles.actionText}>Yuklab olish</Text>
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
                    <Text style={styles.actionText}>Study guide</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
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
  actionText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  cardTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 15 },
  cardMeta: { ...typography.caption, color: colors.inkSoft },
}));

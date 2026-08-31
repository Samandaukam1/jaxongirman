import { useRouter } from "expo-router";
import { Crown, ShoppingBag, Store, Vote } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { buyVotes, useVoteMarketEnabled, voteMarket, type VoteLot } from "@/lib/marathon-market";
import { formatNumber, formatSom } from "@/lib/money";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The vote market, where every lot is the same thing and none of them has a
 * face.
 *
 * No seller, no avatar, no username, no rating — §21 asks for anonymity and the
 * function this reads cannot return a seller even if a screen wanted one. What
 * is left to compare is the price, so the cheapest is first and the card says
 * plainly what will be charged: the lot, the buyer's 12%, and the total.
 *
 * Free and Premium are separate lists rather than one mixed feed. They are
 * different goods at different prices, and a single list sorted by price would
 * bury every Premium lot under the free ones.
 */
export default function VoteMarketScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const enabled = useVoteMarketEnabled();

  const [kind, setKind] = useState<"premium" | "free">("premium");
  const [lots, setLots] = useState<VoteLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLots(await voteMarket(kind));
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [kind]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [enabled, load]);

  async function buy(lot: VoteLot) {
    setBuying(lot.listing_id);
    try {
      const order = await buyVotes(lot.listing_id, lot.remaining);
      router.push(`/(app)/checkout/${order.order_id}`);
    } catch (failure) {
      setError(asErrorMessage(failure));
      await load();
    } finally {
      setBuying(null);
    }
  }

  if (!enabled) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="OVOZ MARKETPLACE" variant="back" />
        <EmptyState icon={Store} title="Bozor yopiq" message="Ovozlar bozori hozircha ochilmagan." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="OVOZ MARKETPLACE" variant="back" />

      <View style={styles.tabs}>
        {(["premium", "free"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === option }}
            onPress={() => setKind(option)}
            style={[styles.tab, kind === option && styles.tabOn]}
          >
            <Text style={[styles.tabLabel, kind === option && styles.tabLabelOn]}>
              {option === "premium" ? "⭐ Premium ovoz" : "Bepul ovoz"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }}
          />
        }
      >
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {loading ? (
          <SkeletonCard lines={3} />
        ) : lots.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Hozircha e’lon yo‘q"
            message={kind === "premium" ? "Sotuvda Premium ovoz yo‘q." : "Sotuvda bepul ovoz yo‘q."}
          />
        ) : (
          lots.map((lot) => (
            <View key={lot.listing_id} style={styles.card}>
              <View style={styles.cardHead}>
                {lot.kind === "premium"
                  ? <Crown color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
                  : <Vote color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />}
                <Text style={styles.cardTitle}>
                  {lot.kind === "premium" ? "PREMIUM OVOZ" : "BEPUL OVOZ"}
                </Text>
                {lot.is_mine ? <Text style={styles.mine}>Sizniki</Text> : null}
              </View>

              <Text style={styles.quantity}>{formatNumber(lot.remaining)} dona</Text>

              {/* Every figure the buyer will be charged, before they commit to
                  a screen that asks for a card. */}
              <View style={styles.lines}>
                <Line label="1 dona" value={formatSom(lot.unit_price)} />
                <Line label="Jami" value={formatSom(lot.unit_price * lot.remaining)} />
                <Line label="Xaridor komissiyasi" value={formatSom(lot.buyer_fee)} />
              </View>

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>TO‘LOV</Text>
                <Text style={styles.totalValue}>{formatSom(lot.buyer_total)}</Text>
              </View>

              {lot.is_mine ? (
                <Text style={styles.hint}>O‘z e’loningizni sotib ololmaysiz.</Text>
              ) : buying === lot.listing_id ? (
                <View style={styles.buying}><ActivityIndicator color={colors.primary} /></View>
              ) : (
                <PrimaryButton label="Sotib olish" onPress={() => void buy(lot)} />
              )}

              <Text style={styles.anon}>Sotuvchi: anonim</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  tab: {
    flex: 1, height: 40, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabLabel: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.inkMuted },
  tabLabelOn: { color: colors.primaryDeep },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md, paddingBottom: spacing.xxxl },
  card: {
    gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", letterSpacing: 0.8, color: colors.primaryDeep },
  mine: { ...typography.caption, color: colors.inkSoft, marginLeft: "auto" },
  quantity: { ...typography.title, color: colors.ink },
  lines: { gap: 2 },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineLabel: { ...typography.caption, color: colors.inkMuted },
  lineValue: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.ink },
  totalRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  totalLabel: { ...typography.caption, fontFamily: "Manrope_700Bold", letterSpacing: 0.8, color: colors.inkMuted },
  totalValue: { ...typography.heading, color: colors.ink },
  buying: { height: 50, alignItems: "center", justifyContent: "center" },
  hint: { ...typography.caption, color: colors.inkSoft },
  anon: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
}));

import { Crown, Store, Vote } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { myVotes, useMarathonCampaign, type MarathonVotes } from "@/lib/marathon";
import {
  cancelVoteListing, listVotes, minVotePrice, myVoteSales, useVoteMarketEnabled,
  voteMarket, voteQuote, type VoteLot, type VoteQuote, type VoteSale,
} from "@/lib/marathon-market";
import { formatNumber, formatSom } from "@/lib/money";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Selling a vote.
 *
 * The screen shows the seller's side of the same arithmetic the buyer sees, and
 * shows it while they type: the listing, the platform's 12%, and what actually
 * arrives. A price is a decision somebody makes once and lives with, and a
 * total that only appears after submitting is a total they discover too late.
 *
 * The floor comes from the server and is stated before it is enforced — being
 * told a price is too low is much worse than being told what the lowest price
 * is.
 */
export default function SellVotesScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const enabled = useVoteMarketEnabled();
  const { campaign } = useMarathonCampaign();

  const [kind, setKind] = useState<"premium" | "free">("premium");
  const [price, setPrice] = useState("");
  const [wallet, setWallet] = useState<MarathonVotes | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [quote, setQuote] = useState<VoteQuote | null>(null);
  const [mine, setMine] = useState<VoteLot[]>([]);
  const [sales, setSales] = useState<VoteSale[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const available = kind === "premium"
    ? wallet?.premium_available ?? 0
    : wallet?.free_available ?? 0;

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const [votes, lots, sold] = await Promise.all([myVotes(), voteMarket(kind), myVoteSales()]);
      setWallet(votes);
      setMine(lots.filter((lot) => lot.is_mine));
      setSales(sold);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [enabled, kind]);

  useEffect(() => { void load(); }, [load]);

  // The floor is a property of the campaign and the kind, so it is fetched
  // rather than guessed, and re-fetched when the kind changes.
  useEffect(() => {
    if (!campaign) return;
    let cancelled = false;
    void minVotePrice(campaign.id, kind)
      .then((value) => { if (!cancelled) setFloor(value); })
      .catch(() => { if (!cancelled) setFloor(null); });
    return () => { cancelled = true; };
  }, [campaign, kind]);

  // What the seller will actually receive, recomputed by the server as they type.
  const amount = useMemo(() => Number(price.replace(/\D/g, "")) || 0, [price]);
  useEffect(() => {
    if (amount <= 0) { setQuote(null); return; }
    let cancelled = false;
    const handle = setTimeout(() => {
      void voteQuote(amount, 1)
        .then((value) => { if (!cancelled) setQuote(value); })
        .catch(() => { if (!cancelled) setQuote(null); });
    }, 260);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [amount]);

  const belowFloor = floor !== null && amount > 0 && amount < floor;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await listVotes(kind, 1, amount);
      setPrice("");
      await load();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(listingId: string) {
    try {
      await cancelVoteListing(listingId);
      await load();
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }

  if (!enabled) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="OVOZ SOTISH" variant="back" />
        <EmptyState icon={Store} title="Bozor yopiq" message="Ovozlar bozori hozircha ochilmagan." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="OVOZ SOTISH" variant="back" />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.options}>
          {(["premium", "free"] as const).map((option) => {
            const held = option === "premium" ? wallet?.premium_available ?? 0 : wallet?.free_available ?? 0;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === option }}
                onPress={() => setKind(option)}
                style={[styles.option, kind === option && styles.optionOn]}
              >
                {option === "premium"
                  ? <Crown color={kind === option ? colors.primary : colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />
                  : <Vote color={kind === option ? colors.primary : colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{option === "premium" ? "Premium ovoz" : "Bepul ovoz"}</Text>
                  <Text style={styles.optionHint}>Mavjud: {formatNumber(held)} dona</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>1 dona narxi</Text>
          <TextInput
            keyboardType="number-pad"
            value={price}
            onChangeText={setPrice}
            placeholder={floor !== null ? `Kamida ${formatSom(floor)}` : "Narx"}
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
          />
          {floor !== null ? (
            <Text style={styles.fieldHint}>
              Ushbu marafon uchun minimal bozor narxi: {formatSom(floor)}
            </Text>
          ) : null}
        </View>

        {/* The seller's own arithmetic, live, from the same function the buyer's
            total comes from. */}
        {quote ? (
          <View style={styles.quote}>
            <Row label="E’lon narxi" value={formatSom(quote.base_price)} />
            <Row label={`${quote.seller_fee_rate}% sotuvchi komissiyasi`} value={`− ${formatSom(quote.seller_fee_amount)}`} />
            <View style={styles.quoteTotal}>
              <Text style={styles.quoteTotalLabel}>Siz olasiz</Text>
              <Text style={styles.quoteTotalValue}>{formatSom(quote.seller_net)}</Text>
            </View>
          </View>
        ) : null}

        {belowFloor ? (
          <InlineError message="Narx ushbu marafon uchun ruxsat etilgan minimal bozor narxidan past." />
        ) : null}
        {error ? <InlineError message={error} /> : null}

        <PrimaryButton
          label="E’lonni joylash"
          loading={saving}
          disabled={available < 1 || amount <= 0 || belowFloor}
          onPress={() => void submit()}
        />
        {available < 1 ? (
          <Text style={styles.note}>
            Bu turdagi ovozingiz qolmagan — ishlatilgan yoki allaqachon sotuvda.
          </Text>
        ) : null}

        {mine.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOTUVDAGI E’LONLARIM</Text>
            {mine.map((lot) => (
              <View key={lot.listing_id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {lot.kind === "premium" ? "Premium ovoz" : "Bepul ovoz"} · {formatNumber(lot.remaining)} dona
                  </Text>
                  <Text style={styles.rowHint}>{formatSom(lot.unit_price)} / dona</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void withdraw(lot.listing_id)}
                  style={({ pressed }) => [styles.withdraw, pressed && styles.withdrawPressed]}
                >
                  <Text style={styles.withdrawLabel}>Bekor qilish</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {sales.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOTILGANLAR</Text>
            {sales.map((sale) => (
              <View key={sale.sale_id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {sale.kind === "premium" ? "Premium ovoz" : "Bepul ovoz"} · {formatNumber(sale.quantity)} dona
                  </Text>
                  <Text style={styles.rowHint}>
                    {sale.status === "released" ? "Yakunlandi" : sale.status === "escrow" ? "To‘lov kutilmoqda" : "Bekor qilindi"}
                  </Text>
                </View>
                <Text style={styles.rowValue}>{formatSom(sale.seller_net)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.quoteLine}>
      <Text style={styles.quoteLabel}>{label}</Text>
      <Text style={styles.quoteValue}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  options: { gap: spacing.sm },
  option: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionLabel: { ...typography.bodyMedium, color: colors.ink },
  optionHint: { ...typography.caption, color: colors.inkMuted },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.inkMuted },
  input: {
    height: 50, paddingHorizontal: spacing.md, ...typography.bodyMedium, color: colors.ink,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  fieldHint: { ...typography.caption, color: colors.inkSoft },
  quote: {
    gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  quoteLine: { flexDirection: "row", justifyContent: "space-between" },
  quoteLabel: { ...typography.caption, color: colors.inkMuted },
  quoteValue: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.ink },
  quoteTotal: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border,
  },
  quoteTotalLabel: { ...typography.bodyMedium, color: colors.ink },
  quoteTotalValue: { ...typography.heading, color: colors.primaryDeep },
  note: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionTitle: {
    ...typography.caption, fontFamily: "Manrope_700Bold", letterSpacing: 0.8, color: colors.inkMuted,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rowTitle: { ...typography.bodyMedium, color: colors.ink },
  rowHint: { ...typography.caption, color: colors.inkMuted },
  rowValue: { ...typography.bodyMedium, color: colors.primaryDeep },
  withdraw: {
    paddingHorizontal: spacing.md, height: 34, justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
  },
  withdrawPressed: { opacity: 0.7 },
  withdrawLabel: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.ink },
}));

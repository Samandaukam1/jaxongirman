import { formatUzPhone, normalizeUzPhone } from "@jaxongirman/types";
import { useFocusEffect } from "expo-router";
import { CheckCircle2, Clock, CreditCard, Phone, Wallet } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { PrimaryButton } from "@/components/PrimaryButton";
import { PaymentUnavailable } from "@/components/PaymentUnavailable";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { useSuccessToast } from "@/components/SuccessToast";
import { formatDate, formatShortDateTime } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { formatSom } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { useAuth } from "@/providers/AuthProvider";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Settlement = {
  id: string;
  period_start: string;
  period_end: string;
  gross_sales: number;
  seller_fees: number;
  payable_amount: number;
  currency: string;
  status: string;
  destination_note: string;
  reference: string;
  paid_at: string | null;
  created_at: string;
};

type Summary = {
  sales_count: number;
  gross_total: number;
  fee_total: number;
  net_total: number;
  pending_total: number;
  paid_total: number;
  contact: { phone: string; telegram_username: string | null } | null;
  settlements: Settlement[];
};

/**
 * Daromadlar — what selling has earned, and what has actually been paid out.
 *
 * The payout itself is manual: an accountant moves the money and records where
 * it went. This screen is the seller's side of that record, which is why every
 * paid row states the amount, the destination and the date rather than just a
 * status chip.
 */
export default function EarningsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["ledger", "common"]);
  const notify = useSuccessToast();
  const policy = usePaymentPolicy();
  const { user } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase.rpc("seller_earnings_summary", {});
    if (requestError) {
      setError(asErrorMessage(requestError));
    } else {
      const next = data as unknown as Summary;
      setSummary(next);
      if (next.contact?.phone) setPhone(formatUzPhone(next.contact.phone));
      if (next.contact?.telegram_username) setTelegram(next.contact.telegram_username);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function saveContact() {
    if (!user) return;
    const normalized = normalizeUzPhone(phone);
    if (!normalized) { setContactError(t("earnings.phoneFormat")); return; }
    setSavingContact(true);
    setContactError(null);
    const { error: saveError } = await supabase.from("seller_payout_contacts").upsert({
      user_id: user.id,
      phone: normalized,
      telegram_username: telegram.replace(/^@/, "").trim() || null,
    });
    setSavingContact(false);
    if (saveError) setContactError(asErrorMessage(saveError));
    else notify(t("earnings.saved"), t("earnings.savedBody"));
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("earnings.title")} />
        <View style={styles.content}><SkeletonCard lines={3} /><SkeletonCard lines={2} /></View>
      </View>
    );
  }

  if (error || !summary) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("earnings.title")} />
        <View style={styles.content}><ErrorState message={error ?? t("earnings.notFound")} onRetry={() => void load()} /></View>
      </View>
    );
  }

  // The payout side of a shop that is closed on this platform. Balances are not
  // hidden because they are secret — they are hidden because a marketplace that
  // cannot transact here should not present its accounting either.
  if (!policy.loading && !policy.paymentsEnabled) {
    return (
      <PaymentUnavailable
        title={policy.unavailableMessage("marketplace")}
        message={t("earnings.keptBody")}
        onLeave={undefined}
      />
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("earnings.title")} subtitle={t("earnings.sales", { count: summary.sales_count })} />

      <KeyboardAwareScrollView bottomOffset={spacing.xl}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.headline}>
          <Text style={styles.headlineLabel}>{t("earnings.total")}</Text>
          <Text style={styles.headlineValue}>{formatSom(summary.net_total)}</Text>
          <View style={styles.headlineRow}>
            <View style={styles.headlineStat}>
              <Text style={styles.statValue}>{formatSom(summary.pending_total)}</Text>
              <Text style={styles.statLabel}>{t("earnings.pending")}</Text>
            </View>
            <View style={styles.headlineDivider} />
            <View style={styles.headlineStat}>
              <Text style={styles.statValue}>{formatSom(summary.paid_total)}</Text>
              <Text style={styles.statLabel}>{t("earnings.paid")}</Text>
            </View>
          </View>
        </View>

        {/* ------------------------------------------------- payout contact */}
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Phone color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.panelTitle}>{t("earnings.contact")}</Text>
          </View>
          <Text style={styles.panelCopy}>
            {t("earnings.contactBody")}
          </Text>
          <TextInput
            value={phone}
            onChangeText={(value) => setPhone(formatUzPhone(value))}
            onFocus={() => { if (!phone) setPhone("+998 "); }}
            placeholder="+998 90 123 45 67"
            placeholderTextColor={colors.inkSoft}
            keyboardType="phone-pad"
            style={styles.input}
          />
          <TextInput
            value={telegram}
            onChangeText={(value) => setTelegram(value.replace(/[^A-Za-z0-9_@]/g, "").slice(0, 33))}
            placeholder={t("earnings.telegram")}
            placeholderTextColor={colors.inkSoft}
            autoCapitalize="none"
            style={styles.input}
          />
          {contactError ? <InlineError message={contactError} /> : null}
          <PrimaryButton label={t("common:save")} tone="secondary" loading={savingContact} onPress={() => void saveContact()} />
        </View>

        {/* ---------------------------------------------------- settlements */}
        <Text style={styles.sectionTitle}>{t("earnings.history")}</Text>

        {summary.settlements.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t("earnings.empty")}
            message={t("earnings.emptyBody")}
          />
        ) : (
          <View style={styles.list}>
            {summary.settlements.map((settlement) => {
              const paid = settlement.status === "paid";
              return (
                <View key={settlement.id} style={[styles.settlement, paid && styles.settlementPaid]}>
                  <View style={styles.settlementHead}>
                    {paid
                      ? <CheckCircle2 color={colors.success} size={18} strokeWidth={2} />
                      : <Clock color={colors.warning} size={18} strokeWidth={2} />}
                    <Text style={styles.settlementAmount}>{formatSom(settlement.payable_amount)}</Text>
                    <View style={[styles.badge, paid ? styles.badgePaid : styles.badgePending]}>
                      <Text style={[styles.badgeText, paid ? styles.badgeTextPaid : styles.badgeTextPending]}>
                        {(["draft", "pending", "paid", "cancelled"] as const).find((status) => status === settlement.status) ? t(`earnings.status.${settlement.status as "draft"}`) : settlement.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.settlementPeriod}>
                    {t("earnings.period", { from: formatDate(settlement.period_start), to: formatDate(settlement.period_end) })}
                  </Text>

                  {paid ? (
                    <>
                      {settlement.destination_note ? (
                        <View style={styles.destinationRow}>
                          <CreditCard color={colors.inkSoft} size={14} strokeWidth={2} />
                          <Text style={styles.destination}>{settlement.destination_note}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.settlementDate}>
                        {t("earnings.paidAt", { date: settlement.paid_at ? formatShortDateTime(settlement.paid_at) : "—" })}
                      </Text>
                      {settlement.reference ? <Text style={styles.reference}>{t("earnings.note", { note: settlement.reference })}</Text> : null}
                    </>
                  ) : (
                    <Text style={styles.settlementDate}>
                      {t("earnings.preparedAt", { date: formatShortDateTime(settlement.created_at) })}
                    </Text>
                  )}

                  <View style={styles.breakdown}>
                    <Text style={styles.breakdownLine}>Sotuvlar: {formatSom(settlement.gross_sales)}</Text>
                    <Text style={styles.breakdownLine}>Komissiya: −{formatSom(settlement.seller_fees)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  headline: { padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4, ...shadow },
  headlineLabel: { ...typography.caption, color: colors.inkMuted },
  headlineValue: { fontFamily: "Manrope_700Bold", fontSize: 34, lineHeight: 40, color: colors.ink, letterSpacing: -0.8 },
  headlineRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  headlineStat: { flex: 1, gap: 2 },
  headlineDivider: { width: 1, height: 32, backgroundColor: colors.border },
  statValue: { ...typography.bodyMedium, color: colors.ink, fontSize: 15 },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.inkSoft },

  panel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  panelHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  panelTitle: { ...typography.bodyMedium, color: colors.ink },
  panelCopy: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  input: {
    ...typography.body, color: colors.ink, minHeight: 50,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },

  sectionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  list: { gap: spacing.md },
  settlement: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6 },
  settlementPaid: { borderColor: colors.successBorder, backgroundColor: colors.successSoft },
  settlementHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  settlementAmount: { ...typography.heading, color: colors.ink, flex: 1 },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgePaid: { backgroundColor: colors.surface },
  badgePending: { backgroundColor: colors.warningSoft },
  badgeText: { ...typography.caption, fontSize: 11 },
  badgeTextPaid: { color: colors.success },
  badgeTextPending: { color: colors.warning },
  settlementPeriod: { ...typography.caption, color: colors.inkMuted },
  destinationRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  destination: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold" },
  settlementDate: { ...typography.caption, color: colors.inkSoft },
  reference: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  breakdown: { flexDirection: "row", gap: spacing.lg, marginTop: 4, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  breakdownLine: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
}));

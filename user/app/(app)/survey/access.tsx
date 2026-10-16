import { DATA_COLLECTION_MODULE } from "@jaxongirman/types";
import { useRouter } from "expo-router";
import { CalendarClock, CircleCheck, CircleSlash, Info, ShieldCheck, Timer } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { formatDate, formatRemainingWindow } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { useModuleAccess } from "@/lib/modules";
import { formatPrice } from "@/lib/money";
import { createModuleOrder } from "@/lib/orders";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * What access to this module actually is, right now, for this person.
 *
 * Every line comes from `module_access_state()`: the price and window from
 * admin configuration, the entitlement from the database, and the enforcement
 * switches as they are actually set. Nothing here claims access that has not
 * been granted, and nothing offers a purchase that cannot be completed.
 */
export default function SurveyAccessScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("survey");
  const router = useRouter();
  const policy = usePaymentPolicy();
  const [opening, setOpening] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  /** Opens an order for module access; the price comes from the settings row. */
  async function buyAccess() {
    setOpening(true);
    setBuyError(null);
    try {
      const order = await createModuleOrder(DATA_COLLECTION_MODULE);
      router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } });
    } catch (failure) {
      setBuyError(asErrorMessage(failure));
    } finally {
      setOpening(false);
    }
  }
  const { state, loading, error, reload } = useModuleAccess(DATA_COLLECTION_MODULE);

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("access.title")} />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (error || !state) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("access.title")} />
        <View style={styles.content}><ErrorState message={error ?? t("access.unknown")} onRetry={() => void reload()} /></View>
      </View>
    );
  }

  const enforced = state.enforce_creator_access || state.enforce_respondent_access;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("access.title")} subtitle={state.label ?? t("module")} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusCard, state.has_access ? styles.statusActive : styles.statusIdle]}>
          {state.has_access
            ? <CircleCheck color={colors.success} size={28} strokeWidth={2} />
            : <ShieldCheck color={colors.primary} size={28} strokeWidth={2} />}
          <Text style={styles.statusTitle}>
            {state.has_access ? t("access.active") : enforced ? t("access.denied") : t("access.open")}
          </Text>
          <Text style={styles.statusBody}>
            {state.has_access
              ? t("access.activeBody", { date: state.expires_at ? formatDate(state.expires_at) : "—", left: formatRemainingWindow(state.expires_at) ?? "" })
              : enforced
                ? t("access.deniedBody")
                : t("access.openBody")}
          </Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t("access.terms")}</Text>

          <View style={styles.row}>
            <CalendarClock color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.rowLabel}>{t("access.duration")}</Text>
            <Text style={styles.rowValue}>{t("access.months", { count: state.duration_months })}</Text>
          </View>
          <View style={styles.row}>
            <Info color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.rowLabel}>{t("access.price")}</Text>
            <Text style={styles.rowValue}>
              {policy.showPrices ? formatPrice(state.price_amount, state.currency) : "—"}
            </Text>
          </View>
          <View style={styles.row}>
            <Timer color={colors.primary} size={18} strokeWidth={2} />
            <Text style={styles.rowLabel}>{t("access.retention")}</Text>
            <Text style={styles.rowValue}>{t("access.hours", { count: state.retention_hours })}</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t("access.who")}</Text>
          <View style={styles.row}>
            {state.enforce_creator_access
              ? <CircleCheck color={colors.success} size={18} strokeWidth={2} />
              : <CircleSlash color={colors.inkSoft} size={18} strokeWidth={2} />}
            <Text style={styles.rowLabel}>{t("access.creator")}</Text>
            <Text style={styles.rowValue}>{state.enforce_creator_access ? t("access.required") : t("access.notRequired")}</Text>
          </View>
          <View style={styles.row}>
            {state.enforce_respondent_access
              ? <CircleCheck color={colors.success} size={18} strokeWidth={2} />
              : <CircleSlash color={colors.inkSoft} size={18} strokeWidth={2} />}
            <Text style={styles.rowLabel}>{t("access.respondent")}</Text>
            <Text style={styles.rowValue}>{state.enforce_respondent_access ? t("access.required") : t("access.notRequired")}</Text>
          </View>
        </View>

        <View style={[styles.notice, !policy.paymentsEnabled ? styles.noticePending
          : state.payment_configured ? styles.noticeReady : styles.noticePending]}>
          <Text style={styles.noticeTitle}>
            {!policy.paymentsEnabled
              ? policy.unavailableMessage("module")
              : state.payment_configured ? t("access.provider", { provider: state.payment_provider ?? t("access.providerConnected") }) : t("access.noProvider")}
          </Text>
          <Text style={styles.noticeBody}>
            {!policy.paymentsEnabled
              ? t("access.iosBody")
              : state.payment_configured
                ? t("access.readyBody")
                : t("access.pendingBody")}
          </Text>
        </View>

        {policy.paymentsEnabled && state.payment_configured && !state.has_access ? (
          <>
            {buyError ? <InlineError message={buyError} /> : null}
            <PrimaryButton
              label={t("access.buy", { price: formatPrice(state.price_amount, state.currency) })}
              loading={opening}
              onPress={() => void buyAccess()}
            />
          </>
        ) : null}

        <Text style={styles.privacy}>
          {t("access.privacy", { hours: state.retention_hours })}
        </Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  statusCard: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, ...shadow },
  statusActive: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  statusIdle: { backgroundColor: colors.primarySoft, borderColor: colors.border },
  statusTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  statusBody: { ...typography.caption, color: colors.inkMuted, textAlign: "center", lineHeight: 18, maxWidth: 300 },

  panel: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  panelTitle: { ...typography.bodyMedium, color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowLabel: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  rowValue: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold" },

  notice: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, gap: 4 },
  noticeReady: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  noticePending: { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder },
  noticeTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  noticeBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },

  privacy: { ...typography.caption, color: colors.inkSoft, lineHeight: 18, textAlign: "center" },
}));

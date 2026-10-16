import type { QuotaStatus } from "@jaxongirman/tariff-card";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { Crown, RotateCcw } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { GlassPanel } from "@/components/Glass";
import { formatDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { createSubscriptionOrder } from "@/lib/orders";
import { myUsage, restartPreview, type RestartPreview } from "@/lib/subscription";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** The allowance a presentation spends, whatever window the plan sets on it. */
const PRESENTATIONS = "presentation_weekly";

type PlanState = {
  preview: RestartPreview | null;
  quota: QuotaStatus | null;
};

/**
 * Restarting a plan, asked the way the tariff page asks it.
 *
 * The numbers in the question are the server's: how many days are given up
 * and what is paid. Confirming opens the same order and checkout every other
 * purchase goes through.
 */
export function usePlanRestart() {
  const router = useRouter();
  const { t } = useTranslation(["wallet", "common"]);
  const [opening, setOpening] = useState(false);

  const restart = useCallback((preview: RestartPreview | null) => {
    if (!preview?.member || !preview.planCode) return;
    const planCode = preview.planCode;
    const spent = preview.used.reduce((sum, entry) => sum + entry.used, 0);
    Alert.alert(
      t("tariff.restart"),
      t("wallet:tariff.restartBody", { plan: preview.planName ?? t("wallet:tariff.restartPlan"), days: preview.remainingDays })
      + (spent > 0 ? t("wallet:tariff.restartSpent", { count: spent }) : ""),
      [
        { text: t("common:cancel"), style: "cancel" },
        {
          text: t("tariff.restartConfirm"),
          style: "destructive",
          onPress: () => {
            setOpening(true);
            void createSubscriptionOrder(planCode, true)
              .then((order) => router.push({ pathname: "/(app)/checkout/[orderId]", params: { orderId: order.order_id } }))
              .catch((failure: unknown) => Alert.alert(t("tariff.orderFailed"), asErrorMessage(failure)))
              .finally(() => setOpening(false));
          },
        },
      ],
    );
  }, [router, t]);

  return { restart, opening };
}

/**
 * How many presentations are left this period, and the way to get more.
 *
 * One card in two places, for members only. On Profile it carries the
 * restart. On Home the restart appears beside the count once the allowance is
 * running low or gone — the moment it is the thing needed.
 *
 * Restart is offered only where a purchase may be offered at all: the iOS
 * build shows the count and no button.
 */
export function PlanUsageCard({ variant = "profile" }: { variant?: "profile" | "home" }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const policy = usePaymentPolicy();
  const { restart, opening } = usePlanRestart();
  const { t } = useTranslation("wallet");
  const [state, setState] = useState<PlanState | null>(null);

  // Re-read on focus: a deck made a minute ago has already spent one.
  useFocusEffect(useCallback(() => {
    let live = true;
    void Promise.all([restartPreview().catch(() => null), myUsage().catch(() => [] as QuotaStatus[])])
      .then(([preview, usage]) => {
        if (live) setState({ preview, quota: usage.find((row) => row.feature === PRESENTATIONS) ?? null });
      });
    return () => { live = false; };
  }, []));

  if (!state) return null;
  const { preview, quota } = state;
  const member = Boolean(preview?.member);
  const limit = quota && !quota.unlimited ? quota.limit ?? 0 : 0;
  const used = Math.min(quota?.used ?? 0, limit || Infinity);
  const left = limit > 0 ? Math.max(0, limit - used) : null;
  const exhausted = member && left === 0;
  const low = member && left !== null && limit > 0 && left <= Math.max(2, Math.round(limit * 0.15));
  const canRestart = member && policy.paymentsEnabled && Boolean(preview?.planCode) && (variant === "profile" || exhausted || low);

  // The card is a member's allowance. Without a plan there is nothing to count,
  // and the way to a plan is the Tarif row on Profil, not a second one here.
  if (!member) return null;

  const tone = exhausted ? colors.danger : low ? colors.warning : colors.primary;
  const fill = limit > 0 ? used / limit : 0;
  const resets = quota?.resets_at ? formatDate(quota.resets_at) : null;

  return (
    <GlassPanel radius={radius.lg} padded={false}>
      <View style={styles.body}>
        <View style={styles.row}>
          <LinearGradient colors={exhausted ? [colors.danger, colors.danger] : [colors.primaryBright, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
            <Crown color={colors.onPrimary} size={18} strokeWidth={2.2} />
          </LinearGradient>
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>
              {exhausted ? t("tariff.exhausted") : preview?.planName ?? t("tariff.title")}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {limit > 0
                ? exhausted ? t("tariff.madeAll", { limit }) : t("tariff.left", { count: left ?? 0 })
                : t("tariff.unlimited")}
            </Text>
          </View>
          {limit > 0 ? <Text style={[styles.count, { color: tone }]}>{used}<Text style={styles.countOf}> / {limit}</Text></Text> : null}
        </View>

        {limit > 0 ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(fill * 100, used > 0 ? 4 : 0)}%`, backgroundColor: tone }]} />
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.reset} numberOfLines={1}>{resets ? t("tariff.resets", { date: resets }) : " "}</Text>
          {canRestart ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("tariff.restart")}
              disabled={opening}
              onPress={() => restart(preview)}
              style={({ pressed }) => [styles.restart, exhausted && styles.restartStrong, pressed && styles.pressed]}
            >
              {opening
                ? <ActivityIndicator size="small" color={exhausted ? colors.onPrimary : colors.primary} />
                : <RotateCcw color={exhausted ? colors.onPrimary : colors.primary} size={14} strokeWidth={2.4} />}
              <Text style={[styles.restartText, exhausted && styles.restartTextStrong]}>{t("tariff.restartConfirm")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

const useStyles = makeStyles((colors) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: 0 },
  badge: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.bodyMedium, fontFamily: "Manrope_700Bold", color: colors.ink },
  detail: { ...typography.caption, color: colors.inkMuted, marginTop: 1 },
  count: { fontFamily: "Manrope_700Bold", fontSize: 22, lineHeight: 26, letterSpacing: -0.4 },
  countOf: { fontSize: 14, color: colors.inkSoft },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  reset: { ...typography.caption, color: colors.inkSoft, flex: 1 },
  restart: {
    flexDirection: "row", alignItems: "center", gap: 6, height: 34, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  restartStrong: { backgroundColor: colors.primary },
  restartText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  restartTextStrong: { color: colors.onPrimary },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
}));

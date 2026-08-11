import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, CreditCard, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";

import { PaymentUnavailable } from "@/components/PaymentUnavailable";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { formatSom } from "@/lib/money";
import {
  OrderPaymentError, orderStatus, payStart, payVerify, type Order,
} from "@/lib/orders";
import { useAccount } from "@/providers/AccountProvider";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

const PURPOSE_LABELS: Record<string, string> = {
  subscription: "Tarif",
  jcoin: "J Coin",
  data_collection: "Ma’lumotlarni yig‘ish moduli",
  marketplace_presentation: "Taqdimot",
  marketplace_reference: "Referat",
  marketplace_independent_work: "Mustaqil ish",
  marketplace_game: "O‘yin",
  other_marketplace_product: "Material",
};

/** Where a paid order sends you. */
const DESTINATIONS: Record<string, { label: string; path: string }> = {
  jcoin: { label: "Hamyonni ochish", path: "/(app)/(tabs)/profile" },
  subscription: { label: "Profilga o‘tish", path: "/(app)/(tabs)/profile" },
  data_collection: { label: "Modulni ochish", path: "/(app)/survey" },
};

function groupDigits(value: string): string {
  return (value.match(/.{1,4}/g) ?? [value]).join(" ");
}

/**
 * Paying an order — any order.
 *
 * One screen for a tariff, a coin package, module access and a marketplace
 * material, because the order engine made them the same shape. The price shown
 * is the one the server wrote when the order was opened; this screen has no way
 * to change it and never sends an amount.
 *
 * The card number lives in this component's memory for exactly one request and
 * is wiped the moment the provider has been handed it. There is no saved token
 * to reuse: every payment is a fresh card, a fresh code and a fresh receipt.
 *
 * "Payment successful" here is the *server's* word, not this screen's. The
 * success state is only ever reached from a response that says the order is
 * paid — which the server writes only after the provider confirms the receipt.
 */
export default function OrderCheckoutScreen() {
  const router = useRouter();
  const policy = usePaymentPolicy();
  const { refresh: refreshWallet } = useAccount();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : "";

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<"card" | "otp" | "done">("card");
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [code, setCode] = useState("");
  const [maskedCard, setMaskedCard] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    if (!orderId) { setLoadError("Buyurtma topilmadi."); setLoading(false); return; }
    try {
      const row = await orderStatus(orderId);
      if (!row) { setLoadError("Buyurtma topilmadi."); return; }
      setOrder(row);
      // The recovery path: an app closed mid-payment reopens and asks the server
      // what happened rather than assuming. A paid order is not charged again.
      if (row.status === "paid") setStep("done");
      setLoadError(null);
    } catch {
      setLoadError("Buyurtma yuklanmadi.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const panDigits = pan.replace(/[^0-9]/g, "");
  const expiryDigits = expiry.replace(/[^0-9]/g, "");
  const canSubmitCard = panDigits.length >= 16 && expiryDigits.length === 4 && !busy;

  async function submitCard() {
    // The lock is a ref rather than state: a second tap must be refused in the
    // same frame, before React has re-rendered anything.
    if (submitting.current || !canSubmitCard) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const started = await payStart(orderId, panDigits, expiry);
      setMaskedCard(started.maskedCard);
      setSandbox(started.sandbox);
      setStep("otp");
      setResendIn(RESEND_SECONDS);
      // The number has been handed over. It has no further use here.
      setPan("");
      setExpiry("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov boshlanmadi.");
      if (failure instanceof OrderPaymentError && !failure.recoverable) await load();
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCode() {
    if (submitting.current || code.length < 4 || busy) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await payVerify(orderId, code);
      if (result.status !== "paid") throw new Error("To‘lov tasdiqlanmadi.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("done");
      await Promise.all([load(), refreshWallet()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov amalga oshmadi.");
      setCode("");
      if (failure instanceof OrderPaymentError && !failure.recoverable) {
        // The order is closed. Back to the card step is pointless; reload so the
        // screen shows what actually happened.
        await load();
        setStep("card");
      }
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  if (!policy.loading && !policy.paymentsEnabled) {
    return (
      <PaymentUnavailable
        title={policy.unavailableMessage("marketplace")}
        onLeave={() => router.back()}
      />
    );
  }

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered]}><ActivityIndicator color={colors.primary} size="large" /></View>
    );
  }
  if (loadError || !order) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="To‘lov" variant="close" onLeave={() => router.back()} />
        <ErrorState message={loadError ?? "Buyurtma topilmadi."} onRetry={() => void load()} />
      </View>
    );
  }

  const closed = ["failed", "cancelled", "expired"].includes(order.status);
  const destination = DESTINATIONS[order.purpose] ?? { label: "Kutubxonaga o‘tish", path: "/(app)/marketplace/library" };

  /* ------------------------------------------------------------------ done */
  if (step === "done") {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="To‘lov" variant="close" onLeave={() => router.replace(destination.path)} />
        <View style={styles.successWrap}>
          <CheckCircle2 color={colors.success} size={64} strokeWidth={2} />
          <Text style={styles.successTitle}>To‘lov muvaffaqiyatli</Text>
          <Text style={styles.orderNumber}>{order.order_number}</Text>
          <Text style={styles.successAmount}>{formatSom(order.total_amount)}</Text>
          {maskedCard ? <Text style={styles.cardHint}>{maskedCard}</Text> : null}
          <PrimaryButton label={destination.label} onPress={() => router.replace(destination.path)} />
          <Pressable onPress={() => router.replace("/(app)/orders")}>
            <Text style={styles.linkText}>To‘lovlar tarixi</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader
        title={step === "otp" ? "Tasdiqlash" : "To‘lov"}
        variant="close"
        onLeave={() => (step === "otp" ? setStep("card") : router.back())}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The server's figures, shown in full so the total is never a surprise
            at the last tap. Nothing here recomputes them. */}
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>
            {(order.metadata as { title?: string; label?: string } | null)?.title
              ?? (order.metadata as { label?: string } | null)?.label
              ?? PURPOSE_LABELS[order.purpose] ?? "Xarid"}
          </Text>
          <Text style={styles.summaryKind}>{PURPOSE_LABELS[order.purpose] ?? order.purpose}</Text>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>Mahsulot</Text>
            <Text style={styles.lineValue}>{formatSom(order.subtotal)}</Text>
          </View>
          {order.buyer_fee > 0 ? (
            <View style={styles.line}>
              <Text style={styles.lineLabel}>Xizmat haqi ({order.buyer_fee_rate}%)</Text>
              <Text style={styles.lineValue}>{formatSom(order.buyer_fee)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.line}>
            <Text style={styles.totalLabel}>To‘lanadi</Text>
            <Text style={styles.total}>{formatSom(order.total_amount)}</Text>
          </View>
          <Text style={styles.snapshotNote}>
            {order.order_number} · narx xarid boshlanganda qayd etilgan va o‘zgarmaydi.
          </Text>
        </View>

        {closed ? (
          <>
            <InlineError message={order.failure_message ?? "Bu buyurtma yopilgan."} />
            <PrimaryButton label="Ortga" tone="secondary" onPress={() => router.back()} />
          </>
        ) : step === "card" ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Karta raqami</Text>
              <TextInput
                style={styles.input}
                value={groupDigits(panDigits)}
                onChangeText={(value) => setPan(value.replace(/[^0-9]/g, "").slice(0, 19))}
                keyboardType="number-pad"
                placeholder="8600 0000 0000 0000"
                placeholderTextColor={colors.inkSoft}
                autoComplete="off"
                textContentType="none"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Amal qilish muddati</Text>
              <TextInput
                style={styles.input}
                value={expiryDigits.length > 2 ? `${expiryDigits.slice(0, 2)}/${expiryDigits.slice(2)}` : expiryDigits}
                onChangeText={(value) => setExpiry(value.replace(/[^0-9]/g, "").slice(0, 4))}
                keyboardType="number-pad"
                placeholder="MM/YY"
                placeholderTextColor={colors.inkSoft}
              />
            </View>

            <View style={styles.assurance}>
              <ShieldCheck color={colors.success} size={18} strokeWidth={2} />
              <Text style={styles.assuranceText}>
                Karta raqami to‘lov tizimiga to‘g‘ridan-to‘g‘ri uzatiladi va Jaxongirman serverida saqlanmaydi.
              </Text>
            </View>

            {error ? <InlineError message={error} /> : null}

            <PrimaryButton
              label={busy ? "TO‘LOV AMALGA OSHIRILMOQDA..." : `${formatSom(order.total_amount)} to‘lash`}
              icon={CreditCard}
              loading={busy}
              disabled={!canSubmitCard}
              onPress={() => void submitCard()}
            />
          </>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Tasdiqlash kodi</Text>
              <Text style={styles.hint}>
                {maskedCard ? `${maskedCard} — ` : ""}kartaga bog‘langan raqamga SMS yuborildi.
              </Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, OTP_LENGTH))}
                keyboardType="number-pad"
                placeholder="——————"
                placeholderTextColor={colors.inkSoft}
                autoFocus
              />
              {sandbox ? <Text style={styles.hint}>Sinov rejimi: kod 111111.</Text> : null}
            </View>

            {error ? <InlineError message={error} /> : null}

            <PrimaryButton
              label={busy ? "Tasdiqlanmoqda..." : "TASDIQLASH"}
              loading={busy}
              disabled={code.length < 4 || busy}
              onPress={() => void submitCode()}
            />

            <Pressable
              disabled={resendIn > 0 || busy}
              onPress={() => { setStep("card"); setCode(""); setError(null); }}
            >
              <Text style={[styles.linkText, resendIn > 0 && styles.linkDisabled]}>
                {resendIn > 0 ? `Kod kelmadimi? ${resendIn}s` : "Kod kelmadimi? Kartani qayta kiriting"}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
  summary: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, ...shadow,
  },
  summaryTitle: { ...typography.heading, color: colors.ink },
  summaryKind: { ...typography.caption, color: colors.accent },
  line: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  lineLabel: { ...typography.body, color: colors.inkMuted },
  lineValue: { ...typography.body, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.border },
  totalLabel: { ...typography.bodyMedium, color: colors.ink },
  total: { ...typography.heading, color: colors.primaryDeep },
  snapshotNote: { ...typography.caption, color: colors.inkSoft },
  field: { gap: spacing.sm },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  input: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  codeInput: { ...typography.title, letterSpacing: 8, textAlign: "center" },
  assurance: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    backgroundColor: colors.successSoft, borderRadius: radius.md, padding: spacing.md,
  },
  assuranceText: { ...typography.caption, color: colors.success, flex: 1, lineHeight: 17 },
  linkText: { ...typography.body, color: colors.primary, textAlign: "center" },
  linkDisabled: { color: colors.inkSoft },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  successTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  orderNumber: { ...typography.caption, color: colors.inkMuted },
  successAmount: { ...typography.display, color: colors.primaryDeep },
  cardHint: { ...typography.caption, color: colors.inkSoft },
});

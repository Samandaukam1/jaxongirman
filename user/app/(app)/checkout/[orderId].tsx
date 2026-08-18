import type { Tables } from "@jaxongirman/types";
import {
  cardDigits,
  formatCardExpiryInput,
  formatCardPan,
  formatStoredCardExpiry,
  isPartialCardDisplayPan,
  isStoredCardExpired,
  reconstructPartialCardPan,
  validateCardExpiry,
} from "@jaxongirman/types";
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
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { usePaymentPolicy } from "@/providers/PaymentPolicyProvider";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

type PartialCard = Tables<"partial_cards">;

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
  const [cards, setCards] = useState<PartialCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);

  const [step, setStep] = useState<"card" | "otp" | "done">("card");
  const [pan, setPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [missingDigits, setMissingDigits] = useState("");
  const [code, setCode] = useState("");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [maskedCard, setMaskedCard] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const submitting = useRef(false);

  const load = useCallback(async () => {
    if (!orderId) { setLoadError("Buyurtma topilmadi."); setLoading(false); return; }
    try {
      const [row, cardsResult] = await Promise.all([
        orderStatus(orderId),
        supabase
          .from("partial_cards")
          .select("id,user_id,display_pan,last4,expiry_month,expiry_year,is_active,created_at,last_used_at")
          .eq("is_active", true)
          .order("last_used_at", { ascending: false, nullsFirst: false }),
      ]);
      if (!row) { setLoadError("Buyurtma topilmadi."); return; }
      setOrder(row);
      if (cardsResult.error) {
        setCards([]);
        setCardsError("Chala kartalar yuklanmadi. Yangi kartani kiritishingiz mumkin.");
      } else {
        setCards(cardsResult.data ?? []);
        setCardsError(null);
      }
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

  const selectedCard = selectedCardId ? cards.find((card) => card.id === selectedCardId) ?? null : null;
  const panDigits = cardDigits(pan);
  const expiryValidation = validateCardExpiry(
    selectedCard ? formatStoredCardExpiry(selectedCard.expiry_month, selectedCard.expiry_year) : expiry,
  );
  const selectedCardReady = Boolean(
    selectedCard
      && isPartialCardDisplayPan(selectedCard.display_pan)
      && !isStoredCardExpired(selectedCard.expiry_month, selectedCard.expiry_year)
      && cardDigits(missingDigits).length === 4,
  );
  const canSubmitCard = !busy && (selectedCard ? selectedCardReady : panDigits.length === 16 && expiryValidation.valid);

  function selectCard(card: PartialCard) {
    if (isStoredCardExpired(card.expiry_month, card.expiry_year)) return;
    const same = selectedCardId === card.id;
    setSelectedCardId(same ? null : card.id);
    setMissingDigits("");
    setPan("");
    setExpiry("");
    setError(null);
  }

  async function submitCard() {
    // The lock is a ref rather than state: a second tap must be refused in the
    // same frame, before React has re-rendered anything.
    if (submitting.current || !canSubmitCard) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const paymentPan = selectedCard
        ? reconstructPartialCardPan(selectedCard.display_pan, missingDigits)
        : panDigits.length === 16 ? panDigits : null;
      const paymentExpiry = expiryValidation.valid ? expiryValidation.normalized : null;
      if (!paymentPan || !paymentExpiry) {
        setError("Karta ma’lumotlarini tekshirib, qayta kiriting.");
        return;
      }

      // Start the request, then immediately drop every reconstructable card
      // fragment from component state. The local `paymentPan` survives only in
      // this in-flight request and is never used to render another frame.
      const startRequest = payStart(orderId, paymentPan, paymentExpiry);
      setPan("");
      setExpiry("");
      setMissingDigits("");
      setSelectedCardId(null);

      const started = await startRequest;
      /**
       * Two answers that are not an attempt id, and only one is a failure.
       *
       * An order already paid comes back saying so — an app reopened after a
       * dropped connection asking about a finished purchase is normal, and
       * reporting it as "the attempt did not open" sends somebody to support
       * about a payment that went through.
       */
      if ((started as { alreadyPaid?: boolean }).alreadyPaid) {
        setStep("done");
        await load();
        return;
      }
      if (!started.attemptId) {
        throw new Error(
          "To‘lov urinishi ochilmadi. Agar SMS kelgan bo‘lsa, «To‘lash» tugmasini qayta bosing — kod saqlanib qoladi.",
        );
      }
      setAttemptId(started.attemptId);
      setMaskedCard(started.maskedCard);
      setSandbox(started.sandbox);
      setStep("otp");
      setResendIn(RESEND_SECONDS);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov boshlanmadi.");
      if (failure instanceof OrderPaymentError && !failure.recoverable) await load();
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }

  async function submitCode() {
    if (submitting.current || !attemptId || code.length < 4 || busy) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // The SMS code is equally request-local: once dispatched, keep no copy in
      // component state while the provider response is in flight.
      const verifyRequest = payVerify(orderId, attemptId, code);
      setCode("");
      const result = await verifyRequest;
      if (result.status !== "paid") throw new Error("To‘lov tasdiqlanmadi.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAttemptId(null);
      setStep("done");
      await Promise.all([load(), refreshWallet()]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "To‘lov amalga oshmadi.");
      if (failure instanceof OrderPaymentError) {
        // `verify` atomically consumes its one-time provider token, including
        // when the code was mistyped. A retry therefore starts from card entry;
        // staying on the OTP field would offer a second verify that cannot work.
        setAttemptId(null);
        setStep("card");
      }
      if (failure instanceof OrderPaymentError && !failure.recoverable) {
        // The order is closed. Back to the card step is pointless; reload so the
        // screen shows what actually happened.
        await load();
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
        onLeave={() => {
          if (step !== "otp") { router.back(); return; }
          setCode("");
          setAttemptId(null);
          setError(null);
          setStep("card");
        }}
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
              {selectedCard ? (
                <>
                  <Text style={styles.hint}>Yetishmayotgan 4 ta raqamni kiriting</Text>
                  <View style={styles.panRow}>
                    <Text style={styles.panPart}>{formatCardPan(selectedCard.display_pan.slice(0, 8))}</Text>
                    <TextInput
                      value={missingDigits}
                      onChangeText={(value) => setMissingDigits(cardDigits(value).slice(0, 4))}
                      keyboardType="number-pad"
                      placeholder="XXXX"
                      placeholderTextColor={colors.borderStrong}
                      style={styles.panInput}
                      accessibilityLabel="Yetishmayotgan to‘rt raqam"
                      autoComplete="off"
                      textContentType="none"
                      autoFocus
                    />
                    <Text style={styles.panPart}>{selectedCard.last4}</Text>
                  </View>
                </>
              ) : (
                <TextInput
                  style={styles.input}
                  value={formatCardPan(panDigits)}
                  onChangeText={(value) => setPan(cardDigits(value).slice(0, 16))}
                  keyboardType="number-pad"
                  placeholder="8600 0000 0000 0000"
                  placeholderTextColor={colors.inkSoft}
                  autoComplete="off"
                  textContentType="none"
                  accessibilityLabel="Karta raqami"
                />
              )}
            </View>

            {cardsError ? <Text style={styles.cardsError}>{cardsError}</Text> : null}
            {cards.length > 0 ? (
              <View style={styles.cardsBlock}>
                <Text style={styles.cardsTitle}>Chala kartalardan</Text>
                {cards.map((card) => {
                  const active = selectedCard?.id === card.id;
                  const expired = isStoredCardExpired(card.expiry_month, card.expiry_year);
                  return (
                    <Pressable
                      key={card.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active, disabled: expired }}
                      accessibilityLabel={`${formatCardPan(card.display_pan)}, ${formatStoredCardExpiry(card.expiry_month, card.expiry_year)}`}
                      disabled={expired || busy}
                      onPress={() => selectCard(card)}
                      style={({ pressed }) => [
                        styles.savedCard,
                        active && styles.savedCardActive,
                        expired && styles.savedCardExpired,
                        pressed && !expired && styles.savedCardPressed,
                      ]}
                    >
                      <CreditCard color={active ? colors.primary : colors.inkSoft} size={19} strokeWidth={2} />
                      <View style={styles.savedCardCopy}>
                        <Text style={styles.savedCardPan}>{formatCardPan(card.display_pan)}</Text>
                        <Text style={[styles.savedCardExpiry, expired && styles.savedCardExpiryExpired]}>
                          {formatStoredCardExpiry(card.expiry_month, card.expiry_year)}
                          {expired ? " · muddati tugagan" : ""}
                        </Text>
                      </View>
                      {active ? <CheckCircle2 color={colors.primary} size={19} strokeWidth={2.2} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.field}>
              <Text style={styles.label}>Amal qilish muddati</Text>
              {selectedCard ? (
                <View style={styles.readOnlyExpiry}>
                  <Text style={styles.readOnlyExpiryText}>
                    {formatStoredCardExpiry(selectedCard.expiry_month, selectedCard.expiry_year)}
                  </Text>
                </View>
              ) : (
                <TextInput
                  style={styles.input}
                  value={formatCardExpiryInput(expiry)}
                  onChangeText={(value) => setExpiry(formatCardExpiryInput(value))}
                  keyboardType="number-pad"
                  placeholder="MM/YY"
                  placeholderTextColor={colors.inkSoft}
                  accessibilityLabel="Amal qilish muddati"
                />
              )}
              {!selectedCard && cardDigits(expiry).length === 4 && !expiryValidation.valid ? (
                <Text style={styles.validationError}>
                  {expiryValidation.error === "invalid_month"
                    ? "Oy 01–12 oralig‘ida bo‘lsin."
                    : "Kartaning amal qilish muddati tugagan."}
                </Text>
              ) : null}
            </View>

            <View style={styles.assurance}>
              <ShieldCheck color={colors.success} size={18} strokeWidth={2} />
              <View style={styles.assuranceCopy}>
                <Text style={styles.assuranceText}>
                  Karta raqami Payme’ga to‘lov uchun uzatiladi va Jaxongirman bazasida saqlanmaydi.
                </Text>
                <Text style={styles.paymeBrand}>Powered by Payme</Text>
              </View>
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
              disabled={!attemptId || code.length < 4 || busy}
              onPress={() => void submitCode()}
            />

            <Pressable
              disabled={resendIn > 0 || busy}
              onPress={() => {
                setStep("card");
                setAttemptId(null);
                setCode("");
                setError(null);
              }}
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
  validationError: { ...typography.caption, color: colors.danger },
  input: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  panRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    minHeight: 54, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  panPart: { ...typography.bodyMedium, color: colors.ink, fontSize: 16, letterSpacing: 1 },
  panInput: {
    minWidth: 66, paddingVertical: spacing.sm, textAlign: "center",
    borderBottomWidth: 2, borderBottomColor: colors.primary,
    fontFamily: "Manrope_700Bold", fontSize: 17, letterSpacing: 2.5, color: colors.primary,
  },
  cardsBlock: { gap: spacing.sm },
  cardsTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  cardsError: { ...typography.caption, color: colors.warning },
  savedCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  savedCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  savedCardExpired: { opacity: 0.52 },
  savedCardPressed: { opacity: 0.82 },
  savedCardCopy: { flex: 1, gap: 2 },
  savedCardPan: { ...typography.bodyMedium, color: colors.ink, fontSize: 14, letterSpacing: 0.8 },
  savedCardExpiry: { ...typography.caption, color: colors.inkSoft },
  savedCardExpiryExpired: { color: colors.danger },
  readOnlyExpiry: {
    minHeight: 50, justifyContent: "center", paddingHorizontal: spacing.lg,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  readOnlyExpiryText: { ...typography.body, color: colors.ink },
  codeInput: { ...typography.title, letterSpacing: 8, textAlign: "center" },
  assurance: {
    flexDirection: "row", gap: spacing.sm, alignItems: "flex-start",
    backgroundColor: colors.successSoft, borderRadius: radius.md, padding: spacing.md,
  },
  assuranceCopy: { flex: 1, gap: 4 },
  assuranceText: { ...typography.caption, color: colors.success, lineHeight: 17 },
  paymeBrand: { ...typography.caption, color: colors.primaryDeep, fontFamily: "Manrope_700Bold" },
  linkText: { ...typography.body, color: colors.primary, textAlign: "center" },
  linkDisabled: { color: colors.inkSoft },
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  successTitle: { ...typography.title, color: colors.ink, textAlign: "center" },
  orderNumber: { ...typography.caption, color: colors.inkMuted },
  successAmount: { ...typography.display, color: colors.primaryDeep },
  cardHint: { ...typography.caption, color: colors.inkSoft },
});

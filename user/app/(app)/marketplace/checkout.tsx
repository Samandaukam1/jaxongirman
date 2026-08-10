import type { Tables } from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, CreditCard, Info, Plus, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, InlineError } from "@/components/StateBlocks";
import { asFunctionErrorMessage } from "@/lib/format";
import { formatSom } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

type Transaction = Tables<"payment_transactions">;
type PartialCard = Tables<"partial_cards">;
type PaymentConfig = { provider: string | null; configured: boolean };

/** What `start` returned, held for the `verify` call and nothing longer. */
type Attempt = { first8: string; last4: string; expiry: string; sandbox: boolean };

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

function groupDigits(value: string): string {
  return (value.match(/.{1,4}/g) ?? [value]).join(" ");
}

/**
 * The payment step, including "chala kartalar".
 *
 * The rule this screen exists to honour: a card the person has used before is
 * remembered as `5614 8540 XXXX 2121` and nothing more. To pay again they
 * re-type the four hidden digits, the full number is assembled in this
 * component's memory for exactly one request, and it is wiped the moment the
 * provider has been handed it. There is no saved token to reuse — every payment
 * is a fresh card, a fresh code and a fresh receipt.
 */
export default function CheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ transactionId?: string }>();
  const transactionId = typeof params.transactionId === "string" ? params.transactionId : "";

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [productTitle, setProductTitle] = useState("");
  const [cards, setCards] = useState<PartialCard[]>([]);
  const [payments, setPayments] = useState<PaymentConfig>({ provider: null, configured: false });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<"card" | "otp" | "done">("card");
  const [selectedCard, setSelectedCard] = useState<PartialCard | null>(null);
  const [missingDigits, setMissingDigits] = useState("");
  const [newPan, setNewPan] = useState("");
  const [expiry, setExpiry] = useState("");
  const [code, setCode] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const codeInput = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (!transactionId) { setLoadError("To‘lov topilmadi."); setLoading(false); return; }
    setLoading(true);
    const [transactionResult, cardsResult, settingsResult] = await Promise.all([
      supabase.from("payment_transactions").select("*").eq("id", transactionId).single(),
      supabase.from("partial_cards").select("*").eq("is_active", true).order("last_used_at", { ascending: false, nullsFirst: false }),
      supabase.from("app_settings").select("value").eq("key", "payments.config").maybeSingle(),
    ]);
    if (transactionResult.error) { setLoadError(transactionResult.error.message); setLoading(false); return; }

    setTransaction(transactionResult.data);
    if (transactionResult.data.state === "paid") setStep("done");
    setCards(cardsResult.data ?? []);
    const value = settingsResult.data?.value as PaymentConfig | null;
    setPayments({ provider: value?.provider ?? null, configured: Boolean(value?.configured) });

    const { data: product } = await supabase
      .from("marketplace_products").select("title").eq("id", transactionResult.data.product_id).maybeSingle();
    setProductTitle(product?.title ?? "");
    setLoadError(null);
    setLoading(false);
  }, [transactionId]);

  useEffect(() => { void load(); }, [load]);

  // The resend timer only exists while a code is outstanding.
  useEffect(() => {
    if (step !== "otp" || cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(value - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [cooldown, step]);

  /**
   * The full number, assembled here and nowhere else.
   *
   * Returned rather than stored: it exists as a local for the length of one
   * call and is never written to state, storage or a log.
   */
  function reconstructPan(): string {
    if (selectedCard) return `${selectedCard.display_pan.slice(0, 8)}${missingDigits}${selectedCard.last4}`;
    return newPan.replace(/[^0-9]/g, "");
  }

  const cardExpiry = selectedCard
    ? `${String(selectedCard.expiry_month).padStart(2, "0")}/${String(selectedCard.expiry_year).padStart(2, "0")}`
    : expiry;

  const cardReady = selectedCard
    ? missingDigits.length === 4
    : newPan.replace(/[^0-9]/g, "").length >= 16 && expiry.replace(/[^0-9]/g, "").length === 4;

  async function startPayment() {
    setBusy(true);
    setError(null);
    try {
      const { data, error: startError } = await supabase.functions.invoke("pay-marketplace", {
        body: { transactionId, step: "start", pan: reconstructPan(), expiry: cardExpiry },
      });
      if (startError) throw startError;
      const result = data as { first8: string; last4: string; sandbox: boolean };

      // The number has been handed over. Everything that could rebuild it is
      // dropped now, before the next screen renders.
      setNewPan("");
      setMissingDigits("");
      setAttempt({ first8: result.first8, last4: result.last4, expiry: cardExpiry, sandbox: result.sandbox });
      setStep("otp");
      setCooldown(RESEND_SECONDS);
      setTimeout(() => codeInput.current?.focus(), 250);
    } catch (nextError) {
      setError(await asFunctionErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: verifyError } = await supabase.functions.invoke("pay-marketplace", {
        body: {
          transactionId, step: "verify", code,
          first8: attempt.first8, last4: attempt.last4, expiry: attempt.expiry,
        },
      });
      if (verifyError) throw verifyError;
      const result = data as { state: string };
      if (result.state !== "paid") throw new Error("To‘lov yakunlanmadi.");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAttempt(null);
      setCode("");
      setStep("done");
      void load();
    } catch (nextError) {
      setError(await asFunctionErrorMessage(nextError));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="To‘lov" />
        <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>
      </View>
    );
  }

  if (loadError || !transaction) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="To‘lov" />
        <View style={styles.content}><ErrorState message={loadError ?? "To‘lov topilmadi"} onRetry={() => void load()} /></View>
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
        <View style={styles.summary}>
          <Text style={styles.summaryTitle} numberOfLines={2}>{productTitle}</Text>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>Mahsulot</Text>
            <Text style={styles.lineValue}>{formatSom(transaction.base_price)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.lineLabel}>Xizmat haqi ({transaction.buyer_fee_rate}%)</Text>
            <Text style={styles.lineValue}>{formatSom(transaction.buyer_fee_amount)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.line}>
            <Text style={styles.totalLabel}>To‘lanadi</Text>
            <Text style={styles.total}>{formatSom(transaction.buyer_total)}</Text>
          </View>
          <Text style={styles.snapshotNote}>Narx xarid boshlanganda qayd etilgan va o‘zgarmaydi.</Text>
        </View>

        {/* --------------------------------------------------------- done */}
        {step === "done" ? (
          <>
            <View style={[styles.notice, styles.noticeReady]}>
              <CheckCircle2 color={colors.success} size={20} strokeWidth={2} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>To‘lov qabul qilindi</Text>
                <Text style={styles.noticeBody}>Mahsulot kutubxonangizga qo‘shildi.</Text>
              </View>
            </View>
            <PrimaryButton label="Kutubxonaga o‘tish" onPress={() => router.replace("/(app)/marketplace/library")} />
          </>
        ) : null}

        {/* ---------------------------------------------------- OTP step */}
        {step === "otp" ? (
          <View style={styles.otpBlock}>
            <Text style={styles.otpTitle}>Tasdiqlash kodi</Text>
            <Text style={styles.otpCopy}>
              {attempt ? `•••• ${attempt.last4}` : ""} kartasiga biriktirilgan raqamga {OTP_LENGTH} xonali kod yuborildi.
            </Text>

            <TextInput
              ref={codeInput}
              value={code}
              onChangeText={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, OTP_LENGTH))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              placeholder="000000"
              placeholderTextColor={colors.inkSoft}
              style={styles.otpInput}
              accessibilityLabel="Tasdiqlash kodi"
            />

            {attempt?.sandbox ? (
              <View style={styles.sandboxHint}>
                <Text style={styles.sandboxText}>Sinov rejimi: tasdiqlash kodi 111111</Text>
              </View>
            ) : null}

            {error ? <InlineError message={error} /> : null}

            <PrimaryButton
              label="Tasdiqlash"
              loading={busy}
              disabled={code.length < OTP_LENGTH}
              onPress={() => void confirmCode()}
            />

            <Pressable
              accessibilityRole="button"
              disabled={cooldown > 0 || busy}
              onPress={() => void startPayment()}
              style={styles.resend}
            >
              <Text style={[styles.resendText, cooldown > 0 && styles.resendDisabled]}>
                {cooldown > 0 ? `Kodni qayta yuborish — ${cooldown}s` : "Kodni qayta yuborish"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* --------------------------------------------------- card step */}
        {step === "card" ? (
          payments.configured || __DEV__ ? (
            <>
              {cards.length > 0 ? (
                <View style={styles.cardsBlock}>
                  <Text style={styles.blockLabel}>Chala kartalardan</Text>
                  {cards.map((card) => {
                    const active = selectedCard?.id === card.id;
                    return (
                      <Pressable
                        key={card.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => { setSelectedCard(active ? null : card); setMissingDigits(""); setError(null); }}
                        style={[styles.cardRow, active && styles.cardRowActive]}
                      >
                        <CreditCard color={active ? colors.primary : colors.inkSoft} size={18} strokeWidth={2} />
                        <View style={styles.cardCopy}>
                          <Text style={styles.cardPan}>•••• {card.last4}</Text>
                          <Text style={styles.cardExpiry}>
                            {String(card.expiry_month).padStart(2, "0")}/{String(card.expiry_year).padStart(2, "0")}
                          </Text>
                        </View>
                        {active ? <CheckCircle2 color={colors.primary} size={18} strokeWidth={2} /> : null}
                      </Pressable>
                    );
                  })}

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => { setSelectedCard(null); setMissingDigits(""); setError(null); }}
                    style={[styles.cardRow, selectedCard === null && styles.cardRowActive]}
                  >
                    <Plus color={selectedCard === null ? colors.primary : colors.inkSoft} size={18} strokeWidth={2} />
                    <Text style={styles.cardCopy}>Yangi karta</Text>
                  </Pressable>
                </View>
              ) : null}

              {selectedCard ? (
                <View style={styles.panBlock}>
                  <Text style={styles.blockLabel}>Yetishmayotgan 4 ta raqamni kiriting</Text>
                  <View style={styles.panRow}>
                    <Text style={styles.panPart}>{groupDigits(selectedCard.display_pan.slice(0, 8))}</Text>
                    <TextInput
                      value={missingDigits}
                      onChangeText={(value) => setMissingDigits(value.replace(/[^0-9]/g, "").slice(0, 4))}
                      keyboardType="number-pad"
                      placeholder="XXXX"
                      placeholderTextColor={colors.borderStrong}
                      style={styles.panInput}
                      accessibilityLabel="Yetishmayotgan to‘rt raqam"
                      autoFocus
                    />
                    <Text style={styles.panPart}>{selectedCard.last4}</Text>
                  </View>
                  <Text style={styles.panExpiry}>
                    {String(selectedCard.expiry_month).padStart(2, "0")}/{String(selectedCard.expiry_year).padStart(2, "0")}
                  </Text>
                </View>
              ) : (
                <View style={styles.panBlock}>
                  <Text style={styles.blockLabel}>Karta raqami</Text>
                  <TextInput
                    value={groupDigits(newPan.replace(/[^0-9]/g, ""))}
                    onChangeText={(value) => setNewPan(value.replace(/[^0-9]/g, "").slice(0, 19))}
                    keyboardType="number-pad"
                    placeholder="8600 0000 0000 0000"
                    placeholderTextColor={colors.inkSoft}
                    style={styles.input}
                    accessibilityLabel="Karta raqami"
                  />
                  <TextInput
                    value={expiry}
                    onChangeText={(value) => {
                      const digits = value.replace(/[^0-9]/g, "").slice(0, 4);
                      setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
                    }}
                    keyboardType="number-pad"
                    placeholder="MM/YY"
                    placeholderTextColor={colors.inkSoft}
                    style={styles.input}
                    accessibilityLabel="Amal qilish muddati"
                  />
                </View>
              )}

              {error ? <InlineError message={error} /> : null}

              <PrimaryButton
                label={`${formatSom(transaction.buyer_total)} to‘lash`}
                loading={busy}
                disabled={!cardReady}
                onPress={() => void startPayment()}
              />
            </>
          ) : (
            <View style={[styles.notice, styles.noticePending]}>
              <Info color={colors.warning} size={18} strokeWidth={2} />
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>To‘lov tizimi hali ulanmagan</Text>
                <Text style={styles.noticeBody}>
                  Xarid buyurtmasi saqlandi, lekin hozircha ilova orqali to‘lov qabul qilinmaydi.
                  To‘lov provayderi ulangach shu sahifadan yakunlashingiz mumkin bo‘ladi.
                </Text>
              </View>
            </View>
          )
        ) : null}

        <View style={styles.privacy}>
          <ShieldCheck color={colors.inkSoft} size={14} strokeWidth={2} />
          <Text style={styles.privacyText}>
            Karta raqamingiz Jaxongirman serverida saqlanmaydi. Keyingi xaridlar uchun faqat
            niqoblangan ko‘rinish — 5614 8540 XXXX 2121 — eslab qolinadi. Kod va CVV saqlanmaydi.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },

  summary: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadow },
  summaryTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 16, marginBottom: spacing.sm },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lineLabel: { ...typography.caption, color: colors.inkMuted },
  lineValue: { ...typography.caption, color: colors.ink },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
  totalLabel: { ...typography.bodyMedium, color: colors.ink },
  total: { ...typography.heading, color: colors.primaryDeep },
  snapshotNote: { ...typography.caption, fontSize: 11, color: colors.inkSoft, marginTop: 4 },

  notice: { flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  noticeReady: { backgroundColor: colors.successSoft, borderColor: "#BEE7DA" },
  noticePending: { backgroundColor: "#FDF4E5", borderColor: "#F0DFC0" },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  noticeBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },

  cardsBlock: { gap: spacing.sm },
  blockLabel: { ...typography.caption, color: colors.inkMuted, letterSpacing: 0.6, textTransform: "uppercase" },
  cardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cardCopy: { flex: 1 },
  cardPan: { ...typography.bodyMedium, color: colors.ink, fontSize: 15, letterSpacing: 1 },
  cardExpiry: { ...typography.caption, color: colors.inkSoft },

  panBlock: { gap: spacing.sm },
  panRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  panPart: { fontFamily: "Manrope_600SemiBold", fontSize: 17, color: colors.ink, letterSpacing: 1.2 },
  panInput: {
    fontFamily: "Manrope_700Bold", fontSize: 17, color: colors.primary, letterSpacing: 3,
    minWidth: 68, textAlign: "center", paddingVertical: 6,
    borderBottomWidth: 2, borderBottomColor: colors.primary,
  },
  panExpiry: { ...typography.caption, color: colors.inkSoft },
  input: {
    ...typography.body, color: colors.ink, minHeight: 52, letterSpacing: 1,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },

  otpBlock: { gap: spacing.md },
  otpTitle: { ...typography.heading, color: colors.ink },
  otpCopy: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  otpInput: {
    fontFamily: "Manrope_700Bold", fontSize: 30, color: colors.ink, letterSpacing: 12,
    textAlign: "center", minHeight: 68,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
  },
  sandboxHint: { padding: spacing.md, borderRadius: radius.md, backgroundColor: "#FDF4E5" },
  sandboxText: { ...typography.caption, color: colors.warning, textAlign: "center" },
  resend: { alignItems: "center", paddingVertical: spacing.md },
  resendText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  resendDisabled: { color: colors.inkSoft },

  privacy: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  privacyText: { ...typography.caption, color: colors.inkMuted, lineHeight: 18, flex: 1 },
});

import * as Crypto from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowLeft, ArrowUpRight, ChevronRight, Search, ShieldCheck, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Avatar } from "@/components/Avatar";
import { BrandSurface } from "@/components/BrandSurface";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CountUp, Rise, SuccessMark } from "@/components/SuccessMoment";
import { EmptyState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatCoins, formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { brandInk, gradients, icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Match = { id: string; full_name: string; username: string; avatar_url: string | null };

/** Long enough that a handle is typed, short enough that the list feels live. */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
/** One-tap amounts under the field; the ones a balance cannot cover are dimmed. */
const QUICK_AMOUNTS = [100, 500, 1_000, 5_000] as const;

function initialsFor(match: Match): string {
  const source = match.full_name?.trim() || match.username;
  return source.split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase() || "J";
}

/**
 * Sending tanga to another person.
 *
 * The client never touches a balance: it searches through a security-definer
 * RPC that returns four display fields, and the transfer itself is one atomic
 * server call that locks both wallets. An idempotency key is minted once per
 * confirmed amount, so a dropped response cannot become a second payment.
 */
export default function SendCoinsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { balance, refresh } = useAccount();

  const { t } = useTranslation(["wallet", "common"]);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [recipient, setRecipient] = useState<Match | null>(null);
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAmount, setSentAmount] = useState<number | null>(null);

  // Regenerated whenever the person changes what they are sending, so a retry of
  // the *same* transfer is idempotent while a genuinely new one is not.
  const idempotencyKey = useRef<string>(Crypto.randomUUID());
  useEffect(() => { idempotencyKey.current = Crypto.randomUUID(); }, [recipient, amountText]);

  const trimmedQuery = query.trim();

  const runSearch = useCallback(async (term: string) => {
    if (term.length < MIN_QUERY_LENGTH) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const { data, error: requestError } = await supabase.rpc("search_profiles_by_username", { p_query: term, p_limit: 12 });
    if (requestError) {
      setSearchError(asErrorMessage(requestError));
      setMatches([]);
    } else {
      setSearchError(null);
      setMatches((data ?? []) as Match[]);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    if (recipient) return;
    const handle = setTimeout(() => void runSearch(trimmedQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [recipient, runSearch, trimmedQuery]);

  const amount = useMemo(() => {
    const parsed = Number.parseInt(amountText.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amountText]);

  const amountProblem = amount <= 0
    ? null
    : amount > balance
      ? t("send.notEnough")
      : null;

  async function send() {
    if (!recipient || amount <= 0 || amountProblem) return;
    setSending(true);
    setError(null);
    const { data, error: transferError } = await supabase.rpc("transfer_credits", {
      p_recipient_id: recipient.id,
      p_amount: amount,
      p_note: note.trim(),
      p_idempotency_key: idempotencyKey.current,
    });
    if (transferError) {
      setError(asErrorMessage(transferError));
      setSending(false);
      return;
    }
    const result = data as unknown as { applied?: boolean; amount?: number } | null;
    // The success tap comes from the emblem, as its tick lands.
    setSentAmount(result?.amount ?? amount);
    await refresh();
    setSending(false);
  }

  if (sentAmount !== null && recipient) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title={t("send.sent")} variant="close" onLeave={() => router.back()} />
        <View style={styles.successBody}>
          <SuccessMark kind="coins" />
          <Rise order={0} style={styles.successLines}>
            <View style={styles.successAmountRow}>
              <CountUp value={sentAmount} format={formatNumber} style={styles.successAmount} />
              <Image source={coinIcon} resizeMode="contain" style={styles.successCoin} />
            </View>
            <Text style={styles.successCopy}>
              {t("send.sentTo", { name: recipient.full_name?.trim() || `@${recipient.username}` })}
            </Text>
            <Text style={styles.successBalance}>{t("send.newBalance", { balance: formatCoins(balance) })}</Text>
          </Rise>
          <Rise order={1} style={styles.successActions}>
            <PrimaryButton
              label={t("send.again")}
              tone="secondary"
              onPress={() => { setSentAmount(null); setRecipient(null); setAmountText(""); setNote(""); setQuery(""); }}
            />
            <PrimaryButton label={t("common:close")} onPress={() => router.back()} />
          </Rise>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("send.title")} subtitle={t("shop.balance", { balance: formatCoins(balance) })} />

      <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {recipient ? (
          <>
            <Text style={styles.eyebrow}>{t("send.to")}</Text>
            <View style={styles.recipientCard}>
              {/* A ring of the brand round the picture: this is the person the
                  money is about to reach, and it should look chosen. */}
              <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.recipientRing}>
                <View style={styles.recipientRingInner}>
                  <Avatar uri={recipient.avatar_url} initials={initialsFor(recipient)} size={50} />
                </View>
              </LinearGradient>
              <View style={styles.recipientCopy}>
                <Text numberOfLines={1} style={styles.recipientName}>{recipient.full_name?.trim() || t("send.user")}</Text>
                <Text numberOfLines={1} style={styles.recipientHandle}>@{recipient.username}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("send.changeLabel")}
                onPress={() => { setRecipient(null); setError(null); }}
                style={styles.changeButton}
              >
                <ArrowLeft color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} />
                <Text style={styles.changeText}>{t("send.change")}</Text>
              </Pressable>
            </View>

            {/* The figure is the screen. It sits on the brand surface in white,
                the way the balance does on Bosh sahifa, so the two read as the
                same money. */}
            <BrandSurface radius={radius.xl} style={styles.amountCard}>
              <View style={styles.amountTop}>
                <Text style={styles.amountEyebrow}>{t("send.howMuch")}</Text>
                <View style={styles.balancePill}>
                  <Image source={coinIcon} resizeMode="contain" style={styles.balancePillCoin} />
                  <Text style={styles.balancePillText} numberOfLines={1}>{formatNumber(balance)}</Text>
                </View>
              </View>
              <View style={styles.amountRow}>
                <Image source={coinIcon} resizeMode="contain" style={styles.amountCoin} />
                <TextInput
                  value={amountText}
                  onChangeText={(value) => setAmountText(value.replace(/[^0-9]/g, "").slice(0, 7))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="rgba(255,255,255,0.38)"
                  selectionColor="#FFFFFF"
                  style={styles.amountInput}
                  accessibilityLabel={t("send.amountLabel")}
                  maxFontSizeMultiplier={1}
                />
              </View>
              <Text style={styles.amountUnit}>{t("send.unit")}</Text>
              <View style={styles.quickRow}>
                {QUICK_AMOUNTS.map((quick) => {
                  const affordable = quick <= balance;
                  return (
                    <Pressable
                      key={quick}
                      accessibilityRole="button"
                      disabled={!affordable}
                      onPress={() => setAmountText(String(quick))}
                      style={({ pressed }) => [styles.quick, !affordable && styles.quickOff, pressed && styles.quickPressed]}
                    >
                      <Text style={styles.quickText}>{formatNumber(quick)}</Text>
                    </Pressable>
                  );
                })}
                {balance > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setAmountText(String(balance))}
                    style={({ pressed }) => [styles.quick, styles.quickAll, pressed && styles.quickPressed]}
                  >
                    <Text style={[styles.quickText, styles.quickAllText]}>{t("send.all")}</Text>
                  </Pressable>
                ) : null}
              </View>
            </BrandSurface>

            <View style={styles.noteBlock}>
              <Text style={styles.fieldLabel}>{t("send.note")}</Text>
              <TextInput
                value={note}
                onChangeText={(value) => setNote(value.slice(0, 200))}
                placeholder={t("send.notePlaceholder")}
                placeholderTextColor={colors.inkSoft}
                multiline
                style={styles.noteInput}
              />
              <Text style={styles.counter}>{note.length}/200</Text>
            </View>

            {amountProblem ? <InlineError message={amountProblem} /> : null}
            {error ? <InlineError message={error} /> : null}

            {/* The one button on the screen, drawn as the thing it does: a
                plane on a white disc, leaving on the brand. Until there is an
                amount it says what is missing, and stays quiet. */}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: amount <= 0 || Boolean(amountProblem) || sending, busy: sending }}
              disabled={amount <= 0 || Boolean(amountProblem) || sending}
              onPress={() => void send()}
              style={({ pressed }) => [styles.sendWrap, (amount <= 0 || Boolean(amountProblem)) && styles.sendOff, pressed && styles.sendPressed]}
            >
              <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendButton}>
                <View style={styles.sendDisc}>
                  {sending ? <ActivityIndicator color={colors.primary} size="small" /> : (
                    <>
                      <Image source={coinIcon} resizeMode="contain" style={styles.sendCoin} />
                      <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendArrow}>
                        <ArrowUpRight color={brandInk.strong} size={12} strokeWidth={3.2} />
                      </LinearGradient>
                    </>
                  )}
                </View>
                <Text style={styles.sendLabel} numberOfLines={1}>
                  {amount > 0 ? t("send.sendAmount", { amount: formatCoins(amount) }) : t("send.enterAmount")}
                </Text>
                <View style={styles.sendDiscSpacer} />
              </LinearGradient>
            </Pressable>
            <View style={styles.disclaimer}>
              <ShieldCheck color={colors.inkSoft} size={16} strokeWidth={2} />
              <Text style={styles.disclaimerText}>{t("send.final")}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.searchField}>
              <Search color={colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />
              <TextInput
                value={query}
                onChangeText={(value) => setQuery(value.replace(/[^A-Za-z0-9_@]/g, "").replace(/^@/, "").toLowerCase())}
                placeholder={t("send.search")}
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.searchInput}
                accessibilityLabel={t("send.searchLabel")}
              />
              {searching ? <ActivityIndicator color={colors.primary} size="small" /> : null}
            </View>

            {searchError ? <InlineError message={searchError} /> : null}

            {trimmedQuery.length < MIN_QUERY_LENGTH ? (
              <EmptyState
                icon={UserRound}
                title={t("send.whom")}
                message={t("send.whomBody")}
              />
            ) : null}

            {trimmedQuery.length >= MIN_QUERY_LENGTH && !searching && matches.length === 0 && !searchError ? (
              <EmptyState
                icon={Search}
                title={t("send.notFound")}
                message={t("send.notFoundBody", { query: trimmedQuery })}
              />
            ) : null}

            <View style={styles.matchList}>
              {matches.map((match) => (
                <Pressable
                  key={match.id}
                  accessibilityRole="button"
                  onPress={() => { setRecipient(match); setError(null); }}
                  style={({ pressed }) => [styles.matchRow, pressed && styles.matchPressed]}
                >
                  <Avatar uri={match.avatar_url} initials={initialsFor(match)} size={44} />
                  <View style={styles.matchCopy}>
                    <Text numberOfLines={1} style={styles.matchName}>{match.full_name?.trim() || t("send.user")}</Text>
                    <Text style={styles.matchHandle}>@{match.username}</Text>
                  </View>
                  <ChevronRight color={colors.primary} size={icon.md} strokeWidth={icon.strokeBold} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.lg },

  searchField: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, height: 56,
    paddingHorizontal: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1 },

  matchList: { gap: spacing.sm },
  matchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  matchPressed: { backgroundColor: colors.primarySoft },
  matchCopy: { flex: 1 },
  matchName: { ...typography.bodyMedium, color: colors.ink },
  matchHandle: { ...typography.caption, color: colors.inkSoft, marginTop: 1 },

  eyebrow: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.4, color: colors.inkSoft, marginBottom: -spacing.sm },
  recipientCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, ...shadow,
  },
  recipientRing: { width: 60, height: 60, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  recipientRingInner: { width: 54, height: 54, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, overflow: "hidden" },
  recipientCopy: { flex: 1 },
  recipientName: { ...typography.bodyMedium, color: colors.ink },
  recipientHandle: { ...typography.caption, color: colors.inkSoft, marginTop: 1 },
  changeButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  changeText: { ...typography.caption, color: colors.primary },

  amountCard: { padding: spacing.xl - 4, gap: 2 },
  amountTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  amountEyebrow: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.4, color: brandInk.muted, flexShrink: 1 },
  balancePill: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 6, paddingRight: 10, paddingVertical: 4, maxWidth: "60%",
    borderRadius: radius.pill, backgroundColor: "rgba(16,6,48,0.26)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  balancePillCoin: { width: 18, height: 18 },
  balancePillText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: brandInk.strong, fontVariant: ["tabular-nums"] },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  amountCoin: { width: 46, height: 46 },
  // The field has a height of its own and a line height taller than its glyph.
  // It used to be sized by its content alone, and on iOS the empty field drew
  // only the lower half of its "0" placeholder — a stray arc, and the same clip
  // cut the top off typed digits.
  amountInput: {
    // `minWidth: 0` lets the field shrink to the row: a browser gives an input a
    // width of its own, and at this size it pushed the whole screen sideways.
    flex: 1, minWidth: 0, height: 76, paddingVertical: 0, paddingHorizontal: 0,
    fontFamily: "Manrope_800ExtraBold", fontSize: 48, lineHeight: 62, letterSpacing: -1.5,
    color: brandInk.strong, includeFontPadding: false, textAlignVertical: "center", fontVariant: ["tabular-nums"],
  },
  amountUnit: { fontFamily: "Manrope_600SemiBold", fontSize: 13, color: brandInk.muted, marginLeft: 46 + spacing.md, marginTop: -6 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  quick: {
    paddingHorizontal: 14, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)",
  },
  quickOff: { opacity: 0.35 },
  quickPressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  quickText: { fontFamily: "Manrope_700Bold", fontSize: 13, color: brandInk.strong, fontVariant: ["tabular-nums"] },
  quickAll: { backgroundColor: brandInk.plate, borderColor: brandInk.plate },
  quickAllText: { color: brandInk.onPlate },
  fieldLabel: { ...typography.bodyMedium, color: colors.ink },

  noteBlock: { gap: spacing.sm },
  noteInput: {
    ...typography.body, color: colors.ink, minHeight: 88, textAlignVertical: "top",
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  counter: { ...typography.caption, color: colors.inkSoft, alignSelf: "flex-end" },
  sendWrap: { borderRadius: radius.pill, shadowColor: "#4B1FA8", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  sendOff: { opacity: 0.5, shadowOpacity: 0 },
  sendPressed: { transform: [{ scale: 0.985 }] },
  sendButton: { height: 62, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", paddingHorizontal: 7, gap: spacing.md },
  sendDisc: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: brandInk.plate },
  sendCoin: { width: 34, height: 34 },
  sendArrow: {
    position: "absolute", right: -2, bottom: -2, width: 21, height: 21, borderRadius: 11,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: brandInk.plate,
  },
  sendDiscSpacer: { width: 48 },
  sendLabel: { flex: 1, textAlign: "center", fontFamily: "Manrope_800ExtraBold", fontSize: 16, color: brandInk.strong },
  disclaimer: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  disclaimerText: { ...typography.caption, color: colors.inkMuted, lineHeight: 17, flex: 1 },

  successBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  successLines: { alignItems: "center", gap: spacing.sm, marginTop: -spacing.lg },
  successAmountRow: { flexDirection: "row", alignItems: "center" },
  successAmount: { fontFamily: "Manrope_800ExtraBold", fontSize: 46, lineHeight: 52, color: colors.ink, letterSpacing: -1.4 },
  successCoin: { width: 52, height: 52, marginLeft: 4 },
  successCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  successBalance: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.sm },
  successActions: { alignSelf: "stretch", gap: spacing.md, marginTop: spacing.xxl },
}));

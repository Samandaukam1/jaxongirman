import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { ArrowLeft, Search, Send, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Avatar } from "@/components/Avatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { CountUp, Rise, SuccessMark } from "@/components/SuccessMoment";
import { EmptyState, InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatCoins, formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Match = { id: string; full_name: string; username: string; avatar_url: string | null };

/** Long enough that a handle is typed, short enough that the list feels live. */
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

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
            <View style={styles.recipientCard}>
              <Avatar uri={recipient.avatar_url} initials={initialsFor(recipient)} size={52} />
              <View style={styles.recipientCopy}>
                <Text numberOfLines={1} style={styles.recipientName}>{recipient.full_name?.trim() || t("send.user")}</Text>
                <Text style={styles.recipientHandle}>@{recipient.username}</Text>
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

            <View style={styles.amountCard}>
              <Text style={styles.fieldLabel}>{t("send.howMuch")}</Text>
              <View style={styles.amountRow}>
                <Image source={coinIcon} resizeMode="contain" style={styles.amountCoin} />
                <TextInput
                  value={amountText}
                  onChangeText={(value) => setAmountText(value.replace(/[^0-9]/g, "").slice(0, 7))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.inkSoft}
                  style={styles.amountInput}
                  accessibilityLabel={t("send.amountLabel")}
                />
                <Text style={styles.amountUnit}>{t("send.unit")}</Text>
              </View>
              <View style={styles.balanceHint}>
                <Text style={styles.balanceHintText}>{t("send.current", { balance: formatCoins(balance) })}</Text>
                {balance > 0 ? (
                  <Pressable accessibilityRole="button" onPress={() => setAmountText(String(balance))}>
                    <Text style={styles.balanceMax}>{t("send.all")}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

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

            <PrimaryButton
              label={amount > 0 ? t("send.sendAmount", { amount: formatCoins(amount) }) : t("send.enterAmount")}
              icon={Send}
              loading={sending}
              disabled={amount <= 0 || Boolean(amountProblem)}
              onPress={() => void send()}
            />
            <Text style={styles.disclaimer}>
              {t("send.final")}
            </Text>
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
                  <Send color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} />
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

  recipientCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, ...shadow,
  },
  recipientCopy: { flex: 1 },
  recipientName: { ...typography.bodyMedium, color: colors.ink },
  recipientHandle: { ...typography.caption, color: colors.inkSoft, marginTop: 1 },
  changeButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  changeText: { ...typography.caption, color: colors.primary },

  amountCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  fieldLabel: { ...typography.bodyMedium, color: colors.ink },
  amountRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  amountCoin: { width: 40, height: 40 },
  amountInput: { flex: 1, fontFamily: "Manrope_700Bold", fontSize: 38, color: colors.ink, paddingVertical: spacing.sm },
  amountUnit: { fontFamily: "Manrope_600SemiBold", fontSize: 15, color: colors.inkSoft, marginBottom: 6 },
  balanceHint: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  balanceHintText: { ...typography.caption, color: colors.inkMuted },
  balanceMax: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },

  noteBlock: { gap: spacing.sm },
  noteInput: {
    ...typography.body, color: colors.ink, minHeight: 88, textAlignVertical: "top",
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  counter: { ...typography.caption, color: colors.inkSoft, alignSelf: "flex-end" },
  disclaimer: { ...typography.caption, color: colors.inkSoft, textAlign: "center", lineHeight: 17 },

  successBody: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  successLines: { alignItems: "center", gap: spacing.sm, marginTop: -spacing.lg },
  successAmountRow: { flexDirection: "row", alignItems: "center" },
  successAmount: { fontFamily: "Manrope_800ExtraBold", fontSize: 46, lineHeight: 52, color: colors.ink, letterSpacing: -1.4 },
  successCoin: { width: 52, height: 52, marginLeft: 4 },
  successCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  successBalance: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.sm },
  successActions: { alignSelf: "stretch", gap: spacing.md, marginTop: spacing.xxl },
}));

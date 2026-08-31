import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Crown, Search, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  castVote, invitedCandidate, myVotes, searchCandidates, useMarathonEnabled,
  type MarathonCandidate, type MarathonVoteKind, type MarathonVotes,
} from "@/lib/marathon";
import { formatNumber } from "@/lib/money";
import { icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Where every vote button leads.
 *
 * One destination for all four of them: somebody who taps "Ovoz berish" in the
 * marketplace and on the home screen has to arrive at the same place, or they
 * are two features wearing one name.
 *
 * Finding a person is the whole screen. A leaderboard would invite voting for
 * whoever is already winning; a search asks who you actually came to support,
 * which is what a marathon run on a student's own circle is decided by.
 */
/**
 * Who a vote is about to go to.
 *
 * Narrower than a search result on purpose: a candidate reached through a
 * shared link carries a name and a picture and no vote counts, and the
 * confirmation never showed counts anyway. One shape both can satisfy.
 */
type Choice = Pick<MarathonCandidate, "user_id" | "username" | "full_name" | "avatar_url">;

/** Two letters, from whichever name the account actually has. */
function initialsOf(row: Choice): string {
  const source = (row.full_name ?? row.username ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

export default function MarathonVoteScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const enabled = useMarathonEnabled();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarathonCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState<MarathonVotes | null>(null);
  const [chosen, setChosen] = useState<Choice | null>(null);
  /**
   * Null until somebody actually picks.
   *
   * Which vote to spend has an obvious default — the free one, while there is
   * one — but the default depends on a wallet that arrives after the screen
   * does, and on a sheet that can be opened by a link before either. Deriving
   * it below means the sheet is never sitting on a spent option, and a person
   * who does choose is not overruled when the wallet reloads.
   */
  const [kind, setKind] = useState<MarathonVoteKind | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Choice | null>(null);
  const params = useLocalSearchParams<{ campaignId?: string; candidateId?: string }>();

  useEffect(() => {
    if (!enabled) return;
    void myVotes().then(setVotes).catch(() => setVotes(null));
  }, [enabled]);

  /**
   * Arriving from a scanned QR or a shared link.
   *
   * The person came here to vote for one specific candidate, and asking them to
   * type the username they just scanned would be the app forgetting what it was
   * told. The sheet opens on that candidate directly; a link whose campaign has
   * finished says so rather than opening an empty one.
   */
  useEffect(() => {
    const campaignId = typeof params.campaignId === "string" ? params.campaignId : "";
    const candidateId = typeof params.candidateId === "string" ? params.candidateId : "";
    if (!enabled || !campaignId || !candidateId) return;
    let cancelled = false;
    void invitedCandidate(campaignId, candidateId)
      .then((row) => {
        if (cancelled) return;
        if (row) setChosen(row);
        else setError("Havola eskirgan yoki bu marafon yakunlangan.");
      })
      .catch((failure) => { if (!cancelled) setError(asErrorMessage(failure)); });
    return () => { cancelled = true; };
  }, [enabled, params.campaignId, params.candidateId]);

  // The search waits for a pause rather than querying per keystroke.
  useEffect(() => {
    const term = query.trim().replace(/^@+/, "");
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchCandidates(term)
        .then((rows) => { setResults(rows); setError(null); })
        .catch((failure) => setError(asErrorMessage(failure)))
        .finally(() => setSearching(false));
    }, 320);
    return () => clearTimeout(handle);
  }, [query]);

  const available = useMemo(() => ({
    free: votes?.free_available ?? 0,
    premium: votes?.premium_available ?? 0,
  }), [votes]);

  const chosenKind: MarathonVoteKind = kind ?? (available.free > 0 ? "free" : "premium");

  async function send() {
    if (!chosen) return;
    setSending(true);
    try {
      await castVote(chosen.user_id, chosenKind);
      setDone(chosen);
      setChosen(null);
      setVotes(await myVotes());
      // The counts the list is showing are now one behind.
      setResults((rows) => rows.map((row) => row.user_id === chosen.user_id
        ? {
          ...row,
          total_votes: Number(row.total_votes) + 1,
          premium_votes: Number(row.premium_votes) + (chosenKind === "premium" ? 1 : 0),
        }
        : row));
    } catch (failure) {
      setError(asErrorMessage(failure));
      setChosen(null);
    } finally {
      setSending(false);
    }
  }

  if (!enabled) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Ovoz berish" variant="back" />
        <EmptyState icon={Sparkles} title="Marafon faol emas" message="Talabalar marafoni hozircha ochilmagan." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="OVOZ BERISH" variant="back" />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.lead}>
          Qo‘llab-quvvatlamoqchi bo‘lgan ishtirokchini username orqali toping.
        </Text>

        <View style={styles.searchRow}>
          <Search color={colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            placeholder="@ username orqali qidiring"
            placeholderTextColor={colors.inkSoft}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {searching ? <ActivityIndicator color={colors.primary} size="small" /> : null}
        </View>

        {/* What is left to give, said before somebody picks a person. */}
        <View style={styles.wallet}>
          <View style={styles.walletItem}>
            <Text style={styles.walletLabel}>Bepul ovoz</Text>
            <Text style={styles.walletValue}>{available.free > 0 ? `${available.free} ta mavjud` : "Ishlatilgan"}</Text>
          </View>
          <View style={styles.walletDivider} />
          <View style={styles.walletItem}>
            <Text style={styles.walletLabel}>Premium ovoz ⭐</Text>
            <Text style={styles.walletValue}>{available.premium > 0 ? `${available.premium} ta mavjud` : "Ishlatilgan"}</Text>
          </View>
        </View>

        {error ? <ErrorState message={error} /> : null}

        {results.map((row) => (
          <View key={row.user_id} style={styles.card}>
            <Avatar initials={initialsOf(row)} uri={row.avatar_url} size={48} />
            <View style={styles.cardBody}>
              <Text numberOfLines={1} style={styles.cardName}>{row.full_name ?? "Ishtirokchi"}</Text>
              <Text numberOfLines={1} style={styles.cardHandle}>@{row.username}</Text>
              <Text style={styles.cardVotes}>
                {formatNumber(Number(row.total_votes))} ovoz · Premium: {formatNumber(Number(row.premium_votes))}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${row.username} ni tanlash`}
              onPress={() => { setKind(null); setChosen(row); }}
              style={styles.choose}
            >
              <Text style={styles.chooseText}>Tanlash</Text>
            </Pressable>
          </View>
        ))}

        {query.trim().length >= 2 && !searching && results.length === 0 && !error ? (
          <EmptyState
            icon={Search}
            title="Topilmadi"
            message="Bu username bo‘yicha marafon ishtirokchisi yo‘q."
          />
        ) : null}
      </ScrollView>

      {/* Confirmation, because a vote cannot be taken back. */}
      <Modal visible={Boolean(chosen)} transparent animationType="slide" onRequestClose={() => setChosen(null)}>
        <Pressable style={styles.backdrop} onPress={() => !sending && setChosen(null)} />
        <View style={styles.sheet}>
          {chosen ? (
            <>
              <Avatar initials={initialsOf(chosen)} uri={chosen.avatar_url} size={64} />
              <Text style={styles.sheetName}>{chosen.full_name ?? "Ishtirokchi"}</Text>
              <Text style={styles.sheetHandle}>@{chosen.username}</Text>
              <Text style={styles.sheetAsk}>Ushbu ishtirokchiga ovoz bermoqchimisiz?</Text>

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: chosenKind === "free", disabled: available.free === 0 }}
                disabled={available.free === 0}
                onPress={() => setKind("free")}
                style={[styles.option, chosenKind === "free" && styles.optionOn, available.free === 0 && styles.optionOff]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>Bepul ovoz</Text>
                  <Text style={styles.optionHint}>{available.free > 0 ? "1 ta mavjud" : "✓ Ishlatilgan"}</Text>
                </View>
                {chosenKind === "free" && available.free > 0 ? <Check color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} /> : null}
              </Pressable>

              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: chosenKind === "premium", disabled: available.premium === 0 }}
                disabled={available.premium === 0}
                onPress={() => setKind("premium")}
                style={[styles.option, chosenKind === "premium" && styles.optionOn, available.premium === 0 && styles.optionOff]}
              >
                <Crown color={available.premium > 0 ? colors.primary : colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>Premium ovoz</Text>
                  <Text style={styles.optionHint}>
                    {available.premium > 0 ? "1 ta mavjud" : "Premium a’zolik bilan mavjud"}
                  </Text>
                </View>
                {chosenKind === "premium" && available.premium > 0 ? <Check color={colors.primary} size={icon.sm} strokeWidth={icon.strokeBold} /> : null}
              </Pressable>

              {available.free === 0 && available.premium === 0 ? (
                /* Nothing left to give: the existing purchase flow, not a new one. */
                <PrimaryButton label="Premium olish" onPress={() => { setChosen(null); router.push("/(app)/tarif"); }} />
              ) : (
                <PrimaryButton label="Ovoz berish" loading={sending} onPress={() => void send()} />
              )}
            </>
          ) : null}
        </View>
      </Modal>

      <Modal visible={Boolean(done)} transparent animationType="fade" onRequestClose={() => setDone(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDone(null)} />
        <View style={styles.sheet}>
          <View style={styles.successMark}><Sparkles color={colors.primary} size={icon.lg} strokeWidth={icon.stroke} /></View>
          <Text style={styles.sheetName}>Ovozingiz qabul qilindi</Text>
          <Text style={styles.sheetAsk}>
            {done?.full_name ?? "Ishtirokchi"}ga ovoz berdingiz.
          </Text>
          <PrimaryButton label="Yopish" onPress={() => setDone(null)} />
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  lead: { ...typography.body, color: colors.inkMuted },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    height: 46, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink },
  wallet: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  walletItem: { flex: 1, gap: 2 },
  walletDivider: { width: 1, height: 28, backgroundColor: colors.border },
  walletLabel: { ...typography.caption, color: colors.inkMuted },
  walletValue: { ...typography.bodyMedium, color: colors.ink },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  cardBody: { flex: 1, gap: 1 },
  cardName: { ...typography.bodyMedium, color: colors.ink },
  cardHandle: { ...typography.caption, color: colors.inkMuted },
  cardVotes: { ...typography.caption, color: colors.inkSoft, marginTop: 2 },
  choose: {
    paddingHorizontal: spacing.md, height: 36, justifyContent: "center",
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  chooseText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    alignItems: "center", gap: spacing.sm,
    padding: spacing.xl, paddingBottom: spacing.xxl,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface, ...shadowLifted,
  },
  sheetName: { ...typography.heading, color: colors.ink, marginTop: spacing.sm },
  sheetHandle: { ...typography.caption, color: colors.inkMuted },
  sheetAsk: { ...typography.body, color: colors.inkMuted, textAlign: "center", marginBottom: spacing.sm },
  option: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    width: "100%", padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionOff: { opacity: 0.55 },
  optionLabel: { ...typography.bodyMedium, color: colors.ink },
  optionHint: { ...typography.caption, color: colors.inkMuted },
  successMark: {
    width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
}));

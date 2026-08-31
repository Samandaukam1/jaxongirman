import { Clock, Sparkles } from "lucide-react-native";
import { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";

import { MarathonPoster } from "@/components/MarathonPoster";
import { MarathonRewards } from "@/components/MarathonRewards";
import { MarathonShareRow } from "@/components/MarathonShareRow";
import { MarathonVoteButton } from "@/components/MarathonVoteButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from "@/components/StateBlocks";
import { countdownTo, formatCountdown, formatDate, useNow } from "@/lib/datetime";
import { nextTierOf, useMarathonCampaign } from "@/lib/marathon";
import { formatNumber } from "@/lib/money";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { useAccount } from "@/providers/AccountProvider";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The marathon, on one page.
 *
 * The order is not a matter of taste. Somebody arriving here has three
 * questions in a fixed sequence — what is this, how long have I got, and what
 * do I get — and the page answers them in that order before it asks anything
 * of them. The vote button comes after the reward ladder because a person who
 * has not yet seen what the votes are for has no reason to press it.
 *
 * Everything below the poster comes from one call, so the milestones can never
 * be a screenful ahead of the vote count they are measured against.
 */
export default function MarathonScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { campaign, loading, error, skew, reload, join, joining } = useMarathonCampaign();
  const [refreshing, setRefreshing] = useState(false);
  const { profile } = useAccount();

  // The device ticks between renders; the server's clock is what it is measured against.
  const now = useNow(Boolean(campaign)) + skew;
  const countdown = useMemo(
    () => (campaign ? countdownTo(campaign.ends_at, now) : null),
    [campaign, now]);
  const next = campaign ? nextTierOf(campaign) : null;

  if (!loading && !campaign) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="TALABALAR MARAFONI" variant="back" />
        <EmptyState
          icon={Sparkles}
          title="Marafon faol emas"
          message="Talabalar marafoni hozircha ochilmagan. Boshlanganda sizga xabar beramiz."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="TALABALAR MARAFONI" variant="back" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => { setRefreshing(true); void reload().finally(() => setRefreshing(false)); }}
          />
        }
      >
        {!campaign ? (
          <>
            <View style={styles.posterSkeleton} />
            <Skeleton height={26} width="70%" />
            <SkeletonCard lines={3} />
          </>
        ) : (
          <>
            <MarathonPoster campaign={campaign} />

            <Text style={styles.title}>{campaign.title}</Text>
            {campaign.description ? <Text style={styles.description}>{campaign.description}</Text> : null}
            <Text style={styles.window}>
              {formatDate(campaign.starts_at)} — {formatDate(campaign.ends_at)}
            </Text>

            <View style={styles.clock}>
              <Clock color={colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
              <Text style={styles.clockText}>{formatCountdown(countdown)}</Text>
            </View>

            {error ? <ErrorState message={error} onRetry={() => void reload()} /> : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Mening holatim</Text>
              {campaign.joined ? (
                <>
                  <View style={styles.tallyRow}>
                    <View style={styles.tally}>
                      <Text style={styles.tallyValue}>{formatNumber(campaign.total_votes)}</Text>
                      <Text style={styles.tallyLabel}>Jami ovoz</Text>
                    </View>
                    <View style={styles.tallyDivider} />
                    <View style={styles.tally}>
                      <Text style={styles.tallyValue}>{formatNumber(campaign.premium_votes)}</Text>
                      <Text style={styles.tallyLabel}>Premium ovoz</Text>
                    </View>
                  </View>
                  <Text style={styles.cardHint}>
                    {next
                      ? `Keyingi bosqichgacha ${formatNumber(Math.max(0, next.votes_required - campaign.total_votes))} ta ovoz va ${formatNumber(Math.max(0, next.premium_required - campaign.premium_votes))} ta Premium ovoz qoldi.`
                      : "Barcha bosqichlar bosib o‘tilgan."}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.cardHint}>
                    Marafonda qatnashish uchun ro‘yxatdan o‘ting — shundan keyin sizga ovoz berish mumkin bo‘ladi.
                  </Text>
                  <PrimaryButton label="Qatnashish" loading={joining} onPress={() => void join()} />
                </>
              )}
            </View>

            <Text style={styles.sectionTitle}>SOVRINLAR</Text>
            <MarathonRewards campaign={campaign} />

            <MarathonVoteButton />

            {/* Sharing comes after voting and only for somebody who entered:
                a link to a candidacy that does not exist is a dead QR. */}
            {campaign.joined && profile ? (
              <MarathonShareRow campaign={campaign} candidateId={profile.id} username={profile.username} />
            ) : null}

            {campaign.rules ? (
              <View style={styles.rules}>
                <Text style={styles.sectionTitle}>QOIDALAR</Text>
                <Text style={styles.rulesText}>{campaign.rules}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxxl },
  posterSkeleton: {
    width: "100%", aspectRatio: 2.35,
    borderRadius: radius.lg, backgroundColor: colors.surfaceMuted,
  },
  title: { ...typography.title, color: colors.ink, marginTop: spacing.xs },
  description: { ...typography.body, color: colors.inkMuted },
  window: { ...typography.caption, color: colors.inkSoft },
  clock: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    alignSelf: "flex-start", paddingHorizontal: spacing.md, height: 34,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  clockText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  card: {
    gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, marginTop: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { ...typography.heading, color: colors.ink },
  cardHint: { ...typography.body, color: colors.inkMuted },
  tallyRow: { flexDirection: "row", alignItems: "center" },
  tally: { flex: 1, gap: 2 },
  tallyDivider: { width: 1, height: 34, backgroundColor: colors.border },
  tallyValue: { ...typography.title, color: colors.ink },
  tallyLabel: { ...typography.caption, color: colors.inkMuted },
  sectionTitle: {
    ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.inkMuted,
    letterSpacing: 0.8, marginTop: spacing.md,
  },
  rules: { gap: spacing.sm },
  rulesText: { ...typography.body, color: colors.inkMuted },
}));

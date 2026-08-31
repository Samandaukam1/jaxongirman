import { useRouter } from "expo-router";
import { Clock, Trophy } from "lucide-react-native";
import { Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { countdownTo, formatCountdown, useNow } from "@/lib/datetime";
import { nextTierOf, useMarathonCampaign } from "@/lib/marathon";
import { formatNumber, formatSom } from "@/lib/money";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The marathon on the profile, which is where a candidate checks their score.
 *
 * A section of its own, above Sozlamalar: a competition somebody is running
 * for a contract discount is not a setting, and filed among them it is a thing
 * nobody finds twice.
 *
 * What it shows depends on whether the person entered. A candidate wants two
 * numbers, the gap to the next milestone and the time left; somebody who has
 * not entered wants to know what it is worth and how long they have to decide.
 * Neither of them wants the other's screen.
 */

/** "153 ovoz · 36 Premium" — only the part that is actually still missing. */
function shortfall(have: number, need: number): number {
  return Math.max(0, need - have);
}

export function MarathonProfileCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { campaign, join, joining, skew } = useMarathonCampaign();
  const now = useNow(Boolean(campaign)) + skew;

  if (!campaign) return null;

  const countdown = countdownTo(campaign.ends_at, now);
  const next = nextTierOf(campaign);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>TALABALAR MARAFONI</Text>

      <View style={styles.card}>
        {campaign.joined ? (
          <>
            <View style={styles.tallies}>
              <View style={styles.tally}>
                <Text style={styles.tallyValue}>{formatNumber(campaign.total_votes)}</Text>
                <Text style={styles.tallyLabel}>Jami ovoz</Text>
              </View>
              <View style={styles.tallyRule} />
              <View style={styles.tally}>
                <Text style={styles.tallyValue}>{formatNumber(campaign.premium_votes)}</Text>
                <Text style={styles.tallyLabel}>Premium ovoz</Text>
              </View>
            </View>

            {next ? (
              <View style={styles.next}>
                <View style={styles.nextHead}>
                  <Trophy color={colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
                  <Text style={styles.nextTitle}>
                    KEYINGI MARRA · {next.reward_percent}%
                  </Text>
                </View>

                <Text style={styles.progressLine}>
                  {formatNumber(campaign.total_votes)} / {formatNumber(next.votes_required)} ovoz
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(Math.min(1, campaign.total_votes / Math.max(1, next.votes_required)) * 100)}%` }]} />
                </View>

                <Text style={styles.progressLine}>
                  {formatNumber(campaign.premium_votes)} / {formatNumber(next.premium_required)} Premium
                </Text>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${Math.round(Math.min(1, campaign.premium_votes / Math.max(1, next.premium_required)) * 100)}%` }]} />
                </View>

                <Text style={styles.left}>
                  Qoldi: {formatNumber(shortfall(campaign.total_votes, next.votes_required))} ovoz ·{" "}
                  {formatNumber(shortfall(campaign.premium_votes, next.premium_required))} Premium ovoz
                </Text>
              </View>
            ) : (
              <Text style={styles.hint}>Barcha marralar bosib o‘tilgan.</Text>
            )}

            <View style={styles.clock}>
              <Clock color={colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
              <Text style={styles.clockText}>Tugashiga: {formatCountdown(countdown)}</Text>
            </View>

            <PrimaryButton label="Marafonni ochish" onPress={() => router.push("/(app)/marathon")} />
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Kontrakt uchun {formatSom(campaign.contract_cap)}gacha mukofot yutish imkoniyati.
            </Text>
            <View style={styles.clock}>
              <Clock color={colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
              <Text style={styles.clockText}>Tugashiga: {formatCountdown(countdown)}</Text>
            </View>
            <PrimaryButton label="Qatnashish" loading={joining} onPress={() => void join()} />
          </>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  section: { marginHorizontal: spacing.xl, gap: spacing.sm },
  sectionTitle: {
    ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11,
    letterSpacing: 1.1, color: colors.inkSoft, marginLeft: spacing.xs,
  },
  card: {
    gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...shadow,
  },
  tallies: { flexDirection: "row", alignItems: "center" },
  tally: { flex: 1, gap: 2 },
  tallyRule: { width: 1, height: 34, backgroundColor: colors.border },
  tallyValue: { fontFamily: "Manrope_700Bold", fontSize: 24, lineHeight: 30, color: colors.ink, letterSpacing: -0.4 },
  tallyLabel: { ...typography.caption, color: colors.inkMuted },
  next: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  nextHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  nextTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", letterSpacing: 0.6, color: colors.primaryDeep },
  progressLine: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.xs },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: colors.primary },
  left: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: colors.primaryDeep, marginTop: spacing.sm },
  hint: { ...typography.body, color: colors.inkMuted },
  clock: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    alignSelf: "flex-start", paddingHorizontal: spacing.md, height: 34,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
  },
  clockText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
}));

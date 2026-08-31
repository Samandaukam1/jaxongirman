import { Check, Lock } from "lucide-react-native";
import { Text, View } from "react-native";

import { nextTierOf, tierProgress, tierReached, type MarathonCampaign } from "@/lib/marathon";
import { formatNumber, formatSom } from "@/lib/money";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The reward ladder, as four rungs rather than a table.
 *
 * A table of four rows and three columns is the same information and nobody
 * reads it: what a person wants to know is which rung they are on and how far
 * the next one is, which is a position and a bar, not a grid. The bar tracks
 * whichever of the two demands is further behind, because meeting one of them
 * is not progress anybody can bank.
 *
 * The money is spelled out under each percentage. "25% kontrakt" means nothing
 * without the cap it is a percentage of, and a person deciding whether to
 * spend a month collecting votes is deciding about the sum.
 */
export function MarathonRewards({ campaign }: { campaign: MarathonCampaign }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (campaign.tiers.length === 0) return null;
  const next = nextTierOf(campaign);

  return (
    <View style={styles.ladder}>
      {campaign.tiers.map((tier) => {
        const reached = tierReached(tier, campaign);
        const current = !reached && tier.position === next?.position;
        const progress = tierProgress(tier, campaign);
        return (
          <View key={tier.position} style={[styles.tier, current && styles.tierCurrent]}>
            <View style={[styles.mark, reached && styles.markDone]}>
              {reached
                ? <Check color={colors.onPrimary} size={icon.sm} strokeWidth={icon.strokeBold} />
                : <Lock color={colors.inkSoft} size={icon.xs} strokeWidth={icon.stroke} />}
            </View>
            <View style={styles.body}>
              <Text style={styles.reward}>Kontraktning {tier.reward_percent}% i</Text>
              <Text style={styles.amount}>
                {formatSom(Math.round((campaign.contract_cap * tier.reward_percent) / 100))}gacha
              </Text>
              <Text style={styles.need}>
                {formatNumber(tier.votes_required)} ovoz · {formatNumber(tier.premium_required)} Premium
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
            </View>
          </View>
        );
      })}
      <Text style={styles.cap}>
        Maksimal hisoblanadigan kontrakt: {formatSom(campaign.contract_cap)}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  ladder: { gap: spacing.sm },
  tier: {
    flexDirection: "row", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  tierCurrent: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  mark: {
    width: 28, height: 28, borderRadius: 14, marginTop: 2,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted,
  },
  markDone: { backgroundColor: colors.primary },
  body: { flex: 1, gap: 1 },
  reward: { ...typography.bodyMedium, color: colors.ink },
  amount: { ...typography.caption, color: colors.primaryDeep },
  need: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden", marginTop: spacing.xs },
  fill: { height: "100%", borderRadius: 3, backgroundColor: colors.primary },
  cap: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.xs },
}));

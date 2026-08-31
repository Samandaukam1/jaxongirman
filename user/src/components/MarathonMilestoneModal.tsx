import { Sparkles, TriangleAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Easing, Modal, Pressable, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { asErrorMessage } from "@/lib/format";
import { useReduceMotion } from "@/lib/motion";
import { decideMilestone, tierAfter, type MarathonCampaign, type MarathonTier } from "@/lib/marathon";
import { formatNumber, formatSom } from "@/lib/money";
import { icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The moment a candidate has to choose, and the reason it cannot be a tap.
 *
 * Reaching a milestone buys one decision: take this reward now, or give it up
 * for the one above. Both are irreversible, so neither can be something that
 * happens by dismissing a modal — the modal closes, nothing is written, and the
 * question is asked again the next time the screen loads. Only the two buttons
 * write anything, and continuing asks a second time in plainer words.
 *
 * The celebration is seven sparks and under a second. This is real money and a
 * month of somebody's effort; a screen that behaves like a slot machine about
 * it reads as a game, and this is not one.
 */

/** Where each spark flies, as a fraction of the burst radius. */
const SPARKS = [
  { x: -1, y: -0.72 }, { x: 0, y: -1 }, { x: 1, y: -0.72 },
  { x: -1.1, y: 0.12 }, { x: 1.1, y: 0.12 },
  { x: -0.66, y: 0.82 }, { x: 0.66, y: 0.82 },
];
const BURST_RADIUS = 104;

export function MarathonMilestoneModal({ campaign, tier, onSettled }: {
  campaign: MarathonCampaign;
  tier: MarathonTier;
  onSettled: () => void | Promise<void>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [burst] = useState(() => new Animated.Value(0));

  const next = tierAfter(campaign, tier.position);
  const reward = Math.round((campaign.contract_cap * tier.reward_percent) / 100);

  useEffect(() => {
    if (reduceMotion) { burst.setValue(1); return; }
    Animated.timing(burst, { toValue: 1, duration: 820, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [burst, reduceMotion]);

  async function decide(decision: "claim" | "continue") {
    setSending(true);
    try {
      await decideMilestone(tier.position, decision);
      setConfirming(false);
      await onSettled();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* Not dismissible by tapping away: the two answers are the only exits
          that mean anything, and the close button leaves the question open. */}
      <Modal visible={!dismissed} transparent animationType="fade" onRequestClose={() => setDismissed(true)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View pointerEvents="none" style={styles.burstLayer}>
              {SPARKS.map((spark, index) => (
                <Animated.View
                  key={index}
                  style={{
                    position: "absolute",
                    opacity: burst.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                    transform: [
                      { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, spark.x * BURST_RADIUS] }) },
                      { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, spark.y * BURST_RADIUS] }) },
                      { scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1, 0.6] }) },
                    ],
                  }}
                >
                  <Sparkles color={index % 2 ? colors.accent : colors.primaryBright} size={20} strokeWidth={2} />
                </Animated.View>
              ))}
            </View>

            <Text style={styles.title}>🎉 {tier.reward_percent}% MARRAGA YETDINGIZ</Text>
            <Text style={styles.body}>
              Siz kontrakt mukofotining {tier.reward_percent}% qismini olish huquqiga ega bo‘ldingiz.
            </Text>
            <Text style={styles.amount}>{formatSom(reward)}gacha</Text>

            <Text style={styles.tally}>
              {formatNumber(campaign.total_votes)} ovoz · {formatNumber(campaign.premium_votes)} Premium
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton
              label={`${tier.reward_percent}% mukofotni olish`}
              loading={sending && !confirming}
              onPress={() => void decide("claim")}
            />

            {next ? (
              <Pressable
                accessibilityRole="button"
                disabled={sending}
                onPress={() => setConfirming(true)}
                style={({ pressed }) => [styles.ghost, pressed && styles.ghostPressed]}
              >
                <Text style={styles.ghostLabel}>{next.reward_percent}% uchun davom etish</Text>
              </Pressable>
            ) : null}

            <Pressable accessibilityRole="button" onPress={() => setDismissed(true)} hitSlop={8}>
              <Text style={styles.later}>Keyinroq hal qilaman</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* The second question, in the words the first one could not use without
          becoming a wall of text. */}
      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.warnMark}>
              <TriangleAlert color={colors.warning} size={icon.lg} strokeWidth={icon.stroke} />
            </View>
            <Text style={styles.title}>Diqqat</Text>
            <Text style={styles.body}>
              Davom etsangiz {tier.reward_percent}% mukofotdan qaytarib bo‘lmas tarzda voz kechasiz.
              {next ? `\n\nKeyingi mukofotni faqat ${formatNumber(next.votes_required)} jami va ${formatNumber(next.premium_required)} Premium ovozga yetganingizdan keyin olishingiz mumkin.` : ""}
            </Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <PrimaryButton label="Ha, davom etaman" loading={sending} onPress={() => void decide("continue")} />

            <Pressable
              accessibilityRole="button"
              disabled={sending}
              onPress={() => setConfirming(false)}
              style={({ pressed }) => [styles.ghost, pressed && styles.ghostPressed]}
            >
              <Text style={styles.ghostLabel}>Orqaga</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: spacing.xl, backgroundColor: "rgba(21,14,36,.62)",
  },
  card: {
    width: "100%", maxWidth: 380, alignItems: "center", gap: spacing.sm,
    padding: spacing.xl, borderRadius: radius.xl,
    backgroundColor: colors.surface, ...shadowLifted,
  },
  burstLayer: { position: "absolute", top: "34%", left: "50%", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  title: { ...typography.title, color: colors.ink, textAlign: "center" },
  body: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  amount: { fontFamily: "Manrope_700Bold", fontSize: 28, lineHeight: 34, color: colors.primary, letterSpacing: -0.5 },
  tally: { ...typography.caption, color: colors.inkSoft, marginBottom: spacing.sm },
  error: { ...typography.caption, color: colors.danger, textAlign: "center" },
  ghost: {
    alignSelf: "stretch", height: 50, alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  ghostPressed: { backgroundColor: colors.surfaceMuted },
  ghostLabel: { ...typography.bodyMedium, color: colors.ink },
  later: { ...typography.caption, color: colors.inkSoft, marginTop: spacing.xs },
  warnMark: {
    width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.warningSoft, marginBottom: spacing.xs,
  },
}));

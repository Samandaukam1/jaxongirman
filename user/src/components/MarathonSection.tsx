import { useRouter } from "expo-router";
import { Clock, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { MarathonPoster } from "@/components/MarathonPoster";
import { MarathonRewards } from "@/components/MarathonRewards";
import { PrimaryButton } from "@/components/PrimaryButton";
import { countdownTo, formatCountdown, formatDate, useNow } from "@/lib/datetime";
import { useMarathonCampaign } from "@/lib/marathon";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The marathon, as the home screen shows it.
 *
 * Poster first and nothing written on top of it, then the four things a person
 * needs before they decide: what it is called, what it asks of them, how long
 * they have, and what it pays. The rewards are the reason anybody enters, so
 * they are above the button rather than behind it.
 *
 * The whole section is absent — not empty, not a placeholder — while the
 * feature is off or no campaign is running, so the home screen is exactly what
 * it was before the marathon existed.
 */
export function MarathonSection() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { campaign, join, joining } = useMarathonCampaign();
  const [rulesOpen, setRulesOpen] = useState(false);
  const now = useNow(Boolean(campaign));

  if (!campaign) return null;

  const countdown = countdownTo(campaign.ends_at, now);

  return (
    <View style={styles.section}>
      <MarathonPoster campaign={campaign} onPress={() => router.push("/(app)/marathon")} />

      <Text style={styles.title}>{campaign.title}</Text>
      {campaign.description ? <Text style={styles.description}>{campaign.description}</Text> : null}

      <Text style={styles.window}>
        {formatDate(campaign.starts_at)} — {formatDate(campaign.ends_at)}
      </Text>

      <View style={styles.clock}>
        <Clock color={colors.primaryDeep} size={icon.sm} strokeWidth={icon.stroke} />
        <Text style={styles.clockText}>{formatCountdown(countdown)}</Text>
      </View>

      <Text style={styles.rewardsTitle}>SOVRINLAR</Text>
      <MarathonRewards campaign={campaign} />

      {campaign.joined ? (
        <PrimaryButton label="Marafon sahifasi" onPress={() => router.push("/(app)/marathon")} />
      ) : (
        <PrimaryButton label="Qatnashish" loading={joining} onPress={() => void join()} />
      )}

      {campaign.rules ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setRulesOpen(true)}
          style={({ pressed }) => [styles.rulesButton, pressed && styles.rulesPressed]}
        >
          <Text style={styles.rulesLabel}>Qoidalar</Text>
        </Pressable>
      ) : null}

      {/* The rules read here rather than on another screen: somebody checking
          one line of them should not lose the poster they were looking at. */}
      <Modal visible={rulesOpen} transparent animationType="slide" onRequestClose={() => setRulesOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setRulesOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Qoidalar</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Yopish" onPress={() => setRulesOpen(false)}>
              <X color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <Text style={styles.rulesText}>{campaign.rules}</Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  section: { gap: spacing.sm },
  title: { ...typography.title, color: colors.ink, marginTop: spacing.xs },
  description: { ...typography.body, color: colors.inkMuted },
  window: { ...typography.caption, color: colors.inkSoft },
  clock: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    alignSelf: "flex-start", paddingHorizontal: spacing.md, height: 34,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  clockText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  rewardsTitle: {
    ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.inkMuted,
    letterSpacing: 0.8, marginTop: spacing.sm,
  },
  rulesButton: {
    height: 46, alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rulesPressed: { backgroundColor: colors.surfaceMuted },
  rulesLabel: { ...typography.bodyMedium, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "72%",
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  sheetHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.md,
  },
  sheetTitle: { ...typography.heading, color: colors.ink },
  sheetBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl },
  rulesText: { ...typography.body, color: colors.inkMuted },
}));

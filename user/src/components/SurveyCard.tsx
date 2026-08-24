import { SURVEY_STATUS_LABELS, type SurveyStatus } from "@jaxongirman/types";
import { CheckCircle2, Clock, Users } from "lucide-react-native";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/lib/motion";
import { countdownTo, formatCountdown, formatShortDateTime, useNow } from "@/lib/datetime";
import { radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** The listing shape `my_surveys()` returns. */
export type SurveySummary = {
  id: string;
  title: string;
  status: SurveyStatus;
  deadline: string | null;
  expected_participants: number | null;
  submitted_count: number;
  question_count: number;
  created_at: string;
  owner_name: string;
  is_owner: boolean;
  my_status?: "invited" | "viewed" | "submitted" | null;
  my_submitted_at?: string | null;
};

/**
 * A live reverse countdown.
 *
 * Ticks once a second only while there is something to count down to — a closed
 * survey or one without a deadline mounts no timer at all, so a long list does
 * not run thirty intervals for text that never changes.
 */
export function CountdownText({ deadline, style }: { deadline: string | null; style?: object }) {
  // Ticking is enabled only while there is a future deadline to count toward.
  const initial = countdownTo(deadline);
  const now = useNow(Boolean(deadline) && initial !== null && !initial.expired);
  return <Text style={style}>{formatCountdown(countdownTo(deadline, now))}</Text>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SurveyCard({ item, onPress }: { item: SurveySummary; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const press = usePressScale();
  // A minute is fine here: this only decides which badge the card wears, while
  // the countdown inside it keeps its own second-by-second clock.
  const now = useNow(item.status === "open", 60_000);
  const expired = Boolean(item.deadline) && new Date(item.deadline as string).getTime() <= now;
  const live = item.status === "open" && !expired;
  const answered = item.my_status === "submitted";

  return (
    <AnimatedPressable accessibilityRole="button" onPress={onPress} {...press.handlers}
      style={({ pressed }: PressableStateCallbackType) => [styles.card, pressed && styles.pressed, press.style]}>
      <View style={styles.top}>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        <View style={[styles.badge, live ? styles.badgeLive : expired ? styles.badgeDone : styles.badgeDraft]}>
          <Text style={[styles.badgeText, live ? styles.badgeTextLive : expired ? styles.badgeTextDone : styles.badgeTextDraft]}>
            {expired && item.status === "open" ? "Tugagan" : SURVEY_STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <Text style={styles.owner}>{item.is_owner ? "Siz yaratgansiz" : item.owner_name}</Text>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Users color={colors.primary} size={14} strokeWidth={2} />
          <Text style={styles.metricText}>
            {item.expected_participants ? `${item.submitted_count}/${item.expected_participants} javob` : `${item.submitted_count} javob`}
          </Text>
        </View>
        {answered ? (
          <View style={styles.metric}>
            <CheckCircle2 color={colors.success} size={14} strokeWidth={2} />
            <Text style={[styles.metricText, styles.metricDone]}>Javob berilgan</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Clock color={live ? colors.primary : colors.inkSoft} size={13} strokeWidth={2} />
        {live ? (
          <CountdownText deadline={item.deadline} style={styles.countdown} />
        ) : (
          <Text style={styles.footerMuted}>
            {item.deadline ? formatCountdown(countdownTo(item.deadline)) : `Yaratilgan: ${formatShortDateTime(item.created_at)}`}
          </Text>
        )}
        <View style={styles.spacer} />
        <Text style={styles.questions}>{item.question_count} savol</Text>
      </View>
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow,
  },
  pressed: { opacity: 0.9 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  title: { ...typography.bodyMedium, color: colors.ink, flex: 1, fontSize: 16 },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeLive: { backgroundColor: colors.successSoft },
  badgeDone: { backgroundColor: colors.surfaceMuted },
  badgeDraft: { backgroundColor: colors.primarySoft },
  badgeText: { ...typography.caption, fontSize: 11 },
  badgeTextLive: { color: colors.success },
  badgeTextDone: { color: colors.inkMuted },
  badgeTextDraft: { color: colors.primary },
  owner: { ...typography.caption, color: colors.inkSoft },
  metrics: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: 2 },
  metric: { flexDirection: "row", alignItems: "center", gap: 5 },
  metricText: { ...typography.caption, color: colors.inkMuted },
  metricDone: { color: colors.success },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  countdown: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  footerMuted: { ...typography.caption, color: colors.inkSoft },
  spacer: { flex: 1 },
  questions: { ...typography.caption, color: colors.inkSoft },
}));

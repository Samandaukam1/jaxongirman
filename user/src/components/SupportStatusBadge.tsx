import { Text, View } from "react-native";

import { statusLabel, type SupportStatus } from "@/lib/support";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/** A ticket's status as a quiet pill; "waiting for you" is the one that asks for attention. */
export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  const styles = useStyles();
  const tone = status === "waiting_for_user" ? styles.action : status === "resolved" || status === "closed" ? styles.done : styles.open;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={[styles.text, status === "waiting_for_user" && styles.textAction]}>{statusLabel(status)}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  badge: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  open: { backgroundColor: colors.primarySoft },
  action: { backgroundColor: colors.warningSoft },
  done: { backgroundColor: colors.surfaceMuted },
  text: { ...typography.caption, fontSize: 11, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  textAction: { color: colors.warning },
}));

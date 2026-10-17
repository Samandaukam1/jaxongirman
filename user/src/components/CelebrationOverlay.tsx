import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, Pressable, Text } from "react-native";

import { CountUp, Rise, SuccessMark } from "@/components/SuccessMoment";
import { useReduceMotion } from "@/lib/motion";
import { formatNumber } from "@/lib/money";
import { radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The moment a gift is opened: the shared success emblem in gold, the amount
 * counting up to what arrived, the words arriving after it.
 */
export function CelebrationOverlay({ amount, message, onClose }: { amount: number; message: string; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["misc", "common"]);
  const reduced = useReduceMotion();
  // Created once by the lazy initialiser: an animated value is a stable object
  // that must survive re-renders, and state gives that without touching a ref
  // during render.
  const [enter] = useState(() => new Animated.Value(reduced ? 1 : 0));

  useEffect(() => {
    if (reduced) return;
    Animated.timing(enter, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, reduced]);

  const cardStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  };

  return (
    <Animated.View style={[styles.backdrop, { opacity: enter }]}>
      <Animated.View style={[styles.card, cardStyle]}>
        <Pressable accessibilityLabel={t("common:close")} hitSlop={10} onPress={onClose} style={styles.close}>
          <X color={colors.inkMuted} size={18} strokeWidth={2} />
        </Pressable>

        <SuccessMark kind="gift" style={styles.mark} />
        <Rise order={0} style={styles.lines}>
          <Text style={styles.title}>{t("celebrate.title")}</Text>
          <CountUp value={amount} format={(value) => t("celebrate.amount", { amount: formatNumber(value) })} style={styles.amount} />
          <Text style={styles.message}>{message}</Text>
        </Rise>

        <Rise order={1} style={styles.actions}>
          <Pressable onPress={onClose} style={styles.button}>
            <Text style={styles.buttonText}>{t("celebrate.ok")}</Text>
          </Pressable>
        </Rise>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: "rgba(21,14,36,.62)" },
  card: { width: "100%", maxWidth: 360, alignItems: "center", padding: spacing.xxl, borderRadius: radius.xl, backgroundColor: colors.surface, ...shadowLifted },
  close: { position: "absolute", top: spacing.md, right: spacing.md, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  mark: { marginTop: -spacing.lg, marginBottom: -spacing.xl },
  lines: { alignItems: "center", gap: 2 },
  title: { ...typography.title, color: colors.ink },
  amount: { fontFamily: "Manrope_800ExtraBold", fontSize: 38, lineHeight: 44, color: colors.primary, letterSpacing: -0.8 },
  message: { ...typography.body, color: colors.inkMuted, textAlign: "center", marginTop: spacing.sm },
  actions: { alignSelf: "stretch" },
  button: { height: 50, marginTop: spacing.xl, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  buttonText: { ...typography.bodyMedium, color: colors.onPrimary },
}));

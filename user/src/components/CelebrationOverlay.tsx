import { Gift, Sparkles, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

import { radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Where each spark flies, as a fraction of the burst radius. */
const SPARKS = [
  { x: -1, y: -0.75 }, { x: 0, y: -1 }, { x: 1, y: -0.75 },
  { x: -1.15, y: 0.1 }, { x: 1.15, y: 0.1 },
  { x: -0.7, y: 0.85 }, { x: 0.7, y: 0.85 },
];
const BURST_RADIUS = 120;

/**
 * The moment a gift is opened. Driven by the RN Animated API on the native
 * thread, so the burst stays smooth while the list behind it re-renders.
 */
export function CelebrationOverlay({ amount, message, onClose }: { amount: number; message: string; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  // Created once by the lazy initialiser: an animated value is a stable object
  // that must survive re-renders, and state gives that without touching a ref
  // during render.
  const [enter] = useState(() => new Animated.Value(0));
  const [burst] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.sequence([
      Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 6, tension: 70 }),
      Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [burst, enter]);

  const cardStyle = {
    opacity: enter,
    transform: [
      { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
    ],
  };

  return (
    <View style={styles.backdrop}>
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Sparks sit behind the card contents and fly outward once it lands. */}
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
              <Sparkles color={index % 2 ? colors.accent : colors.primaryBright} size={22} strokeWidth={2} />
            </Animated.View>
          ))}
        </View>

        <Pressable accessibilityLabel="Yopish" hitSlop={10} onPress={onClose} style={styles.close}>
          <X color={colors.inkMuted} size={18} strokeWidth={2} />
        </Pressable>

        <View style={styles.badge}><Gift color={colors.onPrimary} size={34} strokeWidth={1.9} /></View>
        <Text style={styles.title}>Tabriklaymiz!</Text>
        <Text style={styles.amount}>+{amount} tanga</Text>
        <Text style={styles.message}>{message}</Text>

        <Pressable onPress={onClose} style={styles.button}>
          <Text style={styles.buttonText}>Ajoyib</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: "rgba(21,14,36,.62)" },
  card: { width: "100%", maxWidth: 360, alignItems: "center", padding: spacing.xxl, borderRadius: radius.xl, backgroundColor: colors.surface, ...shadowLifted },
  burstLayer: { position: "absolute", top: "42%", left: "50%", width: 0, height: 0, alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", top: spacing.md, right: spacing.md, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  badge: { width: 82, height: 82, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  title: { ...typography.title, color: colors.ink, marginTop: spacing.lg },
  amount: { fontFamily: "Manrope_700Bold", fontSize: 34, color: colors.primary, marginTop: 2, letterSpacing: -0.5 },
  message: { ...typography.body, color: colors.inkMuted, textAlign: "center", marginTop: spacing.sm },
  button: { alignSelf: "stretch", height: 50, marginTop: spacing.xl, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  buttonText: { ...typography.bodyMedium, color: colors.onPrimary },
}));

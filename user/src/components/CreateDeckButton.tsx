import { LinearGradient } from "expo-linear-gradient";
import { ArrowUpRight, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";

import { colors, gradients, icon, radius, spacing, typography } from "@/theme/tokens";

/**
 * The one thing this screen is for, made to look like it.
 *
 * Making a deck was a button the same size and weight as importing one and as
 * presenting one, sitting third in a row of equals — so the action the whole
 * product exists for was something you had to find. This is deliberately not an
 * equal: full width, its own gradient, and a slow light that moves across it.
 *
 * The light is the part worth being careful about. A pulsing glow behind a
 * button is cheap to write and expensive to run: it is a shadow re-rasterised
 * every frame, and on a mid-range Android that is a visible cost for decoration.
 * So the movement is a translation of an already-composited layer, which the
 * compositor can do without touching the button, and it stops entirely when the
 * system asks for less motion.
 */

const SWEEP_MS = 2600;
const REST_MS = 3400;

export function CreateDeckButton({ onPress }: { onPress: () => void }) {
  const [still, setStill] = useState(false);
  const shift = useSharedValue(-1);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (alive) setStill(reduced);
    });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => { alive = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (still) {
      cancelAnimation(shift);
      shift.value = -1;
      return;
    }
    // A sweep, then a long pause. A light that never stops is a light nobody
    // stops noticing, and it is the pause that makes the movement read as
    // deliberate rather than as a loading state.
    shift.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS + REST_MS, easing: Easing.bezier(0.2, 0, 0.1, 1) }),
      -1,
      false,
    );
    return () => cancelAnimation(shift);
  }, [shift, still]);

  const sweep = useAnimatedStyle(() => ({
    // Past 1 the sweep has left the button; it waits there for the rest of the
    // cycle, which is the pause.
    transform: [{ translateX: Math.min(shift.value, 1) * 420 }, { rotate: "18deg" }],
    opacity: shift.value > 0.98 ? 0 : 0.5,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Taqdimot yaratish"
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.body}>
        {still ? null : <Animated.View pointerEvents="none" style={[styles.sweep, sweep]} />}

        <View style={styles.glyph}>
          <Sparkles color={colors.primary} size={icon.md} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Taqdimot yaratish</Text>
          <Text style={styles.detail}>Jaxongir AI bilan yangi slayd</Text>
        </View>
        <ArrowUpRight color={colors.onPrimary} size={icon.md} strokeWidth={icon.stroke} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.xl,
    // The lift is static. An animated shadow is a re-rasterisation every frame.
    ...Platform.select({
      ios: { shadowColor: colors.primary, shadowOpacity: 0.32, shadowRadius: 22, shadowOffset: { width: 0, height: 12 } },
      android: { elevation: 10 },
      default: {},
    }),
  },
  pressed: { transform: [{ scale: 0.985 }] },
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  sweep: {
    position: "absolute",
    top: -60,
    left: -180,
    width: 110,
    height: 260,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  glyph: {
    width: 42, height: 42, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.onPrimary,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: "700", fontSize: 18, color: colors.onPrimary },
  detail: { ...typography.caption, color: "rgba(255,255,255,0.8)" },
});

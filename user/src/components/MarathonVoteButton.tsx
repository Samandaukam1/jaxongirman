import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Vote } from "lucide-react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";

import { useMarathonEnabled } from "@/lib/marathon";
import { usePressScale, useReduceMotion } from "@/lib/motion";
import { gradients, brandInk, icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * The one vote button, drawn the same way on every screen that carries it.
 *
 * Four screens ask for it and four screens must not each invent one: a button
 * that is a pill on the home screen and a chip in the marketplace is two
 * buttons as far as a person is concerned, and they will learn neither. So the
 * geometry, the colour, the motion and the destination live here, and a screen
 * chooses only how much room it has.
 *
 * It is louder than an icon button and quieter than the app. The glow breathes
 * over three and a half seconds — slow enough to read as alive rather than as
 * an alert, and it stops entirely when the system asks for less motion, because
 * a slower version of what makes somebody ill is not an accommodation.
 */

type Props = {
  /** `compact` drops the label where a header has no room for it. */
  variant?: "full" | "compact";
};

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export function MarathonVoteButton({ variant = "full" }: Props) {
  const enabled = useMarathonEnabled();
  const styles = useStyles();
  const router = useRouter();
  const press = usePressScale();
  const reduceMotion = useReduceMotion();
  const glow = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(glow);
      glow.value = 0;
      return;
    }
    // Three and a half seconds, easing both ways: a breath rather than a blink.
    glow.value = withRepeat(
      withTiming(1, { duration: 1_750, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(glow);
  }, [glow, reduceMotion]);

  const aura = useAnimatedStyle(() => ({
    opacity: 0.18 + glow.value * 0.34,
    transform: [{ scale: 1 + glow.value * 0.06 }],
  }));

  if (!enabled) return null;

  return (
    <View style={styles.wrap}>
      {/* The aura sits behind the pill and never intercepts a touch. */}
      <Animated.View pointerEvents="none" style={[styles.aura, aura]} />
      <Animated.View style={press.style}>
        <AnimatedGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.pill, variant === "compact" && styles.pillCompact]}
        >
          <Animated.View
            {...press.handlers}
            accessibilityRole="button"
            accessibilityLabel="Ovoz berish"
            onTouchEnd={() => router.push("/(app)/marathon/vote")}
            style={styles.inner}
          >
            <Vote color={brandInk.strong} size={icon.sm} strokeWidth={icon.strokeBold} />
            {variant === "full" ? <Text style={styles.label}>Ovoz berish</Text> : null}
          </Animated.View>
        </AnimatedGradient>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { position: "relative", alignItems: "center", justifyContent: "center" },
  aura: {
    position: "absolute",
    left: -10, right: -10, top: -8, bottom: -8,
    borderRadius: radius.pill,
    backgroundColor: gradients.primary[0],
  },
  pill: { height: 40, borderRadius: radius.pill, justifyContent: "center" },
  pillCompact: { width: 40, paddingHorizontal: 0, alignItems: "center" },
  inner: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: 40, paddingHorizontal: spacing.md,
  },
  label: { ...typography.caption, fontFamily: "Manrope_600SemiBold", color: brandInk.strong },
}));

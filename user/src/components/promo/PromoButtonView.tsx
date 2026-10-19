import type { PromoButton } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowUpRight } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";

import { useReduceMotion } from "@/lib/motion";
import { radius, spacing } from "@/theme/tokens";

/** Relative luminance, enough to choose white or near-black ink for a fill. */
function inkFor(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.55 ? "#150E24" : "#FFFFFF";
}

/**
 * A button written in the console: a gradient, a solid colour or an outline,
 * with an optional glow.
 *
 * The glow is a halo of the button's own colour breathing behind it, and a
 * band of light that crosses its face every few seconds — slow enough to draw
 * the eye without turning the article into a slot machine. A system set to
 * reduce motion gets the halo standing still.
 */
export function PromoButtonView({ button, onPress }: { button: PromoButton; onPress: () => void }) {
  const reduced = useReduceMotion();
  const pulse = useSharedValue(0);
  const sweep = useSharedValue(0);
  const [from, to] = button.colors;
  const ink = button.fill === "outline" ? from : inkFor(from);

  useEffect(() => {
    if (!button.glow || reduced) {
      pulse.value = button.glow ? 0.6 : 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    sweep.value = withRepeat(
      // From just off the left edge to just past the right one, then a rest.
      withSequence(withTiming(0, { duration: 0 }), withTiming(3.5, { duration: 1600, easing: Easing.inOut(Easing.cubic) }), withTiming(3.5, { duration: 1800 })),
      -1,
      false,
    );
    return () => { cancelAnimation(pulse); cancelAnimation(sweep); };
  }, [button.glow, pulse, reduced, sweep]);

  const halo = useAnimatedStyle(() => ({
    opacity: 0.25 + pulse.value * 0.45,
    transform: [{ scaleX: 1 + pulse.value * 0.04 }, { scaleY: 1 + pulse.value * 0.18 }],
  }));
  const band = useAnimatedStyle(() => ({ transform: [{ translateX: `${sweep.value * 100}%` }, { skewX: "-20deg" }] }));

  const face = (
    <>
      <Text numberOfLines={1} style={[styles.label, { color: ink }]}>{button.label}</Text>
      {/^https?:\/\//i.test(button.url) ? <ArrowUpRight color={ink} size={18} strokeWidth={2.4} /> : null}
    </>
  );

  return (
    <View style={styles.wrap}>
      {button.glow ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.halo, { backgroundColor: from, shadowColor: from }, halo]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={button.label}
        onPress={onPress}
        style={({ pressed }) => [styles.press, pressed && styles.pressed]}
      >
        {button.fill === "gradient" ? (
          <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.base}>{face}</LinearGradient>
        ) : (
          <View style={[styles.base, button.fill === "solid" ? { backgroundColor: from } : [styles.outline, { borderColor: from }]]}>{face}</View>
        )}
        {button.glow && button.fill !== "outline" ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bandClip]}>
            <Animated.View style={[styles.band, band]}>
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.45)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch" },
  halo: {
    position: "absolute", left: 6, right: 6, top: 6, bottom: 6, borderRadius: radius.pill,
    shadowOpacity: 0.9, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  press: { borderRadius: radius.pill },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  base: {
    minHeight: 56, borderRadius: radius.pill, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, paddingHorizontal: spacing.xl, overflow: "hidden",
  },
  outline: { borderWidth: 2, backgroundColor: "transparent" },
  label: { fontFamily: "Manrope_800ExtraBold", fontSize: 16, letterSpacing: 0.2, flexShrink: 1 },
  bandClip: { borderRadius: radius.pill, overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0, left: "-40%", width: "40%" },
});

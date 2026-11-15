import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ChevronRight, Crown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing, FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";

import { gradients, radius, spacing } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * "Tarif oling" — offered once the free welcome decks are spent and there is
 * no plan (`needsPlan`). One quiet button in the app's own violet, not a
 * banner: it lives above the tab bar on a phone and in the side menu on a
 * desktop, and it moves just enough to be noticed — a slow breath, a soft
 * halo, a highlight passing over it now and then. With reduced motion turned
 * on in the system it keeps still.
 */
export function PlanNudge({ block = false }: { block?: boolean }) {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation("nav");
  const still = useReducedMotion();
  const [width, setWidth] = useState(0);

  const breath = useSharedValue(0);
  const sweep = useSharedValue(0);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (still) return;
    const ease = Easing.inOut(Easing.quad);
    breath.set(withRepeat(withTiming(1, { duration: 1600, easing: ease }), -1, true));
    sweep.set(withRepeat(withSequence(withDelay(2200, withTiming(1, { duration: 1100, easing: ease })), withTiming(0, { duration: 0 })), -1));
    tilt.set(withRepeat(withSequence(
      withDelay(3200, withTiming(1, { duration: 140 })), withTiming(-1, { duration: 200 }),
      withTiming(0.6, { duration: 160 }), withTiming(0, { duration: 180 }),
    ), -1));
  }, [breath, still, sweep, tilt]);

  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breath.get() * 0.025 }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + breath.get() * 0.35,
    transform: [{ scaleX: 1 + breath.get() * 0.06 }, { scaleY: 1 + breath.get() * 0.18 }],
  }));
  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sweep.get(), [0, 1], [-90, width + 30]) }, { rotate: "18deg" }],
  }));
  const crownStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.get() * 12}deg` }] }));

  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} style={[styles.wrap, block && styles.wrapBlock]} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <Animated.View style={[block && styles.fill, bodyStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("getPlan")}
          onPress={() => router.push("/(app)/tarif")}
          onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
          style={({ pressed }) => [styles.press, pressed && styles.pressed]}
        >
          <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.pill, block && styles.pillBlock]}>
            <Animated.View pointerEvents="none" style={[styles.shine, shineStyle]}>
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.42)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View style={styles.badge}>
              <Animated.View style={crownStyle}>
                <Crown color="#FFFFFF" size={15} strokeWidth={2.3} />
              </Animated.View>
            </View>
            <Text style={styles.label} numberOfLines={1}>{t("getPlan")}</Text>
            <ChevronRight color="rgba(255,255,255,0.85)" size={17} strokeWidth={2.4} />
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/** Height the floating button adds above the tab bar, for screens to leave room. */
export const PLAN_NUDGE_SPACE = 62;

const useStyles = makeStyles((colors) => ({
  wrap: { alignSelf: "center", alignItems: "center", justifyContent: "center" },
  wrapBlock: { alignSelf: "stretch" },
  fill: { alignSelf: "stretch" },
  halo: {
    position: "absolute", left: 10, right: 10, top: 6, bottom: 2, borderRadius: radius.pill,
    backgroundColor: colors.primary,
    ...Platform.select({
      web: { filter: "blur(14px)" },
      default: { shadowColor: colors.primary, shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
    }),
  },
  press: { borderRadius: radius.pill },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  pill: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    minHeight: 46, paddingLeft: 7, paddingRight: spacing.md, borderRadius: radius.pill, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  pillBlock: { justifyContent: "center" },
  shine: { position: "absolute", top: -20, bottom: -20, width: 46 },
  badge: {
    width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  label: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, lineHeight: 20, color: "#FFFFFF", letterSpacing: 0.1 },
}));

import type { Worth } from "@jaxongirman/tariff-card";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Award, Check, Crown, Gem, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated";

import { formatSom } from "@/lib/money";
import { withAlpha } from "@/theme/color";
import type { Metal, MetalName } from "@/theme/metals";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One tariff, as a tag hanging on a cord.
 *
 * Each plan is its own metal — bronze, silver, gold, cheapest to dearest — and
 * arrives its own way: it drops in on its cord and swings to rest, bronze
 * lightly, silver from the other side with a glint once it settles, gold
 * heavier and longer, with light running over its button for as long as it is
 * on screen. The metal is the edge, the medal, the price tag and the button;
 * the body of the card stays the app's own surface so three metals side by
 * side still read as one screen.
 *
 * The struck-through figure is `planWorth`: what the plan's J Tanga cost bought
 * as packages today. It is a price a buyer can check, never an invented one.
 */

const MEDAL: Record<MetalName, LucideIcon> = { bronze: Award, silver: Gem, gold: Crown };

/** How each metal comes in: where its swing starts, and how long it keeps swinging. */
const ARRIVAL: Record<MetalName, { angle: number; damping: number; mass: number }> = {
  bronze: { angle: -8, damping: 9, mass: 0.9 },
  silver: { angle: 11, damping: 7, mass: 1 },
  gold: { angle: -15, damping: 5, mass: 1.35 },
};

export const CORD = 30;

type Props = {
  name: string;
  subtitle: string;
  badge: string;
  metal: Metal;
  /** The price as a number, for the saving against `usual`. */
  priceAmount: number;
  amount: string;
  unit: string;
  worth: Worth | null;
  /** An admin-set "usual price", used instead of the worth when it is higher than the price. */
  usual: number | null;
  lines: { key: string; label: string }[];
  owned: boolean;
  cta: string | null;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
  onDetails: () => void;
  detailsLabel: string;
  /** Order on screen, so the tags arrive one after another. */
  index: number;
  style?: StyleProp<ViewStyle>;
};

export function TariffTag(props: Props) {
  const { metal, index } = props;
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation("wallet");
  const still = useReducedMotion();
  const arrival = ARRIVAL[metal.name];
  const Medal = MEDAL[metal.name];

  const drop = useSharedValue(still ? 0 : -220);
  const swing = useSharedValue(still ? 0 : arrival.angle);
  const seen = useSharedValue(still ? 1 : 0);
  const glint = useSharedValue(0);
  const glow = useSharedValue(0);
  const [buttonWidth, setButtonWidth] = useState(0);

  useEffect(() => {
    if (still) return;
    const delay = 120 + index * 240;
    seen.set(withDelay(delay, withTiming(1, { duration: 240 })));
    drop.set(withDelay(delay, withSpring(0, { damping: 15, stiffness: 150, mass: arrival.mass })));
    swing.set(withDelay(delay + 90, withSpring(0, { damping: arrival.damping, stiffness: 70, mass: arrival.mass })));
    const ease = Easing.inOut(Easing.quad);
    if (metal.name === "gold") {
      glint.set(withDelay(delay + 900, withRepeat(withSequence(
        withTiming(1, { duration: 1200, easing: ease }), withDelay(1600, withTiming(0, { duration: 0 })),
      ), -1)));
      glow.set(withDelay(delay + 600, withRepeat(withTiming(1, { duration: 1800, easing: ease }), -1, true)));
    } else if (metal.name === "silver") {
      glint.set(withDelay(delay + 1100, withTiming(1, { duration: 1100, easing: ease })));
    }
  }, [arrival, drop, glint, glow, index, metal.name, seen, still, swing]);

  const hangStyle = useAnimatedStyle(() => ({
    opacity: seen.get(),
    transform: [{ translateY: drop.get() }, { rotate: `${swing.get()}deg` }],
  }));
  const glintStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(glint.get(), [0, 1], [-120, buttonWidth + 40]) }, { rotate: "20deg" }],
  }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.25 + glow.get() * 0.45 }));

  const struck = props.usual ?? props.worth?.worth ?? null;
  const percent = props.usual
    ? Math.floor(((props.usual - props.priceAmount) / props.usual) * 100)
    : props.worth?.percent ?? null;

  return (
    <Animated.View style={[styles.hang, props.style, hangStyle]}>
      {/* The cord and the ring the tag hangs by. */}
      <View pointerEvents="none" style={styles.cordWrap}>
        <LinearGradient colors={metal.face} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.cord} />
        <View style={[styles.ring, { borderColor: metal.rim }]} />
      </View>

      {metal.name === "gold" ? (
        <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: metal.glow }, haloStyle]} />
      ) : null}

      <LinearGradient colors={metal.face} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.edge}>
        <View style={styles.card}>
          <LinearGradient
            pointerEvents="none"
            colors={[withAlpha(metal.face[1], 0.22), withAlpha(metal.face[1], 0)]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.wash}
          />

          <View style={styles.head}>
            <LinearGradient colors={metal.face} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={styles.medal}>
              <Medal color={metal.ink} size={20} strokeWidth={2.2} />
            </LinearGradient>
            <View style={styles.headCopy}>
              <Text style={styles.name} numberOfLines={1}>{props.name}</Text>
              {props.subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{props.subtitle}</Text> : null}
            </View>
          </View>

          {props.owned || props.badge ? (
            <View style={styles.tags}>
              {props.owned ? (
                <View style={[styles.tag, styles.tagOutlined, { borderColor: metal.rim }]}>
                  <Text style={[styles.tagText, { color: colors.ink }]}>{t("tariff.yours")}</Text>
                </View>
              ) : null}
              {props.badge ? (
                <LinearGradient colors={metal.face} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tag}>
                  <Text style={[styles.tagText, { color: metal.ink }]}>{props.badge}</Text>
                </LinearGradient>
              ) : null}
            </View>
          ) : null}

          <View style={styles.priceBlock}>
            {struck && percent && percent > 0 ? (
              <View style={styles.wasRow}>
                <Text style={styles.wasLabel}>{props.usual ? t("tariff.usual") : t("tariff.separately")}</Text>
                <Text style={styles.was}>{formatSom(struck)}</Text>
                <LinearGradient colors={metal.face} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.off}>
                  <Text style={[styles.offText, { color: metal.ink }]}>{t("tariff.off", { percent })}</Text>
                </LinearGradient>
              </View>
            ) : null}
            <View style={styles.priceRow}>
              <Text style={styles.price}>{props.amount}</Text>
              <Text style={styles.unit}>{props.unit}</Text>
            </View>
            {props.worth && !props.usual ? (
              <Text style={styles.save}>{t("tariff.saveMonthly", { amount: formatSom(props.worth.save) })}</Text>
            ) : null}
          </View>

          <View style={[styles.rule, { backgroundColor: withAlpha(metal.rim, 0.35) }]} />

          <View style={styles.lines}>
            {props.lines.map((line) => (
              <View key={line.key} style={styles.line}>
                <View style={[styles.tick, { backgroundColor: withAlpha(metal.rim, 0.18) }]}>
                  <Check color={metal.rim} size={12} strokeWidth={3.2} />
                </View>
                <Text style={styles.lineText}>{line.label}</Text>
              </View>
            ))}
          </View>

          {props.cta ? (
            <Pressable
              accessibilityRole="button"
              disabled={props.disabled}
              onPress={props.onBuy}
              onLayout={(event: LayoutChangeEvent) => setButtonWidth(event.nativeEvent.layout.width)}
              style={({ pressed }) => [styles.buyPress, { boxShadow: `0 10px 22px ${metal.glow}` }, pressed && styles.pressed, props.disabled && styles.dim]}
            >
              <LinearGradient colors={metal.face} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.buy}>
                <Animated.View pointerEvents="none" style={[styles.glint, glintStyle]}>
                  <LinearGradient
                    colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.7)", "rgba(255,255,255,0)"]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
                {props.busy ? (
                  <ActivityIndicator color={metal.ink} size="small" />
                ) : (
                  <>
                    <Text style={[styles.buyText, { color: metal.ink }]} numberOfLines={1}>{props.cta}</Text>
                    <ArrowRight color={metal.ink} size={18} strokeWidth={2.4} />
                  </>
                )}
              </LinearGradient>
            </Pressable>
          ) : null}

          <Pressable accessibilityRole="button" onPress={props.onDetails} style={styles.details}>
            <Text style={[styles.detailsText, { color: colors.primary }]}>{props.detailsLabel}</Text>
          </Pressable>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

/** The bar the tags hang from, across the top of the list. */
export function TariffRail() {
  const styles = useStyles();
  return (
    <View style={styles.rail}>
      <View style={styles.railCap} />
      <View style={styles.railBar} />
      <View style={styles.railCap} />
    </View>
  );
}

const RING = 18;

const useStyles = makeStyles((colors) => ({
  hang: { paddingTop: CORD, transformOrigin: "top" },
  cordWrap: { position: "absolute", top: 0, left: 0, right: 0, height: CORD + RING / 2, alignItems: "center", zIndex: 2 },
  cord: { width: 2, height: CORD - RING / 2 + 2, borderRadius: 1 },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 3.5, backgroundColor: colors.canvas, marginTop: -2 },
  halo: {
    position: "absolute", top: CORD + 10, left: 10, right: 10, bottom: -6, borderRadius: radius.xl,
    ...Platform.select({ web: { filter: "blur(22px)" }, default: {} }),
  },
  edge: { borderRadius: radius.lg + 2, padding: 1.6 },
  card: {
    borderRadius: radius.lg, backgroundColor: colors.surface, overflow: "hidden",
    padding: spacing.lg, paddingTop: spacing.xl, gap: spacing.md,
  },
  wash: { position: "absolute", top: 0, left: 0, right: 0, height: 150 },

  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  medal: {
    width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center",
    ...Platform.select({ web: {}, default: { borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" } }),
  },
  headCopy: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 22, lineHeight: 28, letterSpacing: 1.2, color: colors.ink },
  subtitle: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { paddingHorizontal: spacing.sm + 2, paddingVertical: 4, borderRadius: radius.pill },
  // Only the plain tag has an edge: a transparent border over a gradient shows
  // the gradient's far end repeated along it in a browser.
  tagOutlined: { borderWidth: 1, paddingVertical: 3, paddingHorizontal: spacing.sm + 1 },
  tagText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", fontSize: 11.5, letterSpacing: 0.3 },

  priceBlock: { gap: 4 },
  wasRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  wasLabel: { ...typography.caption, color: colors.inkSoft },
  was: { ...typography.caption, fontSize: 14, color: colors.inkMuted, textDecorationLine: "line-through" },
  off: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  offText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 12.5, letterSpacing: 0.2 },
  priceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: spacing.xs },
  price: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 40, lineHeight: 46, letterSpacing: -1.2, color: colors.ink },
  unit: { ...typography.bodyMedium, color: colors.inkMuted },
  save: { ...typography.caption, fontSize: 13, fontFamily: "JaxongirmanSans_700Bold", color: colors.success },

  rule: { height: 1, marginVertical: spacing.xs },
  lines: { gap: spacing.sm + 2 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  tick: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  lineText: { ...typography.body, fontSize: 14.5, lineHeight: 21, color: colors.ink, flex: 1 },

  buyPress: { marginTop: spacing.sm, borderRadius: radius.md },
  buy: {
    minHeight: 52, borderRadius: radius.md, overflow: "hidden",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.lg,
    // A light edge on the phone; a browser repeats the gradient under a
    // translucent border, which draws a dark line instead.
    ...Platform.select({ web: {}, default: { borderWidth: 1, borderColor: "rgba(255,255,255,0.55)" } }),
  },
  glint: { position: "absolute", top: -24, bottom: -24, width: 54 },
  buyText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 15.5, letterSpacing: 0.2 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  dim: { opacity: 0.6 },
  details: { alignSelf: "center", paddingVertical: spacing.xs },
  detailsText: { ...typography.caption, fontFamily: "JaxongirmanSans_600SemiBold" },

  rail: { flexDirection: "row", alignItems: "center", height: 10, marginHorizontal: spacing.sm },
  railCap: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.borderStrong },
  railBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, marginHorizontal: -2 },
}));

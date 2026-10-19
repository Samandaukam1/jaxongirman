import { LinearGradient } from "expo-linear-gradient";
import { BadgeCheck, CirclePlus, Crown, Gamepad2, HandCoins, Layers, Pencil, Share2, type LucideIcon } from "lucide-react-native";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Defs, FeGaussianBlur, Filter, G, Image as SvgImage, LinearGradient as SvgGradient, Mask, Rect, Stop } from "react-native-svg";
import Animated, {
  Easing, FadeIn, FadeInDown, FadeInLeft, ZoomIn, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withDelay,
  withRepeat, withSequence, withTiming, Extrapolation, type SharedValue,
} from "react-native-reanimated";

import coinIcon from "../../assets/coin/coin-icon.png";
import { usePressScale, useReduceMotion } from "@/lib/motion";
import { formatNumber } from "@/lib/money";
import { TIER_LOOK, type Tier } from "@/lib/tier";
import { radius, spacing } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

type Props = {
  name: string;
  handle: string;
  bio: string;
  study: string;
  avatarUrl: string | null;
  initials: string;
  tier: Tier;
  planName: string | null;
  decks: number;
  games: number;
  coins: number;
  onEdit: () => void;
  onSend: () => void;
  onTopUp: () => void;
  onShare: () => void;
  /** The screen's scroll offset: pulling past the top stretches the card. */
  scrollY?: SharedValue<number>;
};

/** The card's own corner; the metal rim is drawn outside it. */
const CARD_RADIUS = 32;
const RIM = 2.5;
/** The space either side of the card. */
const INSET = spacing.xl;
/** How far the text — name to figures — rises into the foot of the photograph. */
const OVERLAP = 134;
/** Entrance timing: the card first, then its lines in reading order. */
const ENTER = 90;

/**
 * Who you are here, the way a messenger draws a profile.
 *
 * The photograph is square and sharp at the top, then melts — through a
 * progressive blur — into a field of its own colours, blurred and darkened,
 * that runs to the foot of the card (see the drawing below for how). The name, the handle, the bio, the three
 * figures and a row of actions are all written on that field, so nothing sits
 * on a hard band or a flat panel. The plan is the frame: a rim, a badge and a
 * seal in its metal (see `lib/tier`), and on a paid plan a band of light that
 * crosses the card every few seconds.
 */
export function ProfileHeroCard(props: Props) {
  const { name, handle, bio, study, avatarUrl, initials, tier, planName, decks, games, coins, onEdit, onSend, onTopUp, onShare, scrollY } = props;
  const styles = useStyles();
  const { t } = useTranslation("profile");
  const { width } = useWindowDimensions();
  const reduced = useReduceMotion();
  const look = TIER_LOOK[tier];
  const [side, setSide] = useState(Math.min(width, 520) - INSET * 2 - RIM * 2);
  const [cardHeight, setCardHeight] = useState(side * 1.6);
  // The drawing reaches past the card's foot by a little, so a card that grows
  // by a line between two measurements never shows an undrawn strip.
  const field = Math.max(cardHeight, side) + 40;
  // SVG ids are document-wide on the web; two cards must not share a filter.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  const sweep = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!look.shines || reduced) return;
    sweep.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 0 }),
        withDelay(900, withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.cubic) })),
        withTiming(1, { duration: 2600 }),
      ),
      -1,
      false,
    );
    glow.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => { cancelAnimation(sweep); cancelAnimation(glow); };
  }, [glow, look.shines, reduced, sweep]);

  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -side * 0.6 + sweep.value * side * 2.2 }, { rotate: "18deg" }],
  }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.35 + glow.value * 0.35 }));

  /**
   * Pulling the screen down past its top stretches the card like a rubber
   * band: the card grows a little from its top edge and the photograph inside
   * it zooms further, then both settle back with the scroll's own spring.
   */
  const pullStyle = useAnimatedStyle(() => {
    const pull = Math.max(0, -(scrollY?.value ?? 0));
    return { transform: [{ scale: interpolate(pull, [0, 240], [1, 1.08], Extrapolation.CLAMP) }] };
  });
  const zoomStyle = useAnimatedStyle(() => {
    const y = scrollY?.value ?? 0;
    const pull = Math.max(0, -y);
    return {
      transform: [
        // Scrolled up, the picture drifts at a quarter of the speed: depth.
        { translateY: y > 0 ? Math.min(y, side) * 0.25 : 0 },
        { scale: interpolate(pull, [0, 240], [1, 1.35], Extrapolation.CLAMP) },
      ],
    };
  });

  const stats = [
    { key: "decks", value: formatNumber(decks), label: t("stats.decks"), glyph: <Layers color="#FFFFFF" size={15} strokeWidth={2.2} /> },
    { key: "games", value: formatNumber(games), label: t("stats.games"), glyph: <Gamepad2 color="#FFFFFF" size={15} strokeWidth={2.2} /> },
    { key: "coins", value: formatNumber(coins), label: t("stats.coins"), glyph: <Image source={coinIcon} style={styles.coin} resizeMode="contain" /> },
  ];

  const actions: { key: string; label: string; glyph: LucideIcon; onPress: () => void }[] = [
    { key: "edit", label: t("actions.edit"), glyph: Pencil, onPress: onEdit },
    { key: "send", label: t("actions.send"), glyph: HandCoins, onPress: onSend },
    { key: "topUp", label: t("actions.topUp"), glyph: CirclePlus, onPress: onTopUp },
    { key: "share", label: t("actions.share"), glyph: Share2, onPress: onShare },
  ];

  return (
    <Animated.View
      entering={FadeInDown.duration(520).springify().damping(17)}
      style={styles.outer}
      onLayout={(event) => setSide(event.nativeEvent.layout.width - RIM * 2)}
    >
      <Animated.View style={[styles.pull, pullStyle]}>
      {/* The glow of the metal round the card, breathing on a paid plan. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { shadowColor: look.glow, backgroundColor: look.glow }, look.shines ? haloStyle : styles.haloStill]}
      />
      <LinearGradient colors={look.metal} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rim}>
        <View style={[styles.card, { backgroundColor: look.deep }]} onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}>
          {/* ------------------------------------- photograph and field */}
          {/* One drawing, so the picture and what it melts into cannot meet at
              a seam. The sharp photograph fills the square at the top. Over it,
              a blurred copy fades in through a gradient mask — a true
              progressive blur, not steps. Below the square the blurred copy
              continues as the photograph's own reflection, which matches it
              row for row at the edge, and a wash of the plan's deep tone keeps
              the text on it legible. */}
          {avatarUrl ? (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.zoom, zoomStyle]}>
            <Svg width={side} height={field}>
              <Defs>
                <Filter id={`${id}blur`} x="-20%" y="-20%" width="140%" height="140%">
                  <FeGaussianBlur stdDeviation={22} />
                </Filter>
                <SvgGradient id={`${id}fadeStops`} x1="0" y1={side * 0.34} x2="0" y2={side * 0.9} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={1} />
                </SvgGradient>
                <Mask id={`${id}fade`} maskUnits="userSpaceOnUse" x="0" y="0" width={side} height={field}>
                  <Rect x="0" y="0" width={side} height={field} fill={`url(#${id}fadeStops)`} />
                </Mask>
                <SvgGradient id={`${id}tint`} x1="0" y1={side * 0.38} x2="0" y2={field} gradientUnits="userSpaceOnUse">
                  <Stop offset="0" stopColor={look.deep} stopOpacity={0} />
                  <Stop offset={String(Math.min(0.95, (side * 0.62) / Math.max(field - side * 0.38, 1)))} stopColor={look.deep} stopOpacity={0.6} />
                  <Stop offset="1" stopColor={look.deep} stopOpacity={0.86} />
                </SvgGradient>
              </Defs>
              <Rect x="0" y="0" width={side} height={field} fill={look.deep} />
              <SvgImage href={{ uri: avatarUrl }} x="0" y="0" width={side} height={side} preserveAspectRatio="xMidYMid slice" />
              <G mask={`url(#${id}fade)`}>
                <G filter={`url(#${id}blur)`}>
                  {/* Drawn wider than the card, so the blur has picture to
                      reach for at the edges instead of fading to nothing. */}
                  <SvgImage href={{ uri: avatarUrl }} x={-side * 0.12} y="0" width={side * 1.24} height={side} preserveAspectRatio="xMidYMid slice" />
                  <G transform={`translate(0 ${side * 2}) scale(1 -1)`}>
                    <SvgImage href={{ uri: avatarUrl }} x={-side * 0.12} y="0" width={side * 1.24} height={side} preserveAspectRatio="xMidYMid slice" />
                  </G>
                </G>
              </G>
              <Rect x="0" y="0" width={side} height={field} fill={`url(#${id}tint)`} />
            </Svg>
            </Animated.View>
          ) : (
            <LinearGradient colors={["#8B54E8", "#3F1780", look.deep]} locations={[0, 0.45, 1]} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
          )}

          <View style={{ width: side, height: side }}>
            {avatarUrl ? null : (
              <View style={[StyleSheet.absoluteFill, styles.empty]}>
                <Text style={styles.initials}>{initials || "J"}</Text>
              </View>
            )}
            {/* A light wash at the top so the badge reads on a bright sky. */}
            <LinearGradient pointerEvents="none" colors={["rgba(0,0,0,0.32)", "rgba(0,0,0,0)"]} style={styles.topShade} />

            {/* A badge, not a button: the tariff is reached from its one
                Sozlamalar row (see tests/profile-screen). */}
            <Animated.View entering={FadeInLeft.delay(ENTER * 3).duration(420)} style={styles.badgeSlot}>
            <LinearGradient colors={look.metal} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
              <Crown color={look.onMetal} size={13} strokeWidth={2.6} />
              <Text numberOfLines={1} style={[styles.badgeText, { color: look.onMetal }]}>
                {tier === "free" ? t("tier.free") : `${planName ?? ""} · ${t(`tier.${tier}`)}`}
              </Text>
            </LinearGradient>
            </Animated.View>
          </View>

          {/* ------------------------------------------- the person */}
          {/* Each line arrives a beat after the one above it, in reading order. */}
          <View style={[styles.body, { marginTop: -OVERLAP }]}>
            {/* The seal rides at the end of the name's last line, so a name
                that wraps does not leave it stranded at the card's edge. */}
            <Animated.View entering={FadeInDown.delay(ENTER * 2).duration(420)}>
              <Text style={styles.name} numberOfLines={2}>
                {name}
                {tier !== "free" ? (
                  <>
                    {" "}
                    <View style={styles.sealBox}>
                      <BadgeCheck color={look.onMetal} fill={look.metal[1]} size={18} strokeWidth={2} />
                    </View>
                  </>
                ) : null}
              </Text>
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(ENTER * 3).duration(420)}>
              <Text style={styles.handle} numberOfLines={1}>{handle}</Text>
            </Animated.View>
            {bio ? (
              <Animated.View entering={FadeInDown.delay(ENTER * 4).duration(420)}>
                <Text style={styles.bio} numberOfLines={3}>{bio}</Text>
              </Animated.View>
            ) : null}
            {study ? (
              <Animated.View entering={FadeIn.delay(ENTER * 4).duration(420)}>
                <Text style={styles.study} numberOfLines={1}>{study}</Text>
              </Animated.View>
            ) : null}

            <Animated.View entering={FadeInDown.delay(ENTER * 5).duration(460).springify().damping(18)} style={styles.stats}>
              {stats.map((stat, index) => (
                <View key={stat.key} style={[styles.stat, index > 0 && styles.statRule]}>
                  <View style={styles.statValueRow}>
                    {stat.glyph}
                    <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{stat.value}</Text>
                  </View>
                  <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
                </View>
              ))}
            </Animated.View>

            {/* Four equal tiles of frosted glass, icon over word — the row a
                messenger puts under a profile. They pop in one after another
                and give under a finger like a spring. */}
            <View style={styles.actions}>
              {actions.map(({ key, label, glyph, onPress }, index) => (
                <ActionTile key={key} label={label} glyph={glyph} onPress={onPress} delay={ENTER * 6 + index * 55} />
              ))}
            </View>
          </View>

          {look.shines ? (
            <Animated.View pointerEvents="none" style={[styles.band, { height: cardHeight * 1.6, top: -cardHeight * 0.3 }, bandStyle]}>
              <LinearGradient
                colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.16)", "rgba(255,255,255,0)"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
        </View>
      </LinearGradient>
      </Animated.View>
    </Animated.View>
  );
}

/** One frosted tile: springs in on arrival, springs under a press. */
function ActionTile({ label, glyph: Glyph, onPress, delay }: { label: string; glyph: LucideIcon; onPress: () => void; delay: number }) {
  const styles = useStyles();
  const press = usePressScale();
  return (
    <Animated.View entering={ZoomIn.delay(delay).springify().damping(14)} style={styles.actionSlot}>
      <Animated.View style={[styles.action, press.style]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          onPressIn={press.handlers.onPressIn}
          onPressOut={press.handlers.onPressOut}
          style={styles.actionHit}
        >
          <Glyph color="#FFFFFF" size={19} strokeWidth={2} />
          <Text style={styles.actionText} numberOfLines={1}>{label}</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const useStyles = makeStyles(() => ({
  outer: { marginHorizontal: INSET },
  // Grows from its top edge, so a pull stretches the card downwards.
  pull: { transformOrigin: "top" },
  zoom: { transformOrigin: "top" },
  halo: {
    position: "absolute", left: 18, right: 18, top: 30, bottom: 6, borderRadius: CARD_RADIUS,
    shadowOpacity: 0.85, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 16,
  },
  haloStill: { opacity: 0.3 },
  rim: { borderRadius: CARD_RADIUS + RIM, padding: RIM },
  card: { borderRadius: CARD_RADIUS, overflow: "hidden" },
  empty: { alignItems: "center", justifyContent: "center" },
  initials: { fontFamily: "Manrope_800ExtraBold", fontSize: 88, color: "rgba(255,255,255,0.9)", letterSpacing: 2, marginBottom: 120 },
  topShade: { position: "absolute", top: 0, left: 0, right: 0, height: 110 },
  band: { position: "absolute", left: 0, width: 90 },

  badgeSlot: { position: "absolute", top: spacing.lg, left: spacing.lg },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, maxWidth: 230,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.55)",
  },
  badgeText: { fontFamily: "Manrope_800ExtraBold", fontSize: 11.5, letterSpacing: 0.6, flexShrink: 1 },

  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 2 },
  name: {
    fontFamily: "Manrope_800ExtraBold", fontSize: 23, lineHeight: 27, letterSpacing: -0.4, color: "#FFFFFF",
    textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 12, textShadowOffset: { width: 0, height: 1 },
  },
  // Lifted onto the letters' middle: an inline view sits on the baseline.
  sealBox: { width: 19, height: 19, transform: [{ translateY: 3 }] },
  handle: { fontFamily: "Manrope_600SemiBold", fontSize: 13, lineHeight: 17, color: "rgba(255,255,255,0.78)" },
  bio: { fontFamily: "Manrope_500Medium", fontSize: 13.5, lineHeight: 18, color: "rgba(255,255,255,0.94)", marginTop: 3 },
  study: { fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 16, color: "rgba(255,255,255,0.7)" },

  stats: {
    flexDirection: "row", marginTop: spacing.sm + 2, paddingVertical: spacing.sm, borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.16)",
  },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: 6 },
  statRule: { borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.14)" },
  statValueRow: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  statValue: { fontFamily: "Manrope_800ExtraBold", fontSize: 16, lineHeight: 21, color: "#FFFFFF", flexShrink: 1, fontVariant: ["tabular-nums"] },
  statLabel: { fontFamily: "Manrope_600SemiBold", fontSize: 10.5, lineHeight: 14, color: "rgba(255,255,255,0.7)" },
  coin: { width: 15, height: 15 },

  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionSlot: { flex: 1 },
  action: {
    height: 54, borderRadius: 15, overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  actionHit: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  actionText: { fontFamily: "Manrope_700Bold", fontSize: 11, lineHeight: 14, color: "rgba(255,255,255,0.92)", paddingHorizontal: 2 },
}));

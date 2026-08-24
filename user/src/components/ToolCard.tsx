import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo, type FC } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Path, type SvgProps } from "react-native-svg";

import { Touchable } from "@/components/Touchable";
import { withAlpha } from "@/theme/color";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One tool on Loyihalar: a piece of artwork on a card lit by its own colour.
 *
 * The cards used to be five saturated gradients, one hue each, which made a
 * screen that shouted six things at once; the colour was moved into the drawings
 * and the ground under them became one flat near-white for all six. That was
 * right about the shouting and a step too far about the ground: six identical
 * grey rectangles is a control panel, not something a person wants to touch.
 *
 * So the ground is built out of the drawing instead of against it. Every card
 * takes a `tint` sampled from its own artwork (`toolTint`) and spends it three
 * times, never above a fifth of an alpha: a diagonal wash that runs from a white
 * highlight at the top-left down into the hue, a plate under the artwork so the
 * drawing sits in its own light rather than on bare card, and the hairline and
 * the cast shadow, both tinted so the edge and the lift agree with what is drawn
 * on top. The row still reads as one system — one corner, one type, one lift —
 * and each card is now the colour of the thing it makes.
 *
 * `art` is one of the icons in `assets/icons`, compiled from its SVG.
 */

export type ToolArt = FC<SvgProps>;

/**
 * How far the artwork shrinks as the page scrolls, as a fraction of the way
 * through the fold. Handed in rather than read here so every card on the screen
 * moves off one shared value instead of subscribing to the scroll six times.
 */
type Progress = SharedValue<number>;

const SHRINK_TO = 0.84;
const FADE_TO = 0.94;
const RISE_TO = -3;

function useArtStyle(progress: Progress) {
  return useAnimatedStyle(() => ({
    transform: [{ scale: 1 - progress.value * (1 - SHRINK_TO) }, { translateY: progress.value * RISE_TO }],
    opacity: 1 - progress.value * (1 - FADE_TO),
  }));
}

/**
 * What one tint is worth on the card, in both themes.
 *
 * The alphas differ by theme rather than the hue doing: the same violet laid on
 * a near-white card and on a near-black one is two different pictures, and a
 * wash strong enough to be felt at midnight is a stain at noon. Everything a
 * card needs from its colour is decided once, here, so a tile and the hero
 * cannot drift apart by being tuned separately.
 */
type Skin = {
  /**
   * The card's ground: the hue at its strongest where the artwork sits, spent
   * by not quite halfway across, and clearing to a highlight at the far end.
   *
   * It runs that way round because of the words. Pooling the colour at the
   * bottom of the card is the prettier gradient in isolation and puts its
   * deepest stop exactly under an 11pt caption — on the orange and the teal
   * that costs about a point of contrast the caption did not have to spare.
   * Blooming it off the drawing instead gives the colour to the half of the
   * card that has no type on it, and leaves the type on near-white.
   */
  wash: readonly [string, string, string];
  /** The plate the artwork sits on. */
  plate: readonly [string, string];
  rim: string;
  lift: ViewStyle;
  /** The round ground behind the hero's arrow. */
  chip: string;
};

function useSkin(tint: string): Skin {
  const { scheme } = useTheme();

  return useMemo<Skin>(() => {
    const night = scheme === "dark";
    return {
      wash: night
        ? [withAlpha(tint, 0.3), withAlpha(tint, 0.09), "rgba(255,255,255,0.05)"]
        : [withAlpha(tint, 0.22), withAlpha(tint, 0.06), "rgba(255,255,255,0.85)"],
      plate: night
        ? [withAlpha(tint, 0.3), withAlpha(tint, 0.08)]
        : [withAlpha(tint, 0.2), withAlpha(tint, 0.04)],
      rim: withAlpha(tint, night ? 0.32 : 0.24),
      chip: withAlpha(tint, night ? 0.24 : 0.13),
      // The lift is the hue too. A grey shadow under a violet card is the tell
      // of a card that was coloured after it was built.
      lift: Platform.select<ViewStyle>({
        ios: { shadowColor: tint, shadowOpacity: night ? 0.3 : 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } },
        android: { elevation: 2 },
        default: {},
      }) as ViewStyle,
    };
  }, [scheme, tint]);
}

/** A press should be felt as well as seen, once, and lightly. */
const tap = () => {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

/**
 * The "opens something" mark on the hero.
 *
 * Drawn here rather than taken from an icon set: this screen's whole point is
 * its own artwork, and one glyph in somebody else's stroke weight next to it is
 * the mark that looks borrowed. Two rotated views could not do it — a rotated
 * border box draws a rhombus, not an arrowhead.
 */
const Arrow = memo(function Arrow({ tint }: { tint: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 20 20">
      <Path
        d="M6 14L14 6M14 6H7.5M14 6v6.5"
        stroke={tint}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
});

/**
 * The artwork on its plate, shrinking with the fold as one piece.
 *
 * The plate scales with the drawing rather than staying put under it: a halo
 * that holds its size while the thing it belongs to shrinks reads as two
 * objects, and this is meant to read as the drawing's own light.
 */
const Art = memo(function Art({
  art: Drawing, size, pad, skin, progress,
}: { art: ToolArt; size: number; pad: number; skin: Skin; progress: Progress }) {
  const styles = useStyles();
  const artStyle = useArtStyle(progress);

  return (
    // The artwork never takes the touch — the whole card is the target.
    <Animated.View pointerEvents="none" style={[styles.art, { padding: pad }, artStyle]}>
      <LinearGradient
        colors={skin.plate}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={[StyleSheet.absoluteFill, styles.plate]}
      />
      {/* A square box against a square viewBox, and the artwork's own
          `preserveAspectRatio="xMidYMid meet"` does the rest: centred, whole,
          and never stretched to fill. */}
      <Drawing width={size} height={size} />
    </Animated.View>
  );
});

/**
 * The wash is the card's ground, so it sits under everything else on it.
 *
 * It runs the way the card is laid out: down a tile, which has its drawing at
 * the top, and across the hero, which has its drawing at the left. Either way
 * the colour starts at the artwork and clears by the time it reaches the words.
 */
const Wash = memo(function Wash({ skin, across }: { skin: Skin; across?: boolean }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={skin.wash}
      locations={[0, 0.45, 1]}
      start={across ? { x: 0, y: 0.15 } : { x: 0.2, y: 0 }}
      end={across ? { x: 1, y: 0.85 } : { x: 0.8, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
});

type CardProps = {
  art: ToolArt;
  size: number;
  title: string;
  detail: string;
  /** The hue this card is lit by — one of `toolTint`, sampled from the art. */
  tint: string;
  onPress: () => void;
  progress: Progress;
  style?: StyleProp<ViewStyle>;
};

/**
 * The wide one at the top: artwork left, words in the middle, arrow at the end.
 */
export const HeroToolCard = memo(function HeroToolCard({
  art, size, title, detail, tint, onPress, progress, style,
}: CardProps) {
  const styles = useStyles();
  const skin = useSkin(tint);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => { tap(); onPress(); }}
      style={[styles.card, styles.hero, { borderColor: skin.rim }, skin.lift, style]}
    >
      <Wash skin={skin} across />
      <Art art={art} size={size} pad={spacing.xs} skin={skin} progress={progress} />
      <View style={styles.heroCopy}>
        <Text numberOfLines={1} style={styles.heroTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
      {/* The arrow gets a ground of its own so the hero ends on something that
          looks pressable, rather than on a glyph floating at the margin. */}
      <View style={[styles.arrowChip, { backgroundColor: skin.chip }]}>
        <Arrow tint={tint} />
      </View>
    </Touchable>
  );
});

/**
 * The ones in the rows below: artwork above, words under it.
 *
 * Same card, same corner, same padding, same type — the only difference from
 * the hero is that the layout stacks, because three of these across a phone
 * have no width to put words beside a drawing.
 */
export const ToolCard = memo(function ToolCard({
  art, size, title, detail, tint, onPress, progress, style,
}: CardProps) {
  const styles = useStyles();
  const skin = useSkin(tint);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => { tap(); onPress(); }}
      style={[styles.card, styles.tile, { borderColor: skin.rim }, skin.lift, style]}
    >
      <Wash skin={skin} />
      <Art art={art} size={size} pad={3} skin={skin} progress={progress} />
      <View style={styles.tileCopy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
    </Touchable>
  );
});

const useStyles = makeStyles((colors) => ({
  /**
   * One card, two sizes. Everything that makes it a card — the ground, the
   * hairline, the corner — is stated once here, and the variants below only
   * ever change how the contents are arranged. The colour of the hairline and
   * the shadow come from the skin, because they belong to the tool rather than
   * to the card.
   *
   * `overflow: hidden` is what keeps the wash inside the corner: a gradient
   * laid across the whole box would otherwise square off the card's rounding.
   * It clips children only — the cast shadow is drawn outside the layer and
   * survives it.
   */
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.softCard,
    borderWidth: 1,
    overflow: "hidden",
  },

  art: { alignItems: "center", justifyContent: "center" },
  plate: { borderRadius: radius.md },

  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
  },
  heroCopy: { flex: 1, gap: 2 },
  heroTitle: { ...typography.bodyMedium, fontSize: 17, color: colors.softInk },
  arrowChip: {
    width: 38, height: 38, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
  },

  tile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tileCopy: { alignItems: "center", gap: 1 },
  title: { ...typography.caption, fontSize: 13, fontWeight: "600", color: colors.softInk },
  detail: { ...typography.caption, fontSize: 11, color: colors.softInkMuted },
}));

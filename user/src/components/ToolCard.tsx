import * as Haptics from "expo-haptics";
import { memo, type FC } from "react";
import { Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Path, type SvgProps } from "react-native-svg";

import { Touchable } from "@/components/Touchable";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One tool on Loyihalar: a quiet card with a piece of artwork on it.
 *
 * The cards used to be five saturated gradients, one hue each, which made a
 * screen that shouted six things at once. The colour lives in the artwork now
 * and the card underneath is the same cool near-white for all of them — so the
 * row reads as one system, and what tells the tools apart is the drawing rather
 * than the background it sits on.
 *
 * `art` is one of the icons in `assets/icons`, compiled from its SVG. The card
 * under it is deliberately quieter than the artwork on it — a cool near-white
 * ground and a hairline — so the two read as one object rather than as a
 * picture pasted onto a button.
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

type CardProps = {
  art: ToolArt;
  size: number;
  title: string;
  detail: string;
  onPress: () => void;
  progress: Progress;
  style?: StyleProp<ViewStyle>;
};

/**
 * The wide one at the top: artwork left, words in the middle, arrow at the end.
 */
export const HeroToolCard = memo(function HeroToolCard({
  art: Art, size, title, detail, onPress, progress, style,
}: CardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const artStyle = useArtStyle(progress);
  const arrowTint = colors.softInkMuted;

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => { tap(); onPress(); }}
      style={[styles.card, styles.hero, style]}
    >
      {/* The artwork never takes the touch — the whole card is the target. */}
      <Animated.View pointerEvents="none" style={artStyle}>
        {/* A square box against a square viewBox, and the artwork's own
            `preserveAspectRatio="xMidYMid meet"` does the rest: centred, whole,
            and never stretched to fill. */}
        <Art width={size} height={size} />
      </Animated.View>
      <View style={styles.heroCopy}>
        <Text numberOfLines={1} style={styles.heroTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
      <Arrow tint={arrowTint} />
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
  art: Art, size, title, detail, onPress, progress, style,
}: CardProps) {
  const styles = useStyles();
  const artStyle = useArtStyle(progress);

  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => { tap(); onPress(); }}
      style={[styles.card, styles.tile, style]}
    >
      <Animated.View pointerEvents="none" style={artStyle}>
        <Art width={size} height={size} />
      </Animated.View>
      <View style={styles.tileCopy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
      </View>
    </Touchable>
  );
});

const useStyles = makeStyles((colors) => ({
  /**
   * One card, three sizes. Everything that makes it a card — the ground, the
   * hairline, the corner, the lift — is stated once here, and the variants
   * below only ever change how the contents are arranged.
   */
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.softCard,
    borderWidth: 1,
    borderColor: colors.softCardBorder,
    // Barely there. The card is separated from the canvas by its own tone;
    // the shadow is for depth, not for the edge.
    ...Platform.select({
      ios: { shadowColor: "#1A1B2E", shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
      android: { elevation: 1 },
      default: {},
    }),
  },

  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
  },
  heroCopy: { flex: 1, gap: 2 },
  heroTitle: { ...typography.bodyMedium, fontSize: 17, color: colors.softInk },


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

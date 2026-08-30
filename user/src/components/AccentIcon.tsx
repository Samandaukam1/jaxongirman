import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import type { FC } from "react";
import { Image, Platform, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from "react-native";
import type { SvgProps } from "react-native-svg";

import { withAlpha } from "@/theme/color";
import { accents, brandInk, type AccentName } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One icon, on a plate of its own colour.
 *
 * Profil was a column of identical violet outlines — a crown, a shop, a wallet
 * and a receipt all drawn in one hue at one weight, which is a list you read by
 * counting rows rather than by looking at it. This is what replaced them: the
 * glyph keeps its meaning, the plate under it carries the hue, and the row
 * becomes scannable without any of it turning into neon. The colour is spent on
 * forty points of tile and stops there.
 *
 * Three kinds of thing can sit on the plate, and the plate changes to suit:
 *
 * - `glyph` — a Lucide icon, drawn white on the accent's own gradient. This is
 *   the premium tile: a saturated ground, a highlight raking across the top and
 *   a shadow tinted the same hue, so it reads as an object with a light on it
 *   rather than a coloured square.
 * - `art` — one of `assets/icons`, the drawings Loyihalar already uses. These
 *   arrive with their own colour and their own light, so they get the opposite
 *   treatment: a quiet tinted plate to sit in, exactly as `ToolCard` gives them.
 *   Laying a drawing on a saturated gradient would fight it.
 * - `image` — a raster with the same story. The J Tanga coin is the only one.
 *
 * The two grounds are the point of putting all three in one component: a stat
 * row mixing a drawing, a photograph of a coin and a Lucide glyph has to come
 * out at one optical size on one footprint, or it reads as three things that
 * happened to end up next to each other.
 */

type Props = {
  accent: AccentName;
  /** The footprint. Everything inside is derived from it. */
  size?: number;
  glyph?: LucideIcon;
  art?: FC<SvgProps>;
  image?: ImageSourcePropType;
  /**
   * Sitting on the brand gradient rather than on a card.
   *
   * A tinted plate is mixed against the app's canvas, which is the wrong ground
   * inside the hero — there it has violet behind it, not white, and the tint
   * comes out as a grey smudge. On the hero the plate is white glass instead.
   */
  onBrand?: boolean;
  style?: ViewStyle;
};

/** Icons read at roughly half their tile; drawings need most of it. */
const GLYPH_SHARE = 0.5;
const ART_SHARE = 0.74;

export function AccentIcon({ accent, size = 40, glyph: Glyph, art: Art, image, onBrand = false, style }: Props) {
  const { scheme } = useTheme();
  const styles = useStyles();
  const [light, deep] = accents[accent];
  const night = scheme === "dark";
  const frame: ViewStyle = { width: size, height: size, borderRadius: Math.round(size * 0.32) };

  /**
   * The lift under a coloured tile is that colour, never grey.
   *
   * It is also softer at night: a dark canvas conveys height by lightening the
   * surface, and a shadow that is trying hard on near-black only muddies the
   * card it is sitting on.
   */
  const lift = Platform.select({
    ios: { shadowColor: deep, shadowOpacity: night ? 0.28 : 0.34, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 3 },
    default: {},
  });

  if (Art || image) {
    // The drawing's own light, brought down to a wash it can sit in.
    const plate = onBrand
      ? styles.glassPlate
      : { backgroundColor: withAlpha(light, night ? 0.2 : 0.13) };
    const inner = Math.round(size * ART_SHARE);
    return (
      <View style={[styles.center, frame, plate, style]}>
        {Art ? <Art width={inner} height={inner} /> : null}
        {image ? <Image source={image} style={{ width: inner, height: inner }} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[light, deep]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.center, frame, lift, style]}
    >
      {/* A highlight raking the top edge — what separates a lit object from a
          coloured rectangle. Pointer-transparent and never more than a tenth. */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(255,255,255,0.34)", "rgba(255,255,255,0)"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.7, y: 0.9 }}
        style={[StyleSheet.absoluteFill, { borderRadius: frame.borderRadius }]}
      />
      {Glyph ? <Glyph color={brandInk.strong} size={Math.round(size * GLYPH_SHARE)} strokeWidth={2.15} /> : null}
    </LinearGradient>
  );
}

const useStyles = makeStyles(() => ({
  center: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  glassPlate: { backgroundColor: "rgba(255,255,255,0.20)", borderWidth: 1, borderColor: "rgba(255,255,255,0.26)" },
}));

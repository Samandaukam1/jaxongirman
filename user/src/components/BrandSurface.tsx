import { LinearGradient } from "expo-linear-gradient";
import { useId, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { gradients } from "@/theme/tokens";

/**
 * The brand as a surface: the balance card on Bosh sahifa and the banner on Profil.
 *
 * The flat violet sweep these replaced was one saturated colour running from a
 * bright corner to a dark one, which reads as a fill rather than a material.
 * This is a deep base lit from two sides — a lilac light falling from the upper
 * right, a cooler indigo one rising from the lower left — with a few hairline
 * rings round the lit corner, a sheen along the top edge and a fine rim. Each
 * of those is faint on its own; together they are what makes it look made.
 *
 * The light is drawn in points, measured from the surface itself, so a radial
 * glow stays round whatever the card's proportions are.
 */

const LILAC = "#A47BFF";
const INDIGO = "#3C60F5";
/** The rings round the lit corner, as shares of the surface's width, faintest last. */
const RINGS = [
  { reach: 0.44, opacity: 0.1 },
  { reach: 0.62, opacity: 0.07 },
  { reach: 0.8, opacity: 0.045 },
] as const;

type Props = {
  radius: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function BrandSurface({ radius, style, children }: Props) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  // SVG ids are document-wide on the web; two surfaces must not share a glow.
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");

  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((current) => (current.width === width && current.height === height ? current : { width, height }));
  };

  const { width, height } = box;
  const diagonal = Math.hypot(width, height);

  return (
    <View onLayout={measure} style={[styles.lift, { borderRadius: radius, backgroundColor: gradients.surface[1] }, style]}>
      {/* The shadow lives on the outer view; this one clips the light to the corners. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
        <LinearGradient
          colors={gradients.surface}
          locations={[0, 0.42, 1]}
          start={{ x: 0.12, y: 0 }}
          end={{ x: 0.88, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {width > 0 ? (
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id={`${id}lit`} cx={width * 0.96} cy={0} r={diagonal * 0.58} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={LILAC} stopOpacity={0.5} />
                <Stop offset="1" stopColor={LILAC} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id={`${id}cool`} cx={0} cy={height} r={diagonal * 0.55} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={INDIGO} stopOpacity={0.36} />
                <Stop offset="1" stopColor={INDIGO} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={width} height={height} fill={`url(#${id}lit)`} />
            <Rect width={width} height={height} fill={`url(#${id}cool)`} />
            {RINGS.map((ring) => (
              <Circle
                key={ring.reach}
                cx={width * 0.98}
                cy={0}
                r={width * ring.reach}
                fill="none"
                stroke="#FFFFFF"
                strokeOpacity={ring.opacity}
                strokeWidth={1}
              />
            ))}
          </Svg>
        ) : null}
        <LinearGradient
          colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0)"]}
          locations={[0, 0.42]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: radius }]} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  lift: Platform.select({
    ios: { shadowColor: "#34188C", shadowOpacity: 0.38, shadowRadius: 18, shadowOffset: { width: 0, height: 14 } },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle,
  rim: { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)" },
});

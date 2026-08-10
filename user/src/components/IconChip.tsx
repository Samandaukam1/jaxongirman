import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { colors, gradients, icon as iconTokens } from "@/theme/tokens";

type Variant = "soft" | "brand" | "glass" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

const sizes: Record<Size, { box: number; corner: number; glyph: number }> = {
  sm: { box: 36, corner: 12, glyph: iconTokens.sm },
  md: { box: 44, corner: 14, glyph: iconTokens.md },
  lg: { box: 54, corner: 18, glyph: iconTokens.xl },
};

const glyphColor: Record<Variant, string> = {
  soft: colors.primary,
  brand: colors.onPrimary,
  glass: colors.onPrimary,
  outline: colors.ink,
  danger: colors.danger,
};

/**
 * The single rounded-square icon container used across the app, so every icon
 * sits on the same footprint with the same stroke weight.
 */
export function IconChip({
  icon: Icon,
  variant = "soft",
  size = "md",
  bold = false,
  gradient,
  style,
}: {
  icon: LucideIcon;
  variant?: Variant;
  size?: Size;
  bold?: boolean;
  /** Overrides the variant with a custom two-stop gradient (white glyph). */
  gradient?: readonly [string, string];
  style?: ViewStyle;
}) {
  const { box, corner, glyph } = sizes[size];
  const frame = { width: box, height: box, borderRadius: corner };
  const stroke = bold ? iconTokens.strokeBold : iconTokens.stroke;
  const fill = gradient ?? (variant === "brand" ? gradients.primary : null);
  const child = <Icon color={fill ? colors.onPrimary : glyphColor[variant]} size={glyph} strokeWidth={stroke} />;

  if (fill) {
    return (
      <LinearGradient colors={fill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.center, frame, style]}>
        {child}
      </LinearGradient>
    );
  }

  // `brand` never reaches here — it always resolves to a gradient above.
  return <View style={[styles.center, frame, variant === "brand" ? null : styles[variant], style]}>{child}</View>;
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  soft: { backgroundColor: colors.primarySoft },
  glass: { backgroundColor: "rgba(255,255,255,.16)", borderWidth: 1, borderColor: "rgba(255,255,255,.22)" },
  outline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: "#F3D4DB" },
});

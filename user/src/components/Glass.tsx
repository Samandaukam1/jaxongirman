import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, UIManager, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Liquid glass, the material the app's floating surfaces are made of.
 *
 * Three layers, the same three the tab bar uses: the system's own blur of
 * whatever is behind (on iOS, where it is a real material), a sheen that
 * runs bright at the top edge and settles into a tint, and a single hairline
 * rim. Without the blur — Android, or a binary built before expo-blur — the
 * sheen closes up and carries the surface alone, so the panel is the same
 * object one layer thinner rather than a different one.
 */

const BLUR = (() => {
  const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  if (registry) return "ExpoBlur" in registry;
  return UIManager.hasViewManagerConfig?.("ExpoBlurView") ?? false;
})();

export function GlassPanel({ children, style, radius: corner = radius.lg, intensity = 40, padded = true }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  padded?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.shadow, { borderRadius: corner }, style]}>
      <View style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: corner }]}>
        {BLUR ? (
          <BlurView
            intensity={Platform.OS === "ios" ? intensity : Math.round(intensity / 2)}
            tint={scheme === "dark" ? "systemUltraThinMaterialDark" : "systemUltraThinMaterialLight"}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <LinearGradient
          colors={BLUR ? colors.glassSheen : colors.glassSheenOpaque}
          locations={[0, 0.5, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* The bright top edge a real pane catches. */}
        <LinearGradient
          pointerEvents="none"
          colors={[scheme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.35 }}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: corner }]} />
      <View style={padded ? styles.padded : undefined}>{children}</View>
    </View>
  );
}

/**
 * A compact action on glass: an icon over a short label, one of a small row.
 *
 * Deliberately small. The screens that use it have one main thing — a slide,
 * a script — and the actions around it should be reachable without competing
 * with it.
 */
export function GlassAction({ icon: Icon, label, onPress, busy = false, disabled = false, tone = "plain", accessibilityLabel }: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "plain" | "brand";
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const brand = tone === "brand";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.actionWrap, pressed && styles.pressed, (disabled) && styles.disabled]}
    >
      <GlassPanel radius={radius.lg} padded={false} style={brand ? styles.brandShadow : undefined}>
        {brand ? (
          <LinearGradient colors={[colors.primaryBright, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: radius.lg }]} />
        ) : null}
        <View style={styles.action}>
          {busy
            ? <ActivityIndicator size="small" color={brand ? colors.onPrimary : colors.primary} />
            : <Icon color={brand ? colors.onPrimary : colors.primary} size={20} strokeWidth={2.1} />}
          <Text numberOfLines={1} style={[styles.actionLabel, brand && styles.actionLabelBrand]}>{label}</Text>
        </View>
      </GlassPanel>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  shadow: {
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  brandShadow: { shadowColor: colors.primary, shadowOpacity: 0.32 },
  clip: { overflow: "hidden" },
  rim: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassRim },
  padded: { padding: spacing.lg },
  actionWrap: { flex: 1 },
  pressed: { transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
  action: { minHeight: 62, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  actionLabel: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.ink },
  actionLabelBrand: { color: colors.onPrimary },
}));

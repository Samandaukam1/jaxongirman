import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";

import { colors, gradients, icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";

type Tone = "primary" | "secondary" | "ghost";
type Props = PressableProps & { label: string; loading?: boolean; tone?: Tone; icon?: LucideIcon; trailingIcon?: LucideIcon };

export function PrimaryButton({
  label,
  loading = false,
  tone = "primary",
  icon: Leading,
  trailingIcon: Trailing,
  disabled,
  style,
  ...props
}: Props) {
  const isDisabled = disabled || loading;
  const contentColor = tone === "primary" ? colors.onPrimary : colors.primary;

  const content = (
    <>
      {loading ? <ActivityIndicator color={contentColor} size="small" /> : Leading ? <Leading color={contentColor} size={icon.md} strokeWidth={icon.stroke} /> : null}
      <Text style={[styles.label, { color: contentColor }]}>{label}</Text>
      {Trailing && !loading ? <Trailing color={contentColor} size={icon.md} strokeWidth={icon.stroke} /> : null}
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.wrapper,
        tone === "primary" && styles.primaryWrapper,
        state.pressed && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {tone === "primary" ? (
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.base}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.base, tone === "secondary" ? styles.secondary : styles.ghost]}>{content}</View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { borderRadius: radius.md, overflow: "hidden" },
  // The lift lives on the wrapper so the gradient can still clip to the radius.
  primaryWrapper: { overflow: "visible", ...shadowLifted },
  base: {
    minHeight: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    overflow: "hidden",
  },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  ghost: { backgroundColor: colors.primarySoft },
  pressed: { transform: [{ scale: 0.985 }], opacity: 0.92 },
  disabled: { opacity: 0.45 },
  label: { ...typography.bodyMedium, letterSpacing: 0.1 },
});

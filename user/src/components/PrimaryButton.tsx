import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import {
  ActivityIndicator, Pressable, Text, View,
  type PressableProps, type PressableStateCallbackType,
} from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/lib/motion";
import { brandInk, gradients, icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const { colors } = useTheme();
  const styles = useStyles();
  const isDisabled = disabled || loading;
  const press = usePressScale(!isDisabled);
  // A primary button is the brand gradient, which does not flip with the
  // theme, so its label is brand ink. The other two tones are drawn on ordinary
  // themed surfaces and take the themed accent.
  const contentColor = tone === "primary" ? brandInk.strong : colors.primary;

  const content = (
    <>
      {loading ? <ActivityIndicator color={contentColor} size="small" /> : Leading ? <Leading color={contentColor} size={icon.md} strokeWidth={icon.stroke} /> : null}
      <Text style={[styles.label, { color: contentColor }]}>{label}</Text>
      {Trailing && !loading ? <Trailing color={contentColor} size={icon.md} strokeWidth={icon.stroke} /> : null}
    </>
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      {...press.handlers}
      style={(state: PressableStateCallbackType) => [
        styles.wrapper,
        tone === "primary" && styles.primaryWrapper,
        // The spring carries the give; `pressed` now only dims, so the two do
        // not fight over the same transform.
        state.pressed && styles.pressed,
        isDisabled && styles.disabled,
        press.style,
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
    </AnimatedPressable>
  );
}

const useStyles = makeStyles((colors) => ({
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
  pressed: { opacity: 0.92 },
  disabled: { opacity: 0.45 },
  label: { ...typography.bodyMedium, letterSpacing: 0.1 },
}));

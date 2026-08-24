import { LinearGradient } from "expo-linear-gradient";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { Touchable } from "@/components/Touchable";
import { brandInk, gradients, icon, radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Tone = "primary" | "secondary" | "ghost";
type Props = Omit<PressableProps, "style"> & {
  label: string;
  loading?: boolean;
  tone?: Tone;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
};

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
    <Touchable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      disabled={isDisabled}
      style={[
        styles.wrapper,
        tone === "primary" && styles.primaryWrapper,
        isDisabled && styles.disabled,
        style,
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
    </Touchable>
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
  disabled: { opacity: 0.45 },
  label: { ...typography.bodyMedium, letterSpacing: 0.1 },
}));

import type { LucideIcon } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type DimensionValue, type ViewStyle } from "react-native";

import { IconChip } from "@/components/IconChip";
import { colors, radius, shadow, spacing, typography } from "@/theme/tokens";

/**
 * The four things every data-bearing section on this app can be: loading, empty,
 * broken, or fine. Kept in one file so a new screen gets the same shapes without
 * re-inventing them, and so "empty" always looks deliberate rather than missing.
 */

/** A quietly pulsing placeholder block. */
export function Skeleton({ height = 16, width, radius: corner = 10, style }: { height?: number; width?: DimensionValue; radius?: number; style?: ViewStyle }) {
  // Held in state rather than a ref: a ref's `.current` may not be read during
  // render, and this value is passed straight into the style below.
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 780, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { height, borderRadius: corner, opacity: pulse },
        width === undefined ? styles.fullWidth : { width },
        style,
      ]}
    />
  );
}

/** A card-shaped skeleton, for lists that load into cards. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <View style={styles.skeletonCard}>
      <Skeleton height={18} width="62%" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? "40%" : "88%"} />
      ))}
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: LucideIcon; title: string; message: string; action?: ReactNode }) {
  return (
    <View style={styles.card}>
      <IconChip icon={icon} variant="soft" size="lg" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.copy}>{message}</Text>
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.card, styles.errorCard]}>
      <Text style={styles.errorTitle}>Ma’lumot yuklanmadi</Text>
      <Text style={styles.copy}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Qayta urinish</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A one-line inline error, for forms where a whole card would be too loud. */
export function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.inline}>
      <Text style={styles.inlineText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { backgroundColor: colors.surfaceMuted },
  fullWidth: { alignSelf: "stretch" },
  skeletonCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  card: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadow,
  },
  errorCard: { borderColor: "#F3D4DB", backgroundColor: colors.dangerSoft },
  title: { ...typography.heading, color: colors.ink, textAlign: "center", marginTop: spacing.sm },
  errorTitle: { ...typography.heading, color: colors.danger, textAlign: "center" },
  copy: { ...typography.body, color: colors.inkMuted, textAlign: "center", maxWidth: 300 },
  retry: { marginTop: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  retryText: { ...typography.bodyMedium, color: colors.primary },
  inline: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderWidth: 1, borderColor: "#F3D4DB" },
  inlineText: { ...typography.caption, color: colors.danger, lineHeight: 18 },
});

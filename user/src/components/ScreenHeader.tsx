import { useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { icon, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  title: string;
  subtitle?: string;
  /** A modal closes; a pushed screen goes back. Only the glyph differs. */
  variant?: "back" | "close";
  onLeave?: () => void;
  action?: ReactNode;
};

/** The one header used by every pushed screen, so they all sit on the same grid. */
export function ScreenHeader({ title, subtitle, variant = "back", onLeave, action }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const Glyph = variant === "close" ? X : ChevronLeft;

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={variant === "close" ? "Yopish" : "Orqaga"}
        onPress={() => (onLeave ? onLeave() : router.back())}
        style={styles.button}
      >
        <Glyph color={colors.ink} size={icon.md} strokeWidth={icon.strokeBold} />
      </Pressable>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ?? <View style={styles.button} />}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: Platform.OS === "ios" ? 58 : 28,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  button: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  copy: { flex: 1 },
  title: { ...typography.heading, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 1 },
}));

import { useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  const { t } = useTranslation(["misc", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const Glyph = variant === "close" ? X : ChevronLeft;

  return (
    // Measured, not guessed: a Dynamic Island, a notch and an SE each put the
    // header right under their own status bar.
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={variant === "close" ? t("common:close") : t("headerBack")}
        onPress={() => (onLeave ? onLeave() : router.back())}
        style={styles.button}
      >
        <Glyph color={colors.ink} size={icon.md} strokeWidth={icon.strokeBold} />
      </Pressable>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {/* A spacer, not a button: it balances the back button so the title
          stays centred on the same grid, and it is invisible because an empty
          bordered circle reads as a control that does nothing. */}
      {action ?? <View style={styles.spacer} />}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  button: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  spacer: { width: 42, height: 42 },
  copy: { flex: 1 },
  title: { ...typography.heading, color: colors.ink },
  subtitle: { ...typography.caption, color: colors.inkMuted, marginTop: 1 },
}));

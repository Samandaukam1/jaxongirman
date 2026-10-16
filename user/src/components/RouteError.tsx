import type { ErrorBoundaryProps } from "expo-router";
import { RotateCcw, TriangleAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * What a screen shows when its own code throws.
 *
 * Without a boundary, one bad render — a field the server stopped sending, a
 * library that changed its mind about what is legal — closes the whole app, and
 * the person loses whatever they were doing on every other tab with it. Here the
 * screen that failed says so and offers to try again; everything around it
 * keeps working.
 */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
  const styles = useStyles();
  const { t } = useTranslation(["misc", "common"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (__DEV__) console.error("[route] render failed", error);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.mark}>
        <TriangleAlert color={colors.danger} size={28} strokeWidth={2} />
      </View>
      <Text style={styles.title}>{t("routeError.title")}</Text>
      <Text style={styles.body}>
        {t("routeError.body")}
      </Text>
      {__DEV__ ? <Text style={styles.detail} numberOfLines={4}>{error.message}</Text> : null}
      <View style={styles.action}>
        <PrimaryButton label={t("common:retry")} icon={RotateCcw} onPress={() => void retry()} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.canvas,
  },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.dangerSoft,
  },
  title: { ...typography.heading, color: colors.ink, textAlign: "center" },
  body: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  detail: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
  action: { alignSelf: "stretch", marginTop: spacing.md },
}));

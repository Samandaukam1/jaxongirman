import { useRouter } from "expo-router";
import { Lock } from "lucide-react-native";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, View } from "react-native";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A part of the app that does not work in a browser yet.
 *
 * Said plainly, in place of the screen, rather than a screen that half works:
 * camera scanners, the phone as a remote, payments not yet tried on the web.
 * Each one is unlocked by deleting its `lockedOnWeb` once it has been made and
 * checked in a browser.
 */
export function WebLockedNotice({ onBack }: { onBack?: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation("misc");
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/(app)/(tabs)")));
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.badge}><Lock color={colors.primaryDeep} size={26} strokeWidth={2} /></View>
        <Text style={styles.title}>{t("webLocked.title")}</Text>
        <Text style={styles.body}>{t("webLocked.body")}</Text>
        <Pressable accessibilityRole="button" onPress={back} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>{t("webLocked.back")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The screen on a phone; the notice in a browser. */
export function lockedOnWeb<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function OnPhoneOnly(props: P) {
    return Platform.OS === "web" ? <WebLockedNotice /> : <Screen {...props} />;
  }
  OnPhoneOnly.displayName = `lockedOnWeb(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return OnPhoneOnly;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.canvas },
  card: {
    width: "100%", maxWidth: 440, alignItems: "center", gap: spacing.md,
    padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  badge: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  title: { ...typography.heading, color: colors.ink, textAlign: "center" },
  body: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  button: {
    marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.primary,
  },
  pressed: { opacity: 0.88 },
  buttonText: { ...typography.bodyMedium, color: colors.onPrimary },
}));

import { Sparkles } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSurface } from "@/components/BrandSurface";
import { installedVersion } from "@/lib/app-version";
import { supabase } from "@/lib/supabase";
import { isOlder, readUpdateOffer, versionLabel, type UpdateOffer } from "@/lib/version-core";
import { brandInk, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * "A new version is out" — the whole screen, one big button.
 *
 * The published version is the `app.latest_version` setting; a phone behind it
 * is shown this when it opens or comes back to the front, and "Yangilash"
 * takes it to jaxongirman.app/ilova, which sends it to its own store. "Keyinroq"
 * hides it until the app is next opened, unless the setting says the update is
 * required. The web is always the newest build, so it never asks.
 */
export function UpdateNotice() {
  const { t } = useTranslation("common");
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [later, setLater] = useState(false);

  const check = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "app.latest_version").maybeSingle();
    const found = readUpdateOffer(data?.value);
    setOffer(found && isOlder(installedVersion(), found.version) ? found : null);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    void check().catch(() => {});
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void check().catch(() => {});
    });
    return () => listener.remove();
  }, [check]);

  if (!offer || (later && !offer.required)) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => { if (!offer.required) setLater(true); }}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <BrandSurface radius={radius.xl} style={styles.hero}>
          <View style={styles.badge}><Sparkles color={brandInk.strong} size={30} strokeWidth={1.9} /></View>
          <Text style={styles.kicker}>{t("update.kicker", { version: versionLabel(offer.version) })}</Text>
          <Text style={styles.title}>{t("update.title")}</Text>
          <Text style={styles.body}>{t("update.body")}</Text>
        </BrandSurface>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(offer.url).catch(() => {})}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>{t("update.action")}</Text>
          </Pressable>
          {offer.required ? (
            <Text style={styles.required}>{t("update.required")}</Text>
          ) : (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setLater(true)} style={styles.secondary}>
              <Text style={[styles.secondaryText, { color: colors.inkMuted }]}>{t("update.later")}</Text>
            </Pressable>
          )}
          <Text style={styles.installed}>{t("update.installed", { version: versionLabel(installedVersion()) })}</Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas, paddingHorizontal: spacing.xl, justifyContent: "space-between" },
  hero: { flex: 1, justifyContent: "flex-end", padding: spacing.xxl, gap: spacing.sm },
  badge: {
    width: 64, height: 64, borderRadius: 20, marginBottom: "auto", alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)",
  },
  kicker: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", letterSpacing: 1.6, color: brandInk.muted },
  title: { ...typography.display, color: brandInk.strong },
  body: { ...typography.body, fontSize: 16, lineHeight: 24, color: brandInk.strong, opacity: 0.88 },
  actions: { gap: spacing.md, paddingTop: spacing.xl },
  primary: { height: 58, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  primaryText: { ...typography.heading, color: colors.onPrimary },
  secondary: { alignSelf: "center", paddingVertical: spacing.xs, paddingHorizontal: spacing.lg },
  secondaryText: { ...typography.bodyMedium },
  required: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  installed: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
}));

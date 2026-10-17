import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect, useRouter } from "expo-router";
import { Camera, MonitorSmartphone, ScanLine } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { formatDayMonth, formatClock } from "@/lib/datetime";
import { browserOf, webLoginHistory, webLoginToken, type WebSignIn } from "@/lib/webLogin";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * "Web ulash": the camera that reads the site's sign-in code, and the
 * browsers this account let in.
 *
 * Reading a code only opens the confirmation; nothing is allowed from here.
 * The camera keeps reading while the code is on screen, so a code that was
 * not the site's is remembered and not reported on every frame.
 */
export default function WebLoginScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("profile");
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WebSignIn[] | null>(null);
  const opened = useRef(false);
  const refused = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    opened.current = false;
    let alive = true;
    webLoginHistory().then((rows) => { if (alive) setHistory(rows); }).catch(() => { if (alive) setHistory([]); });
    return () => { alive = false; };
  }, []));

  function scanned(data: string) {
    if (opened.current || refused.current === data) return;
    const token = webLoginToken(data);
    if (!token) {
      refused.current = data;
      setError(t("webLogin.notOurs"));
      return;
    }
    opened.current = true;
    setError(null);
    router.push({ pathname: "/(app)/web-login/[token]", params: { token } });
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("webLogin.title")} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>{t("webLogin.lead")}</Text>

        {!permission ? (
          <View style={styles.cameraFrame}><ActivityIndicator color={colors.onPrimary} /></View>
        ) : !permission.granted ? (
          <View style={styles.permission}>
            <View style={styles.permissionIcon}><Camera color={colors.primary} size={26} strokeWidth={2} /></View>
            <Text style={styles.permissionTitle}>{t("webLogin.cameraTitle")}</Text>
            <Text style={styles.permissionCopy}>{t("webLogin.cameraBody")}</Text>
            <PrimaryButton label={t("webLogin.allowCamera")} onPress={() => void requestPermission()} />
          </View>
        ) : (
          <View style={styles.cameraFrame}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => scanned(data)}
            />
            <View pointerEvents="none" style={styles.reticle}>
              <ScanLine color={colors.onPrimary} size={28} strokeWidth={1.6} />
            </View>
            <Text style={styles.aim}>{t("webLogin.aim")}</Text>
          </View>
        )}

        {error ? <InlineError message={error} /> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("webLogin.history")}</Text>
          <View style={styles.group}>
            {history === null ? (
              <View style={styles.row}><ActivityIndicator color={colors.primary} /></View>
            ) : history.length === 0 ? (
              <View style={styles.row}><Text style={styles.empty}>{t("webLogin.historyEmpty")}</Text></View>
            ) : history.map((item, at) => (
              <View key={item.approved_at} style={styles.row}>
                {at > 0 ? <View style={styles.rule} /> : null}
                <View style={styles.rowIcon}><MonitorSmartphone color={colors.primary} size={18} strokeWidth={2} /></View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{browserOf(item.user_agent) ?? t("webLogin.unknownBrowser")}</Text>
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {formatDayMonth(new Date(item.approved_at))}, {formatClock(new Date(item.approved_at))} · {item.used_at ? t("webLogin.signedIn") : t("webLogin.allowed")}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  lead: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },
  cameraFrame: { height: 300, borderRadius: radius.xl, overflow: "hidden", backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  reticle: {
    position: "absolute", top: "50%", left: "50%", width: 190, height: 190, marginLeft: -95, marginTop: -105,
    borderRadius: radius.xl, borderWidth: 3, borderColor: "rgba(255,255,255,.85)", alignItems: "center", justifyContent: "center",
  },
  aim: { position: "absolute", bottom: spacing.md, left: spacing.md, right: spacing.md, ...typography.caption, color: "rgba(255,255,255,.88)", textAlign: "center" },
  permission: { alignItems: "center", gap: spacing.sm, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  permissionIcon: { width: 56, height: 56, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  permissionTitle: { ...typography.heading, color: colors.ink, marginTop: spacing.xs },
  permissionCopy: { ...typography.body, color: colors.inkMuted, textAlign: "center", lineHeight: 22, marginBottom: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", letterSpacing: 0.6, color: colors.inkSoft },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 58 },
  rule: { position: "absolute", top: 0, left: spacing.lg + 40, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyMedium, color: colors.ink },
  rowDetail: { ...typography.caption, color: colors.inkMuted },
  empty: { ...typography.caption, color: colors.inkMuted },
}));

import { useFocusEffect } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, AppState, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

import { useSuccessToast } from "@/components/SuccessToast";
import { formatClock, formatDayMonth } from "@/lib/datetime";
import { confirmDevice, deviceAlerts, deviceLabel, revokeDevice, type DeviceAlert } from "@/lib/devices";
import { asErrorMessage } from "@/lib/format";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const when = (iso: string) => `${formatDayMonth(new Date(iso))}, ${formatClock(new Date(iso))}`;

/**
 * "Yangi qurilmadan kirildi — bu sizmisiz?"
 *
 * Shown on the home screen of every device except the new one, until somebody
 * answers. "Ha, bu men" keeps the device; "Yo‘q, chiqarish" takes it out at
 * once — an older device may always remove a newer one. When this device is
 * itself the newer one, the card says from when it may.
 */
export function NewDeviceCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("profile");
  const notify = useSuccessToast();
  const [alerts, setAlerts] = useState<DeviceAlert[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { void deviceAlerts().then(setAlerts); }, []);
  useFocusEffect(load);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") load(); });
    return () => subscription.remove();
  }, [load]);

  const alert = alerts[0];
  if (!alert) return null;
  const name = deviceLabel({ name: alert.name, platform: alert.platform });

  async function answer(keep: boolean) {
    if (!alert || busy) return;
    setBusy(true);
    try {
      if (keep) await confirmDevice(alert.session_id);
      else {
        await revokeDevice(alert.session_id);
        notify(t("newDevice.removedTitle"), t("newDevice.removedBody"));
      }
      setAlerts((current) => current.filter((item) => item.session_id !== alert.session_id));
    } catch (failure) {
      Alert.alert(t("devices.failed"), asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Animated.View key={alert.session_id} entering={FadeInDown.duration(380)} exiting={FadeOutUp.duration(220)} style={[styles.card, style]}>
      <View style={styles.head}>
        <View style={styles.icon}><ShieldAlert color={colors.warning} size={20} strokeWidth={2.1} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>{t("newDevice.title")}</Text>
          <Text style={styles.body}>{t("newDevice.body", { name, time: when(alert.signed_in_at) })}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void answer(true)} style={({ pressed }) => [styles.button, styles.yes, pressed && styles.pressed]}>
          <Text style={styles.yesText}>{t("newDevice.yes")}</Text>
        </Pressable>
        {alert.can_revoke ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void answer(false)} style={({ pressed }) => [styles.button, styles.no, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color={colors.danger} size="small" /> : <Text style={styles.noText}>{t("newDevice.no")}</Text>}
          </Pressable>
        ) : null}
      </View>
      {!alert.can_revoke ? <Text style={styles.wait}>{t("devices.rule")}</Text> : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.warningBorder,
  },
  head: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.warningSoft },
  copy: { flex: 1, gap: 3 },
  title: { ...typography.bodyMedium, color: colors.ink },
  body: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
  button: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  yes: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  yesText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.ink },
  no: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder },
  noText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.danger },
  pressed: { opacity: 0.85 },
  wait: { ...typography.caption, color: colors.inkSoft, lineHeight: 17 },
}));

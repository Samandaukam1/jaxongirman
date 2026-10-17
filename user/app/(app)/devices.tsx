import { useFocusEffect } from "expo-router";
import { Globe, LogOut, Smartphone } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/StateBlocks";
import { useSuccessToast } from "@/components/SuccessToast";
import { formatClock, formatDayMonth } from "@/lib/datetime";
import { deviceLabel, listDevices, revokeDevice, revokeOtherDevices, type DeviceRow } from "@/lib/devices";
import { asErrorMessage } from "@/lib/format";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

const when = (iso: string) => `${formatDayMonth(new Date(iso))}, ${formatClock(new Date(iso))}`;

/**
 * Qurilmalar: every phone and browser signed in to this account.
 *
 * This device first, then the rest newest first. Each other device can be
 * taken out — at once when it signed in after this one, otherwise once this
 * device has been signed in for two hours, which the row says in place of the
 * button. The rule is the database's; the screen only shows it.
 */
export default function DevicesScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["profile", "common"]);
  const notify = useSuccessToast();
  const [rows, setRows] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listDevices());
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function revoke(row: DeviceRow) {
    Alert.alert(t("devices.revokeTitle", { name: deviceLabel(row) }), t("devices.revokeBody"), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("devices.revoke"),
        style: "destructive",
        onPress: () => void (async () => {
          setBusy(row.session_id);
          try {
            await revokeDevice(row.session_id);
            notify(t("devices.revoked"), deviceLabel(row));
            await load();
          } catch (failure) {
            Alert.alert(t("devices.failed"), asErrorMessage(failure));
          } finally {
            setBusy(null);
          }
        })(),
      },
    ]);
  }

  function revokeOthers() {
    Alert.alert(t("devices.revokeOthersTitle"), t("devices.revokeOthersBody"), [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("devices.revoke"),
        style: "destructive",
        onPress: () => void (async () => {
          setBusy("others");
          try {
            const result = await revokeOtherDevices();
            notify(
              t("devices.revokedOthers", { count: result.revoked }),
              result.kept > 0 && result.revoke_from ? t("devices.keptOthers", { time: when(result.revoke_from) }) : undefined,
            );
            await load();
          } catch (failure) {
            Alert.alert(t("devices.failed"), asErrorMessage(failure));
          } finally {
            setBusy(null);
          }
        })(),
      },
    ]);
  }

  const others = rows?.filter((row) => !row.is_current) ?? [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("devices.title")} />
      {error && !rows ? (
        <View style={styles.content}><ErrorState message={error} onRetry={() => void load()} /></View>
      ) : !rows ? (
        <View style={styles.centered}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.lead}>{t("devices.lead")}</Text>

          <View style={styles.group}>
            {rows.map((row, at) => {
              const Glyph = row.platform === "web" || (!row.platform && /Mozilla/.test(row.user_agent ?? "")) ? Globe : Smartphone;
              return (
                <View key={row.session_id} style={styles.row}>
                  {at > 0 ? <View style={styles.rule} /> : null}
                  <View style={[styles.icon, row.is_current && styles.iconCurrent]}>
                    <Glyph color={row.is_current ? colors.onPrimary : colors.primary} size={18} strokeWidth={2} />
                  </View>
                  <View style={styles.copy}>
                    <View style={styles.titleRow}>
                      <Text style={styles.name} numberOfLines={1}>{deviceLabel(row)}</Text>
                      {row.is_current ? <Text style={styles.badge}>{t("devices.current")}</Text> : null}
                      {!row.is_current && !row.confirmed ? <Text style={[styles.badge, styles.badgeFresh]}>{t("devices.fresh")}</Text> : null}
                    </View>
                    <Text style={styles.detail} numberOfLines={1}>{t("devices.signedIn", { date: when(row.signed_in_at) })}</Text>
                    {!row.is_current && !row.can_revoke && row.revoke_from ? (
                      <Text style={styles.wait} numberOfLines={2}>{t("devices.revokeAfter", { time: when(row.revoke_from) })}</Text>
                    ) : null}
                  </View>
                  {!row.is_current && row.can_revoke ? (
                    <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => revoke(row)} style={({ pressed }) => [styles.revoke, pressed && styles.pressed]}>
                      {busy === row.session_id ? <ActivityIndicator color={colors.danger} size="small" /> : <Text style={styles.revokeText}>{t("devices.revoke")}</Text>}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>

          {others.length === 0 ? <Text style={styles.empty}>{t("devices.empty")}</Text> : (
            <Pressable accessibilityRole="button" disabled={busy !== null || !others.some((row) => row.can_revoke)} onPress={revokeOthers}
              style={({ pressed }) => [styles.others, pressed && styles.pressed, !others.some((row) => row.can_revoke) && styles.dim]}>
              {busy === "others" ? <ActivityIndicator color={colors.danger} size="small" /> : <LogOut color={colors.danger} size={18} strokeWidth={2} />}
              <Text style={styles.othersText}>{t("devices.revokeOthers")}</Text>
            </Pressable>
          )}

          <Text style={styles.rulesNote}>{t("devices.rule")}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.lg },
  lead: { ...typography.body, color: colors.inkMuted, lineHeight: 22 },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 68 },
  rule: { position: "absolute", top: 0, left: spacing.lg + 44, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  iconCurrent: { backgroundColor: colors.primary },
  copy: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...typography.bodyMedium, color: colors.ink, flexShrink: 1 },
  badge: { ...typography.caption, fontSize: 11, fontFamily: "Manrope_700Bold", color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  badgeFresh: { color: colors.warning, backgroundColor: colors.warningSoft },
  detail: { ...typography.caption, color: colors.inkMuted },
  wait: { ...typography.caption, color: colors.inkSoft },
  revoke: { minWidth: 84, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.dangerBorder, backgroundColor: colors.dangerSoft },
  revokeText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.danger },
  pressed: { opacity: 0.8 },
  dim: { opacity: 0.45 },
  others: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.dangerBorder, backgroundColor: colors.surface },
  othersText: { ...typography.bodyMedium, color: colors.danger },
  empty: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  rulesNote: { ...typography.caption, color: colors.inkSoft, lineHeight: 18 },
}));

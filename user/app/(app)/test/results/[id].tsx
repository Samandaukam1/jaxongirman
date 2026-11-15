import { useLocalSearchParams, useRouter } from "expo-router";
import { ListChecks, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState } from "@/components/StateBlocks";
import { formatDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { deleteResult, listResults, type TestResult } from "@/lib/tests";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Every checked sheet of a test, newest first, with the class average. */
export default function TestResultsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["tests", "common"]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rows, setRows] = useState<TestResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setRows(await listResults(id));
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useFocusRefresh(load, 0);

  function remove(row: TestResult) {
    Alert.alert(t("results.delete"), t("results.deleteConfirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("results.delete"), style: "destructive", onPress: () => { void deleteResult(row.id).then(load).catch((failure) => setError(asErrorMessage(failure))); } },
    ]);
  }

  const average = rows?.length
    ? Math.round((rows.reduce((sum, row) => sum + row.score / Math.max(row.total, 1), 0) / rows.length) * 100)
    : 0;

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title={t("results.title")}
        subtitle={rows?.length ? `${t("results.count", { count: rows.length })} · ${t("results.average", { percent: average })}` : undefined}
        onLeave={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
        {rows && rows.length === 0 ? <EmptyState icon={ListChecks} title={t("results.empty")} message={t("results.emptyBody")} /> : null}
        {rows?.map((row) => {
          const percent = Math.round((row.score / Math.max(row.total, 1)) * 100);
          return (
            <View key={row.id} style={styles.row}>
              <View style={[styles.badge, percent >= 85 ? styles.good : percent >= 55 ? styles.middle : styles.low]}>
                <Text style={styles.badgeText}>{percent}%</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{row.student_name || t("results.noName")}</Text>
                <Text style={styles.meta}>
                  {t("score", { score: row.score, total: row.total })} · {row.source === "manual" ? t("results.manual") : t("results.scan")} · {formatDate(row.created_at)}
                </Text>
              </View>
              <Pressable accessibilityLabel={t("results.delete")} hitSlop={8} onPress={() => remove(row)}>
                <Trash2 color={colors.inkSoft} size={18} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.sm, paddingBottom: spacing.xxxl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  good: { backgroundColor: colors.successSoft },
  middle: { backgroundColor: colors.warningSoft },
  low: { backgroundColor: colors.dangerSoft },
  badgeText: { ...typography.bodyMedium, color: colors.ink },
  name: { ...typography.bodyMedium, color: colors.ink },
  meta: { ...typography.caption, color: colors.inkMuted },
}));

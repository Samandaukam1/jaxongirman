import { useRouter } from "expo-router";
import { ClipboardCheck, Plus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState, ErrorState } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { listTests, type Test } from "@/lib/tests";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** The teacher's tests: a new one, and every one made so far. */
export default function TestsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const router = useRouter();
  const { user } = useAuth();
  const [tests, setTests] = useState<Test[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setTests(await listTests(user.id));
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setRefreshing(false);
    }
  }, [user]);

  useFocusRefresh(load, 0);

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("title")} subtitle={t("hubSubtitle")} onLeave={() => router.back()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
      >
        <PrimaryButton label={t("create")} icon={Plus} onPress={() => router.push("/test/create")} />
        <Text style={styles.section}>{t("mine")}</Text>
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!tests && !error ? <ActivityIndicator color={colors.primary} /> : null}
        {tests && tests.length === 0 ? <EmptyState icon={ClipboardCheck} title={t("empty")} message={t("emptyBody")} /> : null}
        {tests?.map((test) => (
          <Pressable key={test.id} onPress={() => router.push(`/test/${test.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.icon}><ClipboardCheck color={colors.primary} size={icon.md} strokeWidth={icon.stroke} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{test.title || t("page.untitled")}</Text>
              <Text style={styles.rowMeta}>
                {t("meta", { count: test.question_count, options: test.option_count })} · {t(`status.${test.status as "ready"}`)}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  section: { ...typography.bodyMedium, color: colors.ink, marginTop: spacing.md },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  rowTitle: { ...typography.bodyMedium, color: colors.ink },
  rowMeta: { ...typography.caption, color: colors.inkMuted },
}));

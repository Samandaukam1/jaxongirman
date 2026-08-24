import { DATA_COLLECTION_MODULE } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { BookmarkCheck, ClipboardList, Plus, ShieldCheck } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SurveyCard, type SurveySummary } from "@/components/SurveyCard";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { moduleGate, useModuleAccess } from "@/lib/modules";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Tab = "created" | "participating";
type Filter = "all" | "active" | "finished";

const TABS: { key: Tab; label: string }[] = [
  { key: "created", label: "Yaratganlarim" },
  { key: "participating", label: "Qatnashganlarim" },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Barchasi" },
  { key: "active", label: "Faol" },
  { key: "finished", label: "Tugagan" },
];

function isFinished(item: SurveySummary): boolean {
  if (item.status === "closed") return true;
  return Boolean(item.deadline) && new Date(item.deadline as string).getTime() <= Date.now();
}

/** The module's home: what you have made, and what you have been asked to fill in. */
export default function SurveyModuleScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { state: access } = useModuleAccess(DATA_COLLECTION_MODULE);

  const [created, setCreated] = useState<SurveySummary[]>([]);
  const [participating, setParticipating] = useState<SurveySummary[]>([]);
  const [tab, setTab] = useState<Tab>("created");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data, error: requestError } = await supabase.rpc("my_surveys");
    if (requestError) {
      setError(asErrorMessage(requestError));
    } else {
      const payload = data as unknown as { created?: SurveySummary[]; participating?: SurveySummary[] } | null;
      setCreated(payload?.created ?? []);
      setParticipating(payload?.participating ?? []);
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const source = tab === "created" ? created : participating;
  const visible = useMemo(() => {
    if (filter === "all") return source;
    return source.filter((item) => (filter === "finished" ? isFinished(item) : !isFinished(item)));
  }, [filter, source]);

  const creatorGate = moduleGate(access, "creator");

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Ma’lumotlarni yig‘ish"
        subtitle="So‘rovnoma yarating va natijalarni oling"
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Savol shablonlari"
            onPress={() => router.push("/(app)/survey/templates")}
            style={styles.headerAction}
          >
            <BookmarkCheck color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        {/* Access is described, never assumed. When enforcement is on and the
            person does not hold it, the create button is what changes — the
            listing below still shows what they already took part in. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/survey/access")}
          style={[styles.accessCard, access?.has_access ? styles.accessCardActive : null]}
        >
          <ShieldCheck color={access?.has_access ? colors.success : colors.primary} size={20} strokeWidth={2} />
          <View style={styles.accessCopy}>
            <Text style={styles.accessTitle}>
              {access?.has_access ? "Modulga kirish faol" : creatorGate.allowed ? "Modul ochiq" : "Modulga kirish kerak"}
            </Text>
            <Text style={styles.accessBody}>
              {access?.has_access
                ? "Ma’lumot: kirish muddati va shartlarini ko‘rish"
                : creatorGate.allowed
                  ? "Hozircha barcha foydalanuvchilar uchun ochiq. Shartlarni ko‘rish"
                  : (creatorGate.reason ?? "")}
            </Text>
          </View>
        </Pressable>

        <PrimaryButton
          label="Yangi so‘rovnoma"
          icon={Plus}
          disabled={!creatorGate.allowed}
          onPress={() => router.push("/(app)/survey/create")}
        />

        <View style={styles.tabs}>
          {TABS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.key }}
              onPress={() => setTab(item.key)}
              style={[styles.tab, tab === item.key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text>
              <Text style={[styles.tabCount, tab === item.key && styles.tabCountActive]}>
                {item.key === "created" ? created.length : participating.length}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.filters}>
          {FILTERS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => setFilter(item.key)}
              style={[styles.filter, filter === item.key && styles.filterActive]}
            >
              <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? <><SkeletonCard /><SkeletonCard /></> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && visible.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={tab === "created" ? "So‘rovnoma yaratmagansiz" : "Hech qanday so‘rovnomada qatnashmagansiz"}
            message={
              tab === "created"
                ? "Yangi so‘rovnoma tugmasi orqali savollaringizni tuzing, havolani ulashing va javoblarni jadvalda oling."
                : "Sizga yuborilgan so‘rovnoma havolasini ochsangiz, u shu ro‘yxatda paydo bo‘ladi."
            }
          />
        ) : null}

        <View style={styles.list}>
          {visible.map((item) => (
            <SurveyCard
              key={item.id}
              item={item}
              onPress={() => router.push(
                item.is_owner
                  ? { pathname: "/(app)/survey/results/[id]", params: { id: item.id } }
                  : { pathname: "/(app)/survey/[id]", params: { id: item.id } },
              )}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 60, gap: spacing.lg },
  headerAction: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },

  accessCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.border },
  accessCardActive: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  accessCopy: { flex: 1, gap: 2 },
  accessTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 14 },
  accessBody: { ...typography.caption, color: colors.inkMuted, lineHeight: 17 },

  tabs: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.surfaceMuted, padding: 5, borderRadius: radius.pill },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabText: { ...typography.caption, color: colors.inkMuted, fontFamily: "Manrope_600SemiBold" },
  tabTextActive: { color: colors.ink },
  tabCount: { ...typography.caption, fontSize: 10, color: colors.inkSoft, backgroundColor: colors.surface, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, overflow: "hidden" },
  tabCountActive: { color: colors.primary, backgroundColor: colors.primarySoft },

  filters: { flexDirection: "row", gap: spacing.sm },
  filter: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.caption, color: colors.inkMuted },
  filterTextActive: { color: colors.onPrimary },

  list: { gap: spacing.md },
}));

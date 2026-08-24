import { useFocusEffect, useRouter } from "expo-router";
import { FileText, FileUp, GraduationCap, Image as Image_, MonitorPlay, Search, Sparkles, X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Touchable } from "@/components/Touchable";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { CreateDeckButton } from "@/components/CreateDeckButton";
import { Appear } from "@/components/Appear";
import { ProjectRow } from "@/components/ProjectRow";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { listProjects, searchProjects, type Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Everything this account has made, in one place, with a way to find it.
 *
 * The list used to be presentations and nothing else, while a 3×4 sheet, an
 * obyektivka and an academic work were each reachable only from the screen that
 * created them — so last week's work existed and could not be got back to. And
 * with everything in one list, a search stops being a nicety: twenty-three rows
 * is a scroll, and it only grows.
 */
export default function ProjectsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { balance, refresh: refreshAccount } = useAccount();
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (!user) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      setItems(await listProjects());
      void supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
      if (isRefresh) void refreshAccount();
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshAccount, user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = useMemo(() => searchProjects(items, query), [items, query]);

  return (
    <View style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
            <Text style={styles.brand}>Loyihalar</Text>
          </View>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={searching ? "Qidiruvni yopish" : "Qidirish"}
            onPress={() => { setSearching((open) => !open); if (searching) setQuery(""); }}
            style={styles.headerIcon}
          >
            {searching
              ? <X color={colors.primaryDeep} size={19} strokeWidth={2.2} />
              : <Search color={colors.primaryDeep} size={19} strokeWidth={2.2} />}
          </Touchable>
          <View style={styles.creditPill}>
            <Text style={styles.creditText}>{formatNumber(balance)}</Text>
            <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
          </View>
        </View>

        {searching ? (
          <View style={styles.searchBox}>
            <Search color={colors.inkSoft} size={17} strokeWidth={2} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Nomi yoki turi bo‘yicha qidiring"
              placeholderTextColor={colors.inkSoft}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {query ? (
              <Pressable accessibilityLabel="Tozalash" onPress={() => setQuery("")} hitSlop={8}>
                <X color={colors.inkSoft} size={16} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <CreateDeckButton onPress={() => router.push("/(app)/create")} />

        {/**
          * The other three things this account can make.
          *
          * Peers with each other and deliberately not with the button above:
          * making a deck is what most people opened the app to do, and a row of
          * four equal cards would say the opposite. Each is one tap to its own
          * workflow.
          */}
        <View style={styles.tools}>
          {[
            { key: "portrait", label: "3×4 rasm", detail: "Hujjatga", Glyph: Image_, href: "/(app)/portrait" as const },
            { key: "objective", label: "Obyektivka", detail: "DOCX / PDF", Glyph: FileText, href: "/(app)/obyektivka" as const },
            { key: "academic", label: "Ilmiy ish", detail: "Maqola, referat", Glyph: GraduationCap, href: "/(app)/ilmiy" as const },
          ].map((tool) => (
            <Touchable
              key={tool.key}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              onPress={() => router.push(tool.href)}
              style={({ pressed }) => [styles.tool, pressed && styles.toolPressed]}
            >
              <View style={styles.toolIcon}><tool.Glyph color={colors.primary} size={20} strokeWidth={2} /></View>
              <Text style={styles.toolLabel} numberOfLines={1}>{tool.label}</Text>
              <Text style={styles.toolDetail} numberOfLines={1}>{tool.detail}</Text>
            </Touchable>
          ))}
        </View>

        {/* Second on purpose: generating is the product, importing is the door
            for people who already have a deck. */}
        <View style={styles.secondaryRow}>
          <Touchable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/import")}
            style={({ pressed }) => [styles.secondary, pressed && styles.toolPressed]}
          >
            <FileUp color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
            <Text style={styles.secondaryText}>PowerPoint’dan yuklash</Text>
          </Touchable>
          <Touchable
            accessibilityRole="button"
            onPress={() => router.push("/(app)/present/scan")}
            style={({ pressed }) => [styles.secondary, pressed && styles.toolPressed]}
          >
            <MonitorPlay color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
            <Text style={styles.secondaryText}>Taqdimot qilish</Text>
          </Touchable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{query ? "Topilganlar" : "Oxirgi ishlaringiz"}</Text>
          {shown.length > 0 ? <Text style={styles.sectionCount}>{shown.length}</Text> : null}
        </View>

        {loading ? <View style={styles.list}><SkeletonCard /><SkeletonCard /></View> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}

        {!loading && !error && shown.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title={query ? "Hech narsa topilmadi" : "Birinchi ishingizni yarating"}
            message={query
              ? "Boshqa so‘z bilan qidirib ko‘ring."
              : "Taqdimot, 3×4 rasm, obyektivka yoki ilmiy ish — hammasi shu yerda saqlanadi."}
          />
        ) : null}

        <View style={styles.list}>
          {shown.map((project, index) => (
            <Appear key={`${project.kind}-${project.id}`} index={index}>
              <ProjectRow project={project} onPress={() => router.push(project.href as never)} />
            </Appear>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  // One gap between blocks rather than a margin per block, so the rhythm is
  // stated once and a new section cannot arrive at its own spacing.
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.sm },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  brand: { ...typography.title, color: colors.ink, marginTop: 2 },
  creditPill: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.primarySoft, borderRadius: radius.pill, height: 40, paddingHorizontal: spacing.lg },
  // The coin art is square, so a square box with `contain` keeps its proportions.
  coinIcon: { width: 28, height: 28 },
  creditText: { ...typography.bodyMedium, color: colors.primaryDeep },
  headerCopy: { flex: 1 },
  headerIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.ink, paddingVertical: 0 },
  tools: { flexDirection: "row", gap: spacing.sm },
  tool: {
    flex: 1,
    // Square-ish, so three sit across a phone without the labels wrapping.
    aspectRatio: 0.92,
    justifyContent: "flex-end",
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolPressed: { opacity: 0.92 },
  toolIcon: {
    // The chip's corner is the card's corner minus its padding, which is what
    // makes the two look concentric rather than merely both rounded.
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
    marginBottom: "auto",
  },
  toolLabel: { ...typography.caption, fontWeight: "700", color: colors.ink },
  toolDetail: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  secondaryRow: { flexDirection: "row", gap: spacing.sm },
  /**
   * The same material as the three cards above, one step quieter.
   *
   * These used to be grey pills with grey text and a violet icon, which made
   * three different things out of one row: a pill next to cards, a muted label
   * next to a saturated glyph. They are the same surface now, with the same
   * hairline and the same ink — only shorter, which is the whole of what
   * "secondary" should mean here.
   */
  secondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { ...typography.caption, fontWeight: "700", color: colors.ink },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.lg, marginBottom: 0 },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  list: { gap: spacing.md },
}));

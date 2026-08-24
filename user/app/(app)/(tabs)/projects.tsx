import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  FileUp, GraduationCap, IdCard, FileUser, Projector, Search, Sparkles, X,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, Text, TextInput, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue,
} from "react-native-reanimated";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Appear } from "@/components/Appear";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { CreateDeckButton } from "@/components/CreateDeckButton";
import { ProjectRow } from "@/components/ProjectRow";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { Touchable } from "@/components/Touchable";
import { asErrorMessage } from "@/lib/format";
import { formatNumber } from "@/lib/money";
import { listProjects, searchProjects, type Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { brandInk, gradients, icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Everything this account has made, in one place, with a way to find it.
 *
 * The list used to be presentations and nothing else, while a 3×4 sheet, an
 * obyektivka and an academic work were each reachable only from the screen that
 * created them — so last week's work existed and could not be got back to. And
 * with everything in one list, a search stops being a nicety: twenty-three rows
 * is a scroll, and it only grows.
 *
 * The shape is O‘yingoh's, deliberately: a hero, a grid of tiles under it, then
 * the shelf. Two screens a person moves between with one tap should not each
 * invent their own furniture. What is not borrowed is the palette — see
 * `gradients` — because siblings, not twins.
 *
 * The tiles hold the top half of the screen while a person is deciding what to
 * make, and fold into a single row of glyphs the moment they start scrolling
 * what they already made. Both are things a person does here; neither should
 * cost the other its space.
 */

type Tool = {
  key: string;
  label: string;
  detail: string;
  Glyph: LucideIcon;
  gradient: readonly [string, string];
  href: string;
};

/**
 * The five things this screen makes, in the order they are reached for.
 *
 * A photo and an obyektivka are errands — somebody needs one today, for an
 * office. An academic work is a week. Importing a deck and presenting one are
 * the two ends of a deck that already exists, so they sit together at the end.
 */
const TOOLS: readonly Tool[] = [
  { key: "portrait", label: "3×4 rasm", detail: "Hujjatga", Glyph: IdCard, gradient: gradients.portrait, href: "/(app)/portrait" },
  { key: "objective", label: "Obyektivka", detail: "DOCX / PDF", Glyph: FileUser, gradient: gradients.objective, href: "/(app)/obyektivka" },
  { key: "academic", label: "Ilmiy ish", detail: "Maqola, referat", Glyph: GraduationCap, gradient: gradients.academic, href: "/(app)/ilmiy" },
  { key: "import", label: "PowerPoint’dan", detail: "Yuklab tahrirlash", Glyph: FileUp, gradient: gradients.importDeck, href: "/(app)/import" },
  { key: "present", label: "Taqdimot qilish", detail: "Katta ekranga", Glyph: Projector, gradient: gradients.present, href: "/(app)/present/scan" },
];

/**
 * The pieces the header is built from, named so the two heights it moves
 * between are derived rather than typed twice.
 */
const SAFE_TOP = 58;
const TITLE_ROW = 52;
const SEARCH_ROW = 46;
const CHIP_ROW = 48;

export default function ProjectsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { user } = useAuth();
  const { height } = useWindowDimensions();
  const { balance, refresh: refreshAccount } = useAccount();
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [folded, setFolded] = useState(false);

  // Half the screen, whatever screen it is. Stated rather than arrived at, so
  // the split is the same proportion on a small phone as on a large one.
  const open = Math.round(height * 0.5);
  const shut = SAFE_TOP + TITLE_ROW + spacing.md + CHIP_ROW + spacing.md;
  const range = Math.max(1, open - shut);

  // The tiles get an exact height rather than a flex share, so the fold clips
  // them instead of squashing them: a tile that compresses on the way out
  // reads as a layout bug, not as an animation.
  const chrome = SAFE_TOP + TITLE_ROW + spacing.md + spacing.md + (searching ? SEARCH_ROW + spacing.md : 0);
  const tilesHeight = Math.max(CHIP_ROW, open - chrome);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });

  /**
   * The header gives back exactly what the scroll takes, one point for one
   * point, until it has nothing left. Anything else — a fold that runs faster
   * or slower than the finger — opens a gap between the header and the first
   * row that grows and shrinks as you scroll, which is the tell of a header
   * animated independently of the list under it.
   */
  const shell = useAnimatedStyle(() => ({
    // Clamped at both ends: an iOS bounce past the top would otherwise stretch
    // the header past its half and leave the extra space empty, since the
    // tiles inside it are a fixed height.
    height: Math.min(open, Math.max(shut, open - scrollY.value)),
  }));
  const wide = useAnimatedStyle(() => ({
    // Gone before the row arrives, so the two never overlap mid-fade.
    opacity: interpolate(scrollY.value, [0, range * 0.45], [1, 0], Extrapolation.CLAMP),
  }));
  const narrow = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [range * 0.55, range], [0, 1], Extrapolation.CLAMP),
  }));

  // A style cannot carry `pointerEvents`, and an invisible layer that still
  // takes taps is worse than no animation at all.
  useAnimatedReaction(() => scrollY.value > range * 0.5, (next, previous) => {
    if (next !== previous) runOnJS(setFolded)(next);
  });

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
  const go = (href: string) => router.push(href as never);

  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: open + spacing.md }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            progressViewOffset={open}
            tintColor={colors.primary}
          />
        }
      >
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
              <ProjectRow project={project} onPress={() => go(project.href)} />
            </Appear>
          ))}
        </View>
      </Animated.ScrollView>

      <Animated.View style={[styles.header, shell]}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
            <Text style={styles.brand}>Loyihalar</Text>
          </View>
          <View style={styles.titleActions}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={searching ? "Qidiruvni yopish" : "Qidirish"}
              onPress={() => { setSearching((it) => !it); if (searching) setQuery(""); }}
              style={[styles.iconButton, searching && styles.iconButtonOn]}
            >
              {searching
                ? <X color={colors.primaryDeep} size={icon.md} strokeWidth={icon.stroke} />
                : <Search color={colors.primaryDeep} size={icon.md} strokeWidth={icon.stroke} />}
            </Touchable>
            <Touchable style={styles.coinPill} onPress={() => go("/(app)/coins/buy")} accessibilityLabel="J Coin balans">
              <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
              <Text style={styles.coinText}>{formatNumber(balance)}</Text>
            </Touchable>
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

        {/* Open: what a person came here to make. */}
        <Animated.View
          style={[styles.wide, { height: tilesHeight }, wide]}
          pointerEvents={folded ? "none" : "auto"}
        >
          <CreateDeckButton onPress={() => go("/(app)/create")} />

          {/* Three, then two. The rows share what the hero leaves, so the block
              lands on half the screen without any number being typed twice. */}
          <View style={styles.tileRow}>
            {TOOLS.slice(0, 3).map((tool) => (
              <Tile key={tool.key} tool={tool} onPress={() => go(tool.href)} styles={styles} />
            ))}
          </View>
          <View style={styles.tileRow}>
            {TOOLS.slice(3).map((tool) => (
              <Tile key={tool.key} tool={tool} onPress={() => go(tool.href)} styles={styles} />
            ))}
          </View>
        </Animated.View>

        {/* Folded: the same six, as glyphs, out of the way of the shelf. */}
        <Animated.View style={[styles.narrow, narrow]} pointerEvents={folded ? "auto" : "none"}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Taqdimot yaratish"
            onPress={() => go("/(app)/create")}
            style={styles.chipShadow}
          >
            <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.chip}>
              <Sparkles color={brandInk.strong} size={icon.md} strokeWidth={2.1} />
            </LinearGradient>
          </Touchable>
          {TOOLS.map((tool) => (
            <Touchable
              key={tool.key}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              onPress={() => go(tool.href)}
              style={styles.chipShadow}
            >
              <LinearGradient colors={tool.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.chip}>
                <tool.Glyph color={brandInk.strong} size={icon.md} strokeWidth={2.1} />
              </LinearGradient>
            </Touchable>
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** One tile. Its own component so each carries its own press spring. */
function Tile({
  tool,
  onPress,
  styles,
}: {
  tool: Tool;
  onPress: () => void;
  styles: ReturnType<typeof useStyles>;
}) {
  return (
    <Touchable
      accessibilityRole="button"
      accessibilityLabel={tool.label}
      onPress={onPress}
      style={styles.tileShadow}
    >
      <LinearGradient colors={tool.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
        <tool.Glyph color={brandInk.strong} size={icon.lg} strokeWidth={1.9} />
        <View style={styles.tileCopy}>
          <Text numberOfLines={1} style={styles.tileLabel}>{tool.label}</Text>
          <Text numberOfLines={1} style={styles.tileDetail}>{tool.detail}</Text>
        </View>
      </LinearGradient>
    </Touchable>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },

  /**
   * Over the shelf rather than above it.
   *
   * A header that is a sibling of the list re-lays the list out on every frame
   * of the fold. This one floats, the list is padded to clear it, and folding
   * moves nothing but the header itself.
   */
  header: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    paddingTop: 58,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.canvas,
    overflow: "hidden",
  },

  titleRow: { height: TITLE_ROW, flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  titleCopy: { flex: 1 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  brand: { ...typography.title, color: colors.ink },
  titleActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  // The search button and the balance are the same object seen twice: one
  // height, one corner, one family. They used to be a violet circle beside a
  // violet pill, which read as two unrelated controls that happened to touch.
  iconButton: {
    width: 40, height: 40, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  iconButtonOn: { backgroundColor: colors.primarySoft },
  coinPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    height: 40, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  coinIcon: { width: 22, height: 22 },
  coinText: { ...typography.bodyMedium, color: colors.primaryDeep },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    height: SEARCH_ROW, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.ink, paddingVertical: 0 },

  wide: { gap: spacing.md },

  // The rows take what the hero leaves, so the block fills its half exactly
  // whatever the phone. `minHeight` keeps a tile from folding to nothing on a
  // short screen before the fold animation ever runs.
  tileRow: { flex: 1, flexDirection: "row", gap: spacing.md },
  tileShadow: { flex: 1, borderRadius: radius.lg, ...shadow },
  tile: {
    flex: 1,
    borderRadius: radius.lg, padding: spacing.md,
    justifyContent: "space-between", gap: spacing.sm,
  },
  tileCopy: { gap: 1 },
  tileLabel: { ...typography.bodyMedium, fontSize: 14, color: brandInk.strong },
  tileDetail: { ...typography.caption, fontSize: 11, color: brandInk.muted },

  // Zero on three sides, not `spacing.xl`: an absolutely placed child is laid
  // out against its parent's padding box, so the header's own padding already
  // insets this row. Repeating the inset here would double it.
  narrow: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: spacing.sm,
  },
  chipShadow: { flex: 1, borderRadius: radius.md, ...shadow },
  chip: {
    flex: 1, height: CHIP_ROW, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
  },

  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  list: { gap: spacing.md },
}));

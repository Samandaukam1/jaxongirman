import { useFocusEffect, useRouter } from "expo-router";
import { Search, Sparkles, X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler,
  useAnimatedStyle, useDerivedValue, useSharedValue,
} from "react-native-reanimated";

import coinIcon from "../../../assets/coin/coin-icon.png";
/**
 * The icons, named for what each one draws rather than for its file.
 *
 * The six files are one sheet of six icons, each cropping out a different
 * region of it, and the file numbers do not run in the order the sheet was
 * laid out. `1.svg` is the photo, `4.svg` is the slide stack — so the names
 * here come from the picture, not the digit, and anyone changing a mapping
 * later has something to check it against.
 */
import PortraitArt from "../../../assets/icons/1.svg";
import ObjectiveArt from "../../../assets/icons/2.svg";
import ScientificArt from "../../../assets/icons/3.svg";
import SlideCreateArt from "../../../assets/icons/4.svg";
import PowerPointArt from "../../../assets/icons/5.svg";
import PresentArt from "../../../assets/icons/6.svg";
import { Appear } from "@/components/Appear";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";

import { ProjectRow } from "@/components/ProjectRow";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { HeroToolCard, ToolCard, type ToolArt } from "@/components/ToolCard";
import { Touchable } from "@/components/Touchable";
import { asErrorMessage } from "@/lib/format";
import { blend, withAlpha } from "@/theme/color";
import { useReduceMotion } from "@/lib/motion";
import { formatNumber } from "@/lib/money";
import { listProjects, searchProjects, type Project } from "@/lib/projects";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, spacing, toolTint, typography } from "@/theme/tokens";
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
  art: ToolArt;
  /** The hue its own drawing is lit by — see `toolTint`. */
  tint: string;
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
  { key: "portrait", label: "3×4 rasm", detail: "Hujjatga", art: PortraitArt, tint: toolTint.portrait, href: "/(app)/portrait" },
  { key: "objective", label: "Obyektivka", detail: "DOCX / PDF", art: ObjectiveArt, tint: toolTint.objective, href: "/(app)/obyektivka" },
  { key: "academic", label: "Ilmiy ish", detail: "Maqola, referat", art: ScientificArt, tint: toolTint.academic, href: "/(app)/ilmiy" },
  { key: "import", label: "PowerPoint", detail: "Yuklab tahrirlash", art: PowerPointArt, tint: toolTint.importDeck, href: "/(app)/import" },
  { key: "present", label: "Taqdimot qilish", detail: "Katta ekranga", art: PresentArt, tint: toolTint.present, href: "/(app)/present/scan" },
];

/**
 * Tile sizes, per row. Bigger where there is room for it and the action matters
 * more. These are smaller than the sizes the vector pack needed: each Liquid
 * Glass tile fills its own frame, so the number here is what you see, with no
 * empty margin to pay for.
 */
const HERO_ART = 74;
const TILE_ART = 54;
const WIDE_ART = 60;
const CHIP_ART = 32;

/**
 * The pieces the header is built from, named so the two heights it moves
 * between are derived rather than typed twice.
 */
const SAFE_TOP = 58;
const TITLE_ROW = 52;
const SEARCH_ROW = 46;
const CHIP_ROW = 48;

/**
 * What the open header is worth before it has been measured.
 *
 * The block is measured rather than assigned a share of the screen: art, a
 * title and a line under it need the height they need, and forcing them into
 * an exact half of every phone means clipping them on the short ones. This is
 * only the first frame's guess — close enough that nothing jumps when the real
 * number arrives one layout later.
 */
const ESTIMATED_CARDS = 332;

export default function ProjectsScreen() {
  const { colors, scheme } = useTheme();
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
  const [folded, setFolded] = useState(false);
  const [cards, setCards] = useState(ESTIMATED_CARDS);

  const chrome = SAFE_TOP + TITLE_ROW + spacing.md + spacing.md + (searching ? SEARCH_ROW + spacing.md : 0);
  const open = chrome + cards;
  const shut = SAFE_TOP + TITLE_ROW + spacing.md + CHIP_ROW + spacing.md;
  const range = Math.max(1, open - shut);

  // Measured once. The cards do not resize afterwards, and re-reading a layout
  // that cannot change would only re-render the screen for nothing.
  const measure = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setCards((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);

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

  /**
   * How far through its shrink the artwork is, as one value the six cards share.
   *
   * Derived here rather than computed inside each card: six subscriptions to
   * the same scroll position, each running the same interpolation every frame,
   * is five more than the screen needs. The cards take this and do nothing but
   * read it.
   *
   * It leads the fold slightly — finished at 60% of the way through — so the
   * drawings have settled at their small size by the time the cards behind them
   * start fading out, rather than still moving as they go.
   */
  const reduced = useReduceMotion();
  const artFold = useDerivedValue(() => (
    reduced ? 0 : interpolate(scrollY.value, [0, range * 0.6], [0, 1], Extrapolation.CLAMP)
  ));

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
      setItems(await listProjects(user.id));
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

  /**
   * The folded row's chips, each carrying a trace of its own card's colour, so
   * that folding the header changes the size of the six tools and nothing else
   * about them. Opaque rather than a wash: a chip is its own background, and
   * there is nothing behind one to show through (see `blend`).
   */
  const chipSkin = useCallback((tint: string) => ({
    backgroundColor: blend(colors.softCard, tint, scheme === "dark" ? 0.18 : 0.1),
    borderColor: withAlpha(tint, scheme === "dark" ? 0.32 : 0.24),
  }), [colors.softCard, scheme]);

  const shown = useMemo(() => searchProjects(items, query), [items, query]);
  const go = (href: string) => router.push(href as never);

  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        style={styles.scroll}
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
        <Animated.View style={[styles.wide, wide]} onLayout={measure} pointerEvents={folded ? "none" : "auto"}>
          <HeroToolCard
            art={SlideCreateArt}
            size={HERO_ART}
            title="Taqdimot yaratish"
            detail="Jaxongir AI bilan yangi slayd"
            tint={toolTint.slideCreate}
            onPress={() => go("/(app)/create")}
            progress={artFold}
          />

          {/* Three, then two. The rows share what the hero leaves, so the block
              lands on half the screen without any number being typed twice. */}
          <View style={styles.tileRow}>
            {TOOLS.slice(0, 3).map((tool) => (
              <ToolCard
                key={tool.key}
                art={tool.art}
                size={TILE_ART}
                title={tool.label}
                detail={tool.detail}
                tint={tool.tint}
                onPress={() => go(tool.href)}
                progress={artFold}
              />
            ))}
          </View>
          <View style={styles.tileRow}>
            {TOOLS.slice(3).map((tool) => (
              <ToolCard
                key={tool.key}
                art={tool.art}
                size={WIDE_ART}
                title={tool.label}
                detail={tool.detail}
                tint={tool.tint}
                onPress={() => go(tool.href)}
                progress={artFold}
              />
            ))}
          </View>
        </Animated.View>

        {/* Folded: the same six drawings, small, out of the way of the shelf. */}
        <Animated.View style={[styles.narrow, narrow]} pointerEvents={folded ? "auto" : "none"}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel="Taqdimot yaratish"
            onPress={() => go("/(app)/create")}
            style={[styles.chip, chipSkin(toolTint.slideCreate)]}
          >
            <SlideCreateArt width={CHIP_ART} height={CHIP_ART} />
          </Touchable>
          {TOOLS.map((tool) => (
            <Touchable
              key={tool.key}
              accessibilityRole="button"
              accessibilityLabel={tool.label}
              onPress={() => go(tool.href)}
              style={[styles.chip, chipSkin(tool.tint)]}
            >
              <tool.art width={CHIP_ART} height={CHIP_ART} />
            </Touchable>
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },

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

  // No flex on the row: it is as tall as its cards, and the cards are as tall
  // as what is drawn and written on them. Stretch is the default across the
  // row, so three cards of different copy still share one height.
  tileRow: { flexDirection: "row", gap: spacing.md },

  // Inset by hand. An absolutely placed child here is laid out against the
  // header's border box, not its padding box, so it does not inherit the
  // padding the flow children sit inside — left at zero it lands flush against
  // the edge of the screen.
  narrow: {
    position: "absolute",
    left: spacing.xl, right: spacing.xl, bottom: spacing.md,
    flexDirection: "row", gap: spacing.sm,
  },
  chip: {
    flex: 1, height: CHIP_ROW, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },

  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.ink },
  sectionCount: { ...typography.caption, color: colors.primary, backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill },
  list: { gap: spacing.md },
}));

import type { GameStatus } from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { Bell, ChevronRight, Gamepad2, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Keyboard, Pressable, RefreshControl, ScrollView, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Easing, Extrapolation, interpolate, runOnJS, runOnUI, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler,
  useAnimatedStyle, useDerivedValue, useSharedValue, withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { useDeleteWork, useWorkRowAccessibility, WorkRowEnd } from "@/components/DeleteWorkButton";
import {
  CreateGameArt, CrosswordArt, GamepadArt, GiftArt, HostArt, JoinArt, MafiaArt, MedalArt, PlayArt, QuizArt, StoreArt, TeamArt, TestsArt, TrophyArt,
} from "@/components/gameArt";
import { HeroToolCard, StillTouchable, ToolCard } from "@/components/ToolCard";
import type { Art } from "@/components/toolArt";
import { Appear } from "@/components/Appear";
import { Touchable } from "@/components/Touchable";
import { SelectCheck, SelectionBar, useSelectedRowStyle, useWorkSelection, type SelectableWork } from "@/components/WorkSelection";
import { BOTTOM_NAV_SPACE, useBottomNavSpace } from "@/components/BottomNav";
import { MarathonVoteButton } from "@/components/MarathonVoteButton";
import { EmptyState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { readerSpelling } from "@/i18n";
import { useFocusRefresh } from "@/lib/useFocusRefresh";
import { useReduceMotion } from "@/lib/motion";
import { blend, withAlpha } from "@/theme/color";
import { inertOnWeb, isWeb } from "@/lib/web";
import { formatDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { labelOf } from "@/lib/labels";
import { searchProjects } from "@/lib/project-search";
import {
  listCategories, listFreeGames, listMyGames, listMyMatches, liveMatch, myGameStats,
  type Game, type GameCategory,
} from "@/lib/games";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Shelf = "all" | "mine" | "bought" | "presentation" | "played";

/** The shelves, in the order offered; their names are in the `games` table under `shelf`. */
const SHELVES: readonly Shelf[] = ["all", "mine", "bought", "presentation", "played"];

type Match = { session_id: string; joined_at: string; total_score: number; rank: number | null; game_title: string };

/** The same header as Loyihalar, piece for piece: art sizes, rows, and the open block's first guess. */
const HERO_ART = 74;
const TILE_ART = 54;
const CHIP_ART = 32;
// One line of title centred on the 40-point buttons, no eyebrow over it; measured, so this is only its floor (see Loyihalar).
const TITLE_ROW = 44;
const SEARCH_ROW = 46;
const CHIP_ROW = 48;
const ESTIMATED_CARDS = 354;

/**
 * O‘yingoh's hues, sampled from its own drawings as `toolTint` is from
 * Loyihalar's: each is the middle of its drawing's gradient. Create and Teams
 * share a violet-to-pink family, so their cards lean to opposite ends of it.
 */
const gameTint = {
  create: "#B44CF0",
  join: "#22BFEA",
  host: "#3F6AF5",
  crossword: "#F5A831",
  tests: "#3FD65A",
  mafia: "#EE464D",
  team: "#E83BC8",
} as const;

type ToolKey = "join" | "host" | "crossword" | "tests" | "mafia" | "team";
type GameTool = { key: ToolKey; art: Art; tint: string; href: string | { pathname: string; params: Record<string, string> } };

/** What can be made or opened from here, in two rows of three under the hero. */
const TOOLS: readonly GameTool[] = [
  { key: "join", art: JoinArt, tint: gameTint.join, href: "/oyingoh/join" },
  { key: "host", art: HostArt, tint: gameTint.host, href: "/oyingoh/scan" },
  { key: "crossword", art: CrosswordArt, tint: gameTint.crossword, href: { pathname: "/oyingoh/create", params: { kind: "crossword" } } },
  { key: "tests", art: TestsArt, tint: gameTint.tests, href: "/test" },
  { key: "mafia", art: MafiaArt, tint: gameTint.mafia, href: "/oyingoh/mafia" },
  { key: "team", art: TeamArt, tint: gameTint.team, href: { pathname: "/oyingoh/create", params: { kind: "grid" } } },
];
type Stats = { played: number; wins: number; top3: number; average_score: number; coins_won: number };

/**
 * The O‘yingoh front door, built like Loyihalar: a header that floats over the
 * shelf — the hero to make a game and six glass tools (join, host, crossword,
 * tests, Mafia, teams) — which folds into a row of chips as the shelf
 * scrolls, giving back one point for every point scrolled. Under it: a match
 * still running, one's numbers, and every shelf a person's games live on.
 * Purchased games arrive through marketplace entitlements, so "mine" and
 * "bought" are separated by ownership, not by copies.
 */
export default function GamesScreen() {
  const bottomSpace = useBottomNavSpace();
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["games", "inbox"]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { balance, unreadCount } = useAccount();
  const { user } = useAuth();
  const [shelf, setShelf] = useState<Shelf>("all");
  const [games, setGames] = useState<Game[]>([]);
  const [boughtIds, setBoughtIds] = useState<Set<string>>(new Set());
  const [freeGames, setFreeGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<GameCategory[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // A match this account is still in: a phone closed mid-game comes back to it.
  const [live, setLive] = useState<Awaited<ReturnType<typeof liveMatch>>>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const [mine, free, cats, played, myStats, entitled] = await Promise.all([
        listMyGames(user.id),
        listFreeGames(),
        listCategories(),
        // This account's own rows: the room's other players are readable too.
        listMyMatches(user.id),
        myGameStats(),
        supabase.from("purchase_entitlements")
          .select("product_id, marketplace_products!inner(game_id)")
          .is("revoked_at", null),
      ]);
      setGames(mine);
      setFreeGames(free);
      setCategories(cats.filter((category) => !category.parent_id));
      setMatches(played);
      setStats(myStats);
      const ids = new Set<string>();
      for (const row of entitled.data ?? []) {
        const gameId = (row.marketplace_products as unknown as { game_id: string | null })?.game_id;
        if (gameId) ids.add(gameId);
      }
      setBoughtIds(ids);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusRefresh(load);

  // The way back into a running match is read on every visit, past the
  // twenty-second gate on the rest: someone who has just left a match comes
  // straight here to find it. A read that failed keeps the row it last showed
  // rather than hiding it during a network blip (see liveMatch).
  const loadLive = useCallback(() => {
    if (user) void liveMatch(user.id).then(setLive, () => undefined);
  }, [user]);
  useFocusEffect(loadLive);

  const shelfGames = useMemo(() => {
    switch (shelf) {
      case "mine": return games.filter((game) => !boughtIds.has(game.id));
      case "bought": return games.filter((game) => boughtIds.has(game.id));
      case "presentation": return games.filter((game) => game.source_type === "presentation");
      default: return games;
    }
  }, [boughtIds, games, shelf]);

  /**
   * The search, as on Loyihalar: every word somewhere in the title or the
   * kind, with the alphabets and apostrophes folded (see `project-search`).
   * It narrows the shelf that is open, so the tabs keep meaning what they say.
   */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // The keyboard is up for the search box: the moment to give its results room.
  const [typing, setTyping] = useState(false);
  const filtering = query.trim().length > 0;
  const kindName = useCallback((game: Game) => (
    game.kind === "crossword" ? t("crossword.badge") : game.kind === "grid" ? t("grid.badge") : t("search.quiz")
  ), [t]);
  const shownGames = useMemo(() => searchProjects(
    shelfGames.map((game) => ({ game, title: game.title || t("untitled"), detail: kindName(game), kind: game.kind ?? "" })),
    query,
  ).map(({ game }) => game), [kindName, query, shelfGames, t]);
  const shownMatches = useMemo(() => searchProjects(
    matches.map((match) => ({ match, title: match.game_title, detail: "", kind: "" })),
    query,
  ).map(({ match }) => match), [matches, query]);

  /**
   * A game as the selection sees it. Only a game this account made can be
   * deleted — a bought one is a licence, not a file — and only a finished one
   * can be sent.
   */
  const userId = user?.id;
  const asWork = useCallback((game: Game): SelectableWork => ({
    kind: "game",
    id: game.id,
    title: game.title || t("untitled"),
    sendable: game.status === "ready",
    deletable: game.owner_id === userId && !boughtIds.has(game.id),
  }), [boughtIds, t, userId]);
  // Chosen from every game loaded, not only the open shelf or the search's results.
  const works = useMemo(() => games.map(asWork), [asWork, games]);
  const selection = useWorkSelection(works, (work) => {
    setGames((current) => current.filter((item) => item.id !== work.id));
  });

  // The header's two heights, as Loyihalar derives them: open (the cards measured) and shut (a row of chips).
  const reduced = useReduceMotion();
  const [cards, setCards] = useState(ESTIMATED_CARDS);
  // The title row grows with large text rather than running into the cards under it.
  const [titleRow, setTitleRow] = useState(TITLE_ROW);
  const [viewport, setViewport] = useState(0);
  const safeTop = Math.max(insets.top, 20) + spacing.xs;
  // Folded, the header still holds the search box when it is open: the chips sit under it.
  const searchRow = searching ? SEARCH_ROW + spacing.md : 0;
  const open = safeTop + titleRow + spacing.md + spacing.md + searchRow + cards;
  const shut = safeTop + titleRow + spacing.md + searchRow + CHIP_ROW + spacing.md;
  const range = Math.max(1, open - shut);
  const measure = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setCards((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);
  const measureTitle = useCallback((event: LayoutChangeEvent) => {
    const next = Math.max(TITLE_ROW, Math.round(event.nativeEvent.layout.height));
    setTitleRow((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);
  const measureViewport = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setViewport((current) => (Math.abs(current - next) > 1 ? next : current));
  }, []);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });

  /**
   * Typing in the search folds the header too, exactly as on Loyihalar: while
   * the keyboard is up for the search box the tools shrink to their chips on
   * their own clock (a third of a second, easing out), and the header folds by
   * whichever is further along, the scroll or the search. Hiding the keyboard
   * or closing the search unfolds it.
   */
  const searchFold = useSharedValue(0);
  const folding = searching && typing;
  // A keyboard put away with the system's own control leaves the box focused on some phones; its hiding is what counts.
  useEffect(() => {
    const hidden = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => hidden.remove();
  }, []);
  const fold = useDerivedValue(() => Math.max(scrollY.value, searchFold.value * range));

  /**
   * Typing starts the search's fold from wherever the scroll had already
   * folded the header, and takes the shelf back to its top in the same frame,
   * so the results rise to sit right under the search box instead of being
   * left under the folded header at the offset the shelf was scrolled to.
   */
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const wasFolding = useRef(false);
  useEffect(() => {
    const starting = folding && !wasFolding.current;
    wasFolding.current = folding;
    const duration = reduced ? 0 : 320;
    runOnUI((seed: boolean, span: number) => {
      "worklet";
      if (seed) {
        searchFold.value = Math.min(1, fold.value / span);
        scrollTo(scrollRef, 0, 0, false);
      }
      searchFold.value = withTiming(folding ? 1 : 0, { duration, easing: Easing.out(Easing.cubic) });
    })(starting, range);
  }, [folding, reduced, range, fold, scrollRef, searchFold]);
  // What the shelf gives up while the search holds the header folded, so the first result sits right under the chips.
  const spacer = useAnimatedStyle(() => ({ height: range * (1 - searchFold.value) }));

  // One point back for every point scrolled, clamped at both ends (an iOS bounce must not stretch it).
  const shell = useAnimatedStyle(() => ({ height: Math.min(open, Math.max(shut, open - fold.value)) }));
  const wide = useAnimatedStyle(() => ({ opacity: interpolate(fold.value, [0, range * 0.45], [1, 0], Extrapolation.CLAMP) }));
  const narrow = useAnimatedStyle(() => ({ opacity: interpolate(fold.value, [range * 0.55, range], [0, 1], Extrapolation.CLAMP) }));
  const artFold = useDerivedValue(() => (reduced ? 0 : interpolate(fold.value, [0, range * 0.6], [0, 1], Extrapolation.CLAMP)));
  // Each layer takes touches only while it can be seen: the cards until they are
  // nearly gone, the chips once they are nearly there. Between the two, neither —
  // an invisible card that still opens on a tap is worse than no animation at all.
  const [wideLive, setWideLive] = useState(true);
  const [narrowLive, setNarrowLive] = useState(false);
  useAnimatedReaction(() => fold.value < range * 0.4, (next, previous) => {
    if (next !== previous) runOnJS(setWideLive)(next);
  });
  useAnimatedReaction(() => fold.value > range * 0.6, (next, previous) => {
    if (next !== previous) runOnJS(setNarrowLive)(next);
  });

  /** A folded chip carries a trace of its card's colour, as on Loyihalar. */
  const chipSkin = useCallback((tint: string) => ({
    backgroundColor: blend(colors.softCard, tint, scheme === "dark" ? 0.18 : 0.1),
    borderColor: withAlpha(tint, scheme === "dark" ? 0.32 : 0.24),
  }), [colors.softCard, scheme]);

  const go = (href: GameTool["href"]) => router.push(href as never);
  const toolDetail = (key: ToolKey) => (key === "host" && isWeb ? t("tiles.host.detailWeb") : t(`tiles.${key}.detail`));

  return (
    <View style={styles.safe}>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        onScroll={onScroll}
        onLayout={measureViewport}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          // A short shelf can still be scrolled the whole fold, so the header never rests half-folded.
          { paddingTop: shut + spacing.md, paddingBottom: bottomSpace + spacing.xl, minHeight: viewport + range },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLive(); void load(); }} progressViewOffset={open} tintColor={colors.primary} />
        }
      >
        {/* Stands in for the unfolded header and gives way while searching; its negative margin cancels the content's gap. */}
        <Animated.View style={[styles.foldSpacer, spacer]} />

        {live ? (
          <Touchable
            style={styles.liveRow}
            onPress={() => router.push(live.host
              ? { pathname: "/(app)/oyingoh/host/[sessionId]", params: { sessionId: live.sessionId } }
              : { pathname: "/(app)/oyingoh/play/[sessionId]", params: { sessionId: live.sessionId } })}
            accessibilityRole="button"
          >
            <View style={styles.rowArt}>
              {live.kind === "mafia" ? <MafiaArt width={38} height={38} /> : <PlayArt width={38} height={38} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.gameTitle} numberOfLines={1}>{t("mafia.resume")}</Text>
              <Text style={styles.gameMeta} numberOfLines={1}>
                {live.kind === "mafia" ? t("mafia.title") : live.title || t("untitled")} · {t("mafia.resumeHint")}
              </Text>
            </View>
            <ChevronRight color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
          </Touchable>
        ) : null}

        {error ? <InlineError message={error} /> : null}

        {stats && stats.played > 0 && !filtering ? (
          <View style={styles.statsRow}>
            <StatCard art={GamepadArt} value={stats.played} label={t("stats.played")} />
            <StatCard art={TrophyArt} value={stats.wins} label={t("stats.wins")} />
            <StatCard art={MedalArt} value={stats.top3} label={t("stats.top3")} />
            <StatCard art={GiftArt} value={stats.coins_won} label={t("stats.coins")} />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{filtering ? t("search.found") : t("mine")}</Text>
        <ScrollView horizontal style={styles.strip} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfTabs}>
          {SHELVES.map((key) => (
            <Pressable
              key={key}
              style={[styles.shelfTab, shelf === key && styles.shelfTabActive]}
              onPress={() => setShelf(key)}
              accessibilityRole="button"
              // A browser drops aria-selected from a button; there the shelf is a pressed toggle.
              aria-selected={isWeb ? undefined : shelf === key}
              aria-pressed={isWeb ? shelf === key : undefined}
            >
              <Text style={[styles.shelfTabText, shelf === key && styles.shelfTabTextActive]}>{t(`shelf.${key}`)}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={{ gap: spacing.md }}><SkeletonCard /><SkeletonCard /></View>
        ) : filtering && (shelf === "played" ? shownMatches : shownGames).length === 0 ? (
          <EmptyState icon={Search} title={t("search.none")} message={t("search.noneBody")} />
        ) : shelf === "played" ? (
          matches.length === 0 ? (
            <EmptyState icon={Gamepad2} title={t("noMatches")} message={t("noMatchesBody")} />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {shownMatches.map((match) => (
                <View key={match.session_id} style={styles.matchRow}>
                  <View style={styles.matchRank}>
                    <Text style={styles.matchRankText}>{match.rank ? `#${match.rank}` : "—"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameTitle} numberOfLines={1}>{match.game_title}</Text>
                    <Text style={styles.gameMeta}>{formatDate(match.joined_at)}</Text>
                  </View>
                  <Text style={styles.matchScore}>{formatNumber(match.total_score)}</Text>
                </View>
              ))}
            </View>
          )
        ) : shelfGames.length === 0 ? (
          <EmptyState
            icon={Gamepad2}
            title={t("noGames")}
            message={t("noGamesBody")}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {shownGames.map((game, index) => {
              const work = asWork(game);
              return (
                <Appear key={game.id} index={index}>
                  <GameRow
                    game={game}
                    onPress={() => router.push(`/oyingoh/${game.id}`)}
                    onDeleted={work.deletable
                      ? () => setGames((current) => current.filter((item) => item.id !== game.id))
                      : undefined}
                    selecting={selection.active}
                    selected={selection.isSelected(work)}
                    onSelect={() => selection.pick(work)}
                  />
                </Appear>
              );
            })}
          </View>
        )}

        {freeGames.length > 0 && !filtering ? (
          <>
            <Text style={styles.sectionTitle}>{t("free")}</Text>
            <ScrollView horizontal style={styles.strip} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {freeGames.map((game) => (
                <Touchable
                  key={game.id}
                  accessibilityRole="button"
                  style={styles.freeCard}
                  onPress={() => router.push(`/oyingoh/${game.id}`)}
                >
                  <View style={styles.freeTop}>
                    <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>{t("freeBadge")}</Text></View>
                    {game.kind === "crossword" ? <CrosswordArt width={30} height={30} /> : game.kind === "grid" ? <TeamArt width={30} height={30} /> : <QuizArt width={30} height={30} />}
                  </View>
                  <Text style={styles.freeTitle} numberOfLines={2}>{game.title}</Text>
                  <Text style={styles.gameMeta}>{t("questions", { count: game.question_count })}</Text>
                </Touchable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {categories.length > 0 && !filtering ? (
          <>
            <Text style={styles.sectionTitle}>{t("categories")}</Text>
            <View style={styles.categoryGrid}>
              {categories.map((category) => (
                <Touchable
                  key={category.id}
                  accessibilityRole="button"
                  style={styles.categoryChip}
                  onPress={() => router.push({ pathname: "/oyingoh/create", params: { categoryId: category.id, categoryLabel: readerSpelling(category.label) } })}
                >
                  <Text style={styles.categoryText}>{readerSpelling(category.label)}</Text>
                </Touchable>
              ))}
            </View>
          </>
        ) : null}

        <Pressable style={styles.marketLink} onPress={() => router.push("/(app)/(tabs)/marketplace")} accessibilityRole="button">
          <StoreArt width={30} height={30} />
          <Text style={styles.marketLinkText}>{t("toStore")}</Text>
        </Pressable>
      </Animated.ScrollView>

      {/* The header floats over the shelf: open, the hero and six tools; folded, a row of chips. */}
      <Animated.View style={[styles.header, { paddingTop: safeTop }, shell]}>
        {/* Under the selection bar while rows are being chosen: kept in place, so its measured height holds the fold still. */}
        <View style={[styles.titleRow, selection.active && styles.underBar]} onLayout={measureTitle}
          pointerEvents={selection.active ? "none" : "auto"} aria-hidden={selection.active} {...inertOnWeb(selection.active)}>
          <View style={styles.titleCopy}>
            {/* Shares the row with the buttons beside it; on a narrow phone the name gives a little size rather than letters. */}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.brand}>{t("title")}</Text>
          </View>
          <View style={styles.titleActions}>
            <MarathonVoteButton variant="compact" />
            <Touchable style={styles.coinPill} onPress={() => router.push("/coins/buy")} accessibilityRole="button"
              accessibilityLabel={`${t("balance")}: ${formatNumber(balance)}`}>
              <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
              <Text style={styles.coinText}>{formatNumber(balance)}</Text>
            </Touchable>
            {/* The vote button keeps its place beside the balance; the search sits with the bell, the row's other round button. */}
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={searching ? t("search.close") : t("search.open")}
              onPress={() => { setSearching((it) => !it); if (searching) { setQuery(""); setTyping(false); } }}
              style={[styles.iconButton, searching && styles.iconButtonOn]}
            >
              {searching
                ? <X color={colors.primaryDeep} size={icon.md} strokeWidth={icon.stroke} />
                : <Search color={colors.primaryDeep} size={icon.md} strokeWidth={icon.stroke} />}
            </Touchable>
            <Touchable style={styles.iconButton} onPress={() => router.push("/notifications")} accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `${t("notifications")}, ${t("inbox:unread", { count: unreadCount })}` : t("notifications")}>
              <Bell color={colors.primaryDeep} size={icon.md} strokeWidth={icon.stroke} />
              {unreadCount > 0 ? <View style={styles.badge} /> : null}
            </Touchable>
          </View>
        </View>

        {selection.active ? <SelectionBar selection={selection} style={[styles.selectionBar, { top: safeTop, height: titleRow }]} /> : null}

        {searching ? (
          <View style={styles.searchBox}>
            <Search color={colors.inkSoft} size={17} strokeWidth={2} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={(text) => { setQuery(text); scrollRef.current?.scrollTo({ y: 0, animated: false }); }}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder={t("search.placeholder")}
              placeholderTextColor={colors.inkSoft}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {query ? (
              <Pressable accessibilityLabel={t("search.clear")} onPress={() => setQuery("")} hitSlop={8}>
                <X color={colors.inkSoft} size={16} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <Animated.View style={[styles.wide, wide]} onLayout={measure} pointerEvents={wideLive ? "auto" : "none"}
          aria-hidden={!wideLive} {...inertOnWeb(!wideLive)}>
          <HeroToolCard
            art={CreateGameArt}
            size={HERO_ART}
            title={t("create.title")}
            detail={t("create.subtitle")}
            tint={gameTint.create}
            onPress={() => go("/oyingoh/create")}
            progress={artFold}
            lines={2}
          />
          <View style={styles.tileRow}>
            {TOOLS.slice(0, 3).map((tool) => (
              <ToolCard key={tool.key} art={tool.art} size={TILE_ART} title={t(`tiles.${tool.key}.label`)} detail={toolDetail(tool.key)}
                tint={tool.tint} onPress={() => go(tool.href)} progress={artFold} />
            ))}
          </View>
          <View style={styles.tileRow}>
            {TOOLS.slice(3).map((tool) => (
              <ToolCard key={tool.key} art={tool.art} size={TILE_ART} title={t(`tiles.${tool.key}.label`)} detail={toolDetail(tool.key)}
                tint={tool.tint} onPress={() => go(tool.href)} progress={artFold} />
            ))}
          </View>
        </Animated.View>

        <Animated.View style={[styles.narrow, narrow]} pointerEvents={narrowLive ? "auto" : "none"}
          aria-hidden={!narrowLive} {...inertOnWeb(!narrowLive)}>
          <StillTouchable accessibilityRole="button" accessibilityLabel={t("create.title")} onPress={() => go("/oyingoh/create")}
            style={[styles.chip, chipSkin(gameTint.create)]}>
            <CreateGameArt width={CHIP_ART} height={CHIP_ART} />
          </StillTouchable>
          {TOOLS.map((tool) => (
            <StillTouchable key={tool.key} accessibilityRole="button" accessibilityLabel={t(`tiles.${tool.key}.label`)} onPress={() => go(tool.href)}
              style={[styles.chip, chipSkin(tool.tint)]}>
              <tool.art width={CHIP_ART} height={CHIP_ART} />
            </StillTouchable>
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function StatCard({ art: Drawing, value, label }: { art: Art; value: number; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.statCard}>
      <Drawing width={30} height={30} />
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function GameRow({ game, onPress, onDeleted, selecting = false, selected = false, onSelect }: {
  game: Game;
  onPress: () => void;
  onDeleted?: () => void;
  /** Rows are being chosen: a tap ticks this one instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  /** A long press, or a tap while choosing — see `useWorkSelection`. */
  onSelect?: () => void;
}) {
  const styles = useStyles();
  const chosen = useSelectedRowStyle();
  const { t } = useTranslation("games");
  const status = game.status as GameStatus;
  const title = game.title || t("untitled");
  const deletion = useDeleteWork("game", game.id, title, onDeleted ?? (() => undefined));
  // A finished game goes to the chat from its row, one tap on the plane.
  const sendable = status === "ready";
  const access = useWorkRowAccessibility({ kind: "game", id: game.id, title, sendable, onDeleted, deletion, selecting, onSelect });
  const meta = `${game.kind === "crossword" ? t("crossword.badge")
    : game.kind === "grid" ? `${t("grid.badge")} · ${t("questions", { count: game.question_count })}`
    : t("questions", { count: game.question_count })} · ${labelOf("gameStatus", game.status)}`;
  return (
    <Touchable style={[styles.gameRow, selected && chosen]} onPress={selecting && onSelect ? onSelect : onPress}
      // While choosing, the row is a checkbox: that is what a tap on it does.
      accessibilityRole={selecting ? "checkbox" : "button"} accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${title}, ${meta}`} {...access}
      disabled={deletion.busy}
      // Longer in a browser, where a long press is also a slow click.
      onLongPress={onSelect} delayLongPress={isWeb ? 600 : 380}>
      <View style={styles.rowArt}>
        {game.kind === "crossword" ? <CrosswordArt width={34} height={34} /> : game.kind === "grid" ? <TeamArt width={34} height={34} /> : <QuizArt width={34} height={34} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.gameTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.gameMeta}>{meta}</Text>
      </View>
      <View style={[styles.statusDot, status === "ready" ? styles.statusReady : status === "generating" ? styles.statusBusy : styles.statusDraft]} />
      {selecting
        ? <SelectCheck selected={selected} />
        : <WorkRowEnd kind="game" id={game.id} title={title} sendable={sendable} onDeleted={onDeleted} deletion={deletion} />}
    </Touchable>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  // Stands in for the open header; the negative margin cancels the content's gap after it.
  foldSpacer: { marginBottom: -spacing.lg },

  /** Over the shelf rather than above it, exactly as on Loyihalar: folding moves nothing but the header. */
  header: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.canvas,
    overflow: "hidden",
  },
  titleRow: { minHeight: TITLE_ROW, flexDirection: "row", alignItems: "center", gap: spacing.md },
  titleCopy: { flex: 1 },
  brand: { ...typography.title, color: colors.ink },
  titleActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  underBar: { opacity: 0 },
  // Inset by hand, as `narrow` is: an absolute child does not sit inside the header's padding.
  selectionBar: { position: "absolute", left: spacing.xl, right: spacing.xl },
  // The same pill as Loyihalar, to the point. Two tabs a person switches
  // between with one tap cannot each have their own balance chip.
  coinPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    height: 40, paddingHorizontal: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  coinIcon: { width: 22, height: 22 },
  coinText: { ...typography.bodyMedium, color: colors.primaryDeep },
  iconButton: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
  iconButtonOn: { backgroundColor: colors.primarySoft },
  badge: { position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  // Loyihalar's search box, to the point.
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    height: SEARCH_ROW, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
  },
  searchInput: { ...typography.body, flex: 1, color: colors.ink, paddingVertical: 0 },

  wide: { gap: spacing.md },
  tileRow: { flexDirection: "row", gap: spacing.md },
  // Inset by hand: an absolutely placed child is laid out against the header's border box.
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

  liveRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary,
  },
  // A drawing sits on the row's own ground, with no plate of its own — as on Loyihalar's cards.
  rowArt: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1, alignItems: "center", gap: 4, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: spacing.md, ...shadow,
  },
  statValue: { ...typography.bodyMedium, color: colors.ink },
  statLabel: { ...typography.caption, color: colors.inkMuted, fontSize: 11 },
  sectionTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 18, marginTop: spacing.sm },
  /**
   * A horizontal ScrollView grows by default (flexGrow 1). Inside a page with a
   * minimum height — which the folding header needs — a short page (the first
   * second, before the shelves load) handed its spare height to these strips,
   * and the shelf tabs stretched into tall pills.
   */
  strip: { flexGrow: 0 },
  shelfTabs: { gap: spacing.sm },
  shelfTab: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: "transparent",
  },
  shelfTabActive: { backgroundColor: colors.primary, borderColor: colors.primaryDeep, ...shadow },
  shelfTabText: { ...typography.body, color: colors.inkMuted },
  shelfTabTextActive: { color: colors.onPrimary, fontFamily: "JaxongirmanSans_600SemiBold" },
  gameRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, ...shadow,
  },
  gameTitle: { ...typography.bodyMedium, color: colors.ink },
  gameMeta: { ...typography.caption, color: colors.inkMuted },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusReady: { backgroundColor: colors.success },
  statusBusy: { backgroundColor: colors.warning },
  statusDraft: { backgroundColor: colors.borderStrong },
  matchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  matchRank: {
    width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surfaceMuted,
    alignItems: "center", justifyContent: "center",
  },
  matchRankText: { ...typography.bodyMedium, color: colors.primaryDeep },
  matchScore: { ...typography.bodyMedium, color: colors.ink },
  freeCard: {
    width: 170, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, gap: 6, ...shadow,
  },
  freeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  freeBadge: {
    alignSelf: "flex-start", backgroundColor: colors.successSoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
  },
  freeBadgeText: { ...typography.caption, color: colors.success },
  freeTitle: { ...typography.bodyMedium, color: colors.ink },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryChip: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong,
    borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  categoryText: { ...typography.body, color: colors.ink },
  marketLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  marketLinkText: { ...typography.body, color: colors.primary },
}));

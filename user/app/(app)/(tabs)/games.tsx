import { GAME_STATUS_LABELS, type GameStatus } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Bell, Gamepad2, Gift, Medal, MonitorPlay, Plus, QrCode, ShoppingBag, Sparkles, Trophy,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import coinIcon from "../../../assets/coin/coin-icon.png";
import { Appear } from "@/components/Appear";
import { Touchable } from "@/components/Touchable";
import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { EmptyState, InlineError, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  listCategories, listFreeGames, listMyGames, listMyMatches, myGameStats,
  type Game, type GameCategory,
} from "@/lib/games";
import { formatNumber } from "@/lib/money";
import { supabase } from "@/lib/supabase";
import { useAccount } from "@/providers/AccountProvider";
import { useAuth } from "@/providers/AuthProvider";
import { brandInk, gradients, icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Shelf = "all" | "mine" | "bought" | "presentation" | "played";

const SHELF_LABELS: Record<Shelf, string> = {
  all: "Barchasi",
  mine: "Yaratganlarim",
  bought: "Sotib olganlarim",
  presentation: "Prezentatsiyadan",
  played: "Qatnashganlarim",
};

type Match = { session_id: string; joined_at: string; total_score: number; rank: number | null; game_title: string };
type Stats = { played: number; wins: number; top3: number; average_score: number; coins_won: number };

/**
 * The O‘yingoh front door: create, scan, and every shelf a person's games live
 * on. Purchased games arrive through marketplace entitlements, so "mine" and
 * "bought" are separated by ownership, not by copies.
 */
export default function GamesScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
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
        listMyMatches(),
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

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shelfGames = useMemo(() => {
    switch (shelf) {
      case "mine": return games.filter((game) => !boughtIds.has(game.id));
      case "bought": return games.filter((game) => boughtIds.has(game.id));
      case "presentation": return games.filter((game) => game.source_type === "presentation");
      default: return games;
    }
  }, [boughtIds, games, shelf]);

  return (
    <View style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.primary} />}
      >
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
            <Text style={styles.title}>O‘yingoh</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.coinPill} onPress={() => router.push("/coins/buy")} accessibilityLabel="J Coin balans">
              <Image source={coinIcon} resizeMode="contain" style={styles.coinIcon} />
              <Text style={styles.coinText}>{formatNumber(balance)}</Text>
            </Pressable>
            <Pressable style={styles.iconButton} onPress={() => router.push("/notifications")} accessibilityLabel="Bildirishnomalar">
              <Bell color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
              {unreadCount > 0 ? <View style={styles.badge} /> : null}
            </Pressable>
          </View>
        </View>

        <Touchable
          style={styles.ctaShadow}
          onPress={() => router.push("/oyingoh/create")}
          accessibilityRole="button"
        >
          <LinearGradient colors={gradients.create} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.createCta}>
            <View style={styles.createIcon}>
              <Plus color={brandInk.strong} size={icon.lg} strokeWidth={icon.strokeBold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.createTitle}>Yangi o‘yin yaratish</Text>
              <Text style={styles.createSubtitle}>AI bilan, matndan yoki qo‘lda</Text>
            </View>
            <Sparkles color={brandInk.muted} size={icon.lg} strokeWidth={icon.stroke} />
          </LinearGradient>
        </Touchable>

        {/* Two ways into a match, side by side because they are peers: one joins
            somebody else's room, the other takes a projector over. */}
        <View style={styles.scanRow}>
          <Touchable
            style={styles.halfShadow}
            onPress={() => router.push("/oyingoh/join")}
            accessibilityRole="button"
          >
            <LinearGradient colors={gradients.join} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.halfCta}>
              <QrCode color={brandInk.strong} size={icon.xl} strokeWidth={icon.stroke} />
              <Text style={styles.halfTitle}>O‘yinga qo‘shilish</Text>
              <Text style={styles.halfSubtitle}>QR yoki kod</Text>
            </LinearGradient>
          </Touchable>

          <Touchable
            style={styles.halfShadow}
            onPress={() => router.push("/oyingoh/scan")}
            accessibilityRole="button"
          >
            <LinearGradient colors={gradients.host} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.halfCta}>
              <MonitorPlay color={brandInk.strong} size={icon.xl} strokeWidth={icon.stroke} />
              <Text style={styles.halfTitle}>Mezbon bo‘lish</Text>
              <Text style={styles.halfSubtitle}>Katta ekranni ulash</Text>
            </LinearGradient>
          </Touchable>
        </View>

        {error ? <InlineError message={error} /> : null}

        {stats && stats.played > 0 ? (
          <View style={styles.statsRow}>
            <StatCard icon={Gamepad2} value={stats.played} label="O‘yinlar" />
            <StatCard icon={Trophy} value={stats.wins} label="G‘alabalar" />
            <StatCard icon={Medal} value={stats.top3} label="Top 3" />
            <StatCard icon={Gift} value={stats.coins_won} label="J mukofot" />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Mening o‘yinlarim</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfTabs}>
          {(Object.keys(SHELF_LABELS) as Shelf[]).map((key) => (
            <Pressable
              key={key}
              style={[styles.shelfTab, shelf === key && styles.shelfTabActive]}
              onPress={() => setShelf(key)}
            >
              <Text style={[styles.shelfTabText, shelf === key && styles.shelfTabTextActive]}>{SHELF_LABELS[key]}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <View style={{ gap: spacing.md }}><SkeletonCard /><SkeletonCard /></View>
        ) : shelf === "played" ? (
          matches.length === 0 ? (
            <EmptyState icon={Gamepad2} title="Hali o‘yinda qatnashmadingiz" message="QR skaner qilib birinchi bellashuvga qo‘shiling." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {matches.map((match) => (
                <View key={match.session_id} style={styles.matchRow}>
                  <View style={styles.matchRank}>
                    <Text style={styles.matchRankText}>{match.rank ? `#${match.rank}` : "—"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameTitle} numberOfLines={1}>{match.game_title}</Text>
                    <Text style={styles.gameMeta}>{new Date(match.joined_at).toLocaleDateString("uz-UZ")}</Text>
                  </View>
                  <Text style={styles.matchScore}>{formatNumber(match.total_score)}</Text>
                </View>
              ))}
            </View>
          )
        ) : shelfGames.length === 0 ? (
          <EmptyState
            icon={Gamepad2}
            title="Menda hali o‘yin yo‘q"
            message="Birinchi o‘yiningizni yarating — AI bir daqiqada tayyorlab beradi."
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            {shelfGames.map((game, index) => (
              <Appear key={game.id} index={index}>
                <GameRow game={game} onPress={() => router.push(`/oyingoh/${game.id}`)} />
              </Appear>
            ))}
          </View>
        )}

        {freeGames.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Bepul o‘yinlar</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
              {freeGames.map((game) => (
                <Touchable
                  key={game.id}
                  style={styles.freeCard}
                  onPress={() => router.push(`/oyingoh/${game.id}`)}
                >
                  <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>Bepul</Text></View>
                  <Text style={styles.freeTitle} numberOfLines={2}>{game.title}</Text>
                  <Text style={styles.gameMeta}>{game.question_count} savol</Text>
                </Touchable>
              ))}
            </ScrollView>
          </>
        ) : null}

        {categories.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Kategoriyalar</Text>
            <View style={styles.categoryGrid}>
              {categories.map((category) => (
                <Touchable
                  key={category.id}
                  style={styles.categoryChip}
                  onPress={() => router.push({ pathname: "/oyingoh/create", params: { categoryId: category.id, categoryLabel: category.label } })}
                >
                  <Text style={styles.categoryText}>{category.label}</Text>
                </Touchable>
              ))}
            </View>
          </>
        ) : null}

        <Pressable style={styles.marketLink} onPress={() => router.push("/(app)/(tabs)/marketplace")}>
          <ShoppingBag color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
          <Text style={styles.marketLinkText}>Do‘kondan tayyor o‘yinlarni ko‘ring</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function StatCard({ icon: Icon, value, label }: { icon: typeof Trophy; value: number; label: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.statCard}>
      <Icon color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
      <Text style={styles.statValue}>{formatNumber(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function GameRow({ game, onPress }: { game: Game; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const status = game.status as GameStatus;
  return (
    <Touchable style={styles.gameRow} onPress={onPress} accessibilityRole="button">
      <View style={styles.gameIcon}>
        <Gamepad2 color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.gameTitle} numberOfLines={1}>{game.title || "Nomsiz o‘yin"}</Text>
        <Text style={styles.gameMeta}>
          {game.question_count} savol · {GAME_STATUS_LABELS[status] ?? game.status}
        </Text>
      </View>
      <View style={[styles.statusDot, status === "ready" ? styles.statusReady : status === "generating" ? styles.statusBusy : styles.statusDraft]} />
    </Touchable>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  title: { ...typography.title, color: colors.ink },
  subtitle: { ...typography.body, color: colors.inkMuted },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
  badge: { position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  ctaShadow: { borderRadius: radius.lg, ...shadowLifted },
  createCta: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  createIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
  },
  createTitle: { ...typography.bodyMedium, color: brandInk.strong, fontSize: 17 },
  createSubtitle: { ...typography.caption, color: brandInk.muted },
  scanRow: { flexDirection: "row", gap: spacing.md },
  halfShadow: { flex: 1, borderRadius: radius.lg, ...shadow },
  halfCta: {
    minHeight: 128, borderRadius: radius.lg, padding: spacing.lg,
    justifyContent: "space-between", gap: spacing.sm,
  },
  halfTitle: { ...typography.bodyMedium, color: brandInk.strong, fontSize: 15 },
  halfSubtitle: { ...typography.caption, color: brandInk.muted },
  statsRow: { flexDirection: "row", gap: spacing.sm },
  statCard: {
    flex: 1, alignItems: "center", gap: 2, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: spacing.md, ...shadow,
  },
  statValue: { ...typography.bodyMedium, color: colors.ink },
  statLabel: { ...typography.caption, color: colors.inkMuted, fontSize: 11 },
  sectionTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 18, marginTop: spacing.sm },
  shelfTabs: { gap: spacing.sm },
  shelfTab: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill, backgroundColor: colors.surfaceMuted,
    borderWidth: 1, borderColor: "transparent",
  },
  shelfTabActive: { backgroundColor: colors.primary, borderColor: colors.primaryDeep, ...shadow },
  shelfTabText: { ...typography.body, color: colors.inkMuted },
  shelfTabTextActive: { color: colors.onPrimary, fontFamily: "Manrope_600SemiBold" },
  gameRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, ...shadow,
  },
  gameIcon: {
    width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft,
    alignItems: "center", justifyContent: "center",
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

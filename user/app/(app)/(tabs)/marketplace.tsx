import {
  MARKETPLACE_SORT_LABELS, type MarketplaceListItem, type MarketplaceSort,
} from "@jaxongirman/types";
import { useFocusEffect, useRouter } from "expo-router";
import { Heart, Plus, Search, SlidersHorizontal, Star, Store, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Image, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { EmptyState, ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  EMPTY_FILTERS, searchProducts, signPaths, toggleFavorite, useMaterialTypes,
  type SearchFilters,
} from "@/lib/marketplace";
import { formatNumber, formatSom } from "@/lib/money";
import { useAuth } from "@/providers/AuthProvider";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

const SORTS: MarketplaceSort[] = ["newest", "popular", "rating", "price_asc", "price_desc"];

/**
 * The catalogue.
 *
 * Everything that narrows the list — the search term, the type, the price band,
 * the ordering — is sent to `marketplace_search()` and resolved there. The
 * client never holds the shelf in memory to filter it, which is what keeps this
 * screen the same speed at ten products and at ten thousand.
 */
export default function MarketplaceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { types } = useMaterialTypes();

  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [draftQuery, setDraftQuery] = useState("");
  const [items, setItems] = useState<MarketplaceListItem[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ min: "", max: "" });

  // Guards the pager: a fast scroll can fire onEndReached several times before
  // the first page has landed.
  const loadingRef = useRef(false);

  const load = useCallback(async (nextFilters: SearchFilters, offset: number, mode: "replace" | "append") => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (mode === "replace" && offset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const result = await searchProducts(nextFilters, offset);
      const nextItems = mode === "append" ? [...items, ...result.items] : result.items;
      setItems(nextItems);
      setTotal(result.total);
      setError(null);

      const paths = result.items.map((item) => item.cover_path).filter((path): path is string => Boolean(path));
      if (paths.length > 0) {
        const signed = await signPaths("marketplace-previews", paths);
        setCovers((current) => ({ ...current, ...signed }));
      }
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  }, [items]);

  useFocusEffect(useCallback(() => {
    void load(filters, 0, "replace");
    // Intentionally keyed on the filters only: coming back to the tab should
    // refresh the current view, not reset what the person was looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]));

  // The search box waits for a pause rather than querying per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((current) => (current.query === draftQuery ? current : { ...current, query: draftQuery }));
    }, 350);
    return () => clearTimeout(handle);
  }, [draftQuery]);

  const activeFilterCount =
    (filters.materialType ? 1 : 0) + (filters.minPrice !== null ? 1 : 0) +
    (filters.maxPrice !== null ? 1 : 0) + (filters.sort !== "newest" ? 1 : 0);

  async function onFavorite(item: MarketplaceListItem) {
    if (!user) return;
    const next = !item.is_favorite;
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_favorite: next } : row));
    try {
      await toggleFavorite(item.id, user.id, next);
    } catch {
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_favorite: !next } : row));
    }
  }

  function applyPriceDraft() {
    const min = Number.parseInt(priceDraft.min.replace(/[^0-9]/g, ""), 10);
    const max = Number.parseInt(priceDraft.max.replace(/[^0-9]/g, ""), 10);
    setFilters((current) => ({
      ...current,
      minPrice: Number.isFinite(min) ? min : null,
      maxPrice: Number.isFinite(max) ? max : null,
    }));
    setFiltersOpen(false);
  }

  return (
    <View style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
            <Text style={styles.title}>Do‘kon</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mahsulot sotish"
            onPress={() => router.push("/(app)/marketplace/sell")}
            style={styles.sellButton}
          >
            <Plus color={colors.onPrimary} size={icon.sm} strokeWidth={icon.strokeBold} />
            <Text style={styles.sellText}>Sotish</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <Search color={colors.inkSoft} size={icon.sm} strokeWidth={icon.stroke} />
            <TextInput
              value={draftQuery}
              onChangeText={setDraftQuery}
              placeholder="Material qidirish"
              placeholderTextColor={colors.inkSoft}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {draftQuery ? (
              <Pressable accessibilityLabel="Tozalash" onPress={() => setDraftQuery("")}>
                <X color={colors.inkSoft} size={16} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Filtrlar"
            onPress={() => setFiltersOpen(true)}
            style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
          >
            <SlidersHorizontal color={activeFilterCount > 0 ? colors.onPrimary : colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
            {activeFilterCount > 0 ? <Text style={styles.filterCount}>{activeFilterCount}</Text> : null}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable
            onPress={() => setFilters((current) => ({ ...current, materialType: null }))}
            style={[styles.chip, filters.materialType === null && styles.chipActive]}
          >
            <Text style={[styles.chipText, filters.materialType === null && styles.chipTextActive]}>Barchasi</Text>
          </Pressable>
          {types.map((type) => (
            <Pressable
              key={type.code}
              onPress={() => setFilters((current) => ({
                ...current,
                materialType: current.materialType === type.code ? null : type.code,
              }))}
              style={[styles.chip, filters.materialType === type.code && styles.chipActive]}
            >
              <Text style={[styles.chipText, filters.materialType === type.code && styles.chipTextActive]}>{type.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingList}><SkeletonCard lines={2} /><SkeletonCard lines={2} /></View>
      ) : error ? (
        <View style={styles.loadingList}><ErrorState message={error} onRetry={() => void load(filters, 0, "replace")} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(filters, 0, "replace"); }}
              tintColor={colors.primary}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (items.length < total && !loadingMore) void load(filters, items.length, "append");
          }}
          ListHeaderComponent={
            total > 0 ? <Text style={styles.resultCount}>{formatNumber(total)} ta material</Text> : null
          }
          ListEmptyComponent={
            <EmptyState
              icon={Store}
              title={filters.query || activeFilterCount > 0 ? "Hech narsa topilmadi" : "Do‘kon hali bo‘sh"}
              message={
                filters.query || activeFilterCount > 0
                  ? "Qidiruv shartlarini o‘zgartirib ko‘ring."
                  : "Birinchi materialni siz joylashingiz mumkin — “Sotish” tugmasini bosing."
              }
            />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footerLoader} /> : null
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/(app)/marketplace/[id]", params: { id: item.id } })}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.coverFrame}>
                {item.cover_path && covers[item.cover_path] ? (
                  <Image source={{ uri: covers[item.cover_path] }} style={styles.cover} resizeMode="cover" />
                ) : (
                  <View style={styles.coverFallback}>
                    <Store color={colors.borderStrong} size={26} strokeWidth={1.7} />
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.is_favorite ? "Sevimlilardan olib tashlash" : "Sevimlilarga qo‘shish"}
                  onPress={() => void onFavorite(item)}
                  style={styles.favorite}
                  hitSlop={8}
                >
                  <Heart
                    color={item.is_favorite ? colors.danger : colors.inkSoft}
                    fill={item.is_favorite ? colors.danger : "transparent"}
                    size={16}
                    strokeWidth={2}
                  />
                </Pressable>
                {item.material_label ? (
                  <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{item.material_label}</Text></View>
                ) : null}
              </View>

              <Text numberOfLines={2} style={styles.cardTitle}>{item.title}</Text>
              <Text numberOfLines={1} style={styles.cardSeller}>{item.seller_name}</Text>

              <View style={styles.cardMeta}>
                {item.rating !== null ? (
                  <View style={styles.rating}>
                    <Star color={colors.warning} fill={colors.warning} size={11} strokeWidth={2} />
                    <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
                    <Text style={styles.ratingCount}>({item.rating_count})</Text>
                  </View>
                ) : (
                  <Text style={styles.ratingCount}>Baho yo‘q</Text>
                )}
                {item.content_units ? (
                  <Text style={styles.units}>{item.content_units} b.</Text>
                ) : null}
              </View>

              <Text style={styles.price}>{formatSom(item.base_price)}</Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <Pressable accessibilityLabel="Yopish" onPress={() => setFiltersOpen(false)} style={styles.backdrop}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Filtrlar</Text>

            <Text style={styles.sheetLabel}>Tartib</Text>
            <View style={styles.sortRow}>
              {SORTS.map((sort) => (
                <Pressable
                  key={sort}
                  onPress={() => setFilters((current) => ({ ...current, sort }))}
                  style={[styles.chip, filters.sort === sort && styles.chipActive]}
                >
                  <Text style={[styles.chipText, filters.sort === sort && styles.chipTextActive]}>
                    {MARKETPLACE_SORT_LABELS[sort]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sheetLabel}>Narx oralig‘i (so‘m)</Text>
            <View style={styles.priceRow}>
              <TextInput
                value={priceDraft.min}
                onChangeText={(value) => setPriceDraft((current) => ({ ...current, min: value.replace(/[^0-9]/g, "") }))}
                placeholder="Eng kam"
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                style={styles.priceInput}
              />
              <TextInput
                value={priceDraft.max}
                onChangeText={(value) => setPriceDraft((current) => ({ ...current, max: value.replace(/[^0-9]/g, "") }))}
                placeholder="Eng ko‘p"
                placeholderTextColor={colors.inkSoft}
                keyboardType="number-pad"
                style={styles.priceInput}
              />
            </View>

            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => { setPriceDraft({ min: "", max: "" }); setFilters(EMPTY_FILTERS); setDraftQuery(""); setFiltersOpen(false); }}
                style={styles.sheetSecondary}
              >
                <Text style={styles.sheetSecondaryText}>Tozalash</Text>
              </Pressable>
              <Pressable onPress={applyPriceDraft} style={styles.sheetPrimary}>
                <Text style={styles.sheetPrimaryText}>Qo‘llash</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  header: { paddingHorizontal: spacing.xl, gap: spacing.md },
  headerTop: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  title: { ...typography.title, color: colors.ink, marginTop: 2 },
  sellButton: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primary },
  sellText: { ...typography.bodyMedium, color: colors.onPrimary, fontSize: 14 },

  searchRow: { flexDirection: "row", gap: spacing.sm },
  searchField: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 48,
    paddingHorizontal: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { ...typography.body, color: colors.ink, flex: 1 },
  filterButton: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", gap: 3 },
  filterButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterCount: { ...typography.caption, fontSize: 10, color: colors.onPrimary },

  chips: { gap: 6, paddingVertical: 2, paddingRight: spacing.xl },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.inkMuted },
  chipTextActive: { color: colors.onPrimary },

  loadingList: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.md },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.md },
  column: { gap: spacing.md },
  resultCount: { ...typography.caption, color: colors.inkSoft, marginBottom: spacing.sm },
  footerLoader: { paddingVertical: spacing.xl },

  card: { flex: 1, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 4, ...shadow },
  cardPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  coverFrame: { aspectRatio: 4 / 3, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  cover: { width: "100%", height: "100%" },
  coverFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  favorite: { position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.92)" },
  typeBadge: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "rgba(21,14,36,.72)" },
  typeBadgeText: { ...typography.caption, fontSize: 9, color: colors.onPrimary },
  cardTitle: { ...typography.bodyMedium, color: colors.ink, fontSize: 13, lineHeight: 17, marginTop: 2 },
  cardSeller: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  cardMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { ...typography.caption, fontSize: 11, color: colors.ink, fontFamily: "Manrope_600SemiBold" },
  ratingCount: { ...typography.caption, fontSize: 10, color: colors.inkSoft },
  units: { ...typography.caption, fontSize: 10, color: colors.inkSoft },
  price: { ...typography.bodyMedium, color: colors.primaryDeep, fontSize: 14, marginTop: 2 },

  backdrop: { flex: 1, backgroundColor: "rgba(21,14,36,.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, gap: spacing.md, paddingBottom: 40 },
  sheetTitle: { ...typography.heading, color: colors.ink },
  sheetLabel: { ...typography.caption, color: colors.inkMuted, marginTop: spacing.sm },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  priceRow: { flexDirection: "row", gap: spacing.md },
  priceInput: {
    ...typography.body, color: colors.ink, flex: 1, minHeight: 50,
    backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },
  sheetActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  sheetSecondary: { flex: 1, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  sheetSecondaryText: { ...typography.bodyMedium, color: colors.inkMuted, fontSize: 14 },
  sheetPrimary: { flex: 1, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  sheetPrimaryText: { ...typography.bodyMedium, color: colors.onPrimary, fontSize: 14 },
});

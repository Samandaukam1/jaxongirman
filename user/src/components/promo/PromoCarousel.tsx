import { PROMO_BANNER_RATIO, promoBadgeText, type Promo } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { ArrowUpRight, ChevronRight, Megaphone } from "lucide-react-native";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewToken } from "react-native";

import { PromoMedia } from "@/components/promo/PromoMedia";
import { Skeleton } from "@/components/StateBlocks";
import { useReduceMotion } from "@/lib/motion";
import { fetchPromos, openPromoUrl, peekPromos, trackPromo } from "@/lib/promos";
import { useDesktop } from "@/lib/useDesktop";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/** How long a banner stays before the carousel moves on by itself. */
const AUTO_ADVANCE_MS = 6000;
/** Counted once per banner per launch, not on every swipe past it. */
const seen = new Set<string>();

export type PromoCarouselHandle = { refresh: () => Promise<void> };

/**
 * "Jaxongirman tavsiya qiladi" on Bosh sahifa.
 *
 * Wide 16:6 banners, one per page, swiped sideways and moving on by themselves
 * every few seconds until somebody touches them. An advertisement says so on
 * its face, with the advertiser's name. With nothing published the section is
 * not drawn at all — no heading over an empty space.
 */
export const PromoCarousel = forwardRef<PromoCarouselHandle>(function PromoCarousel(_props, ref) {
  const styles = useStyles();
  const { t } = useTranslation("home");
  const router = useRouter();
  const reduced = useReduceMotion();
  const desktop = useDesktop();
  const { width: windowWidth } = useWindowDimensions();
  const [promos, setPromos] = useState<Promo[] | null>(() => peekPromos());
  const [page, setPage] = useState(0);
  const [touched, setTouched] = useState(false);
  const [measured, setMeasured] = useState(0);
  const list = useRef<FlatList<Promo>>(null);

  const width = measured || Math.min(windowWidth, desktop ? 760 : windowWidth) - spacing.xl * 2;
  const height = Math.round(width / PROMO_BANNER_RATIO);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPromos();
      setPromos(next);
      setPage((current) => (current < next.length ? current : 0));
    } catch {
      // A banner strip that fails to load is left out, never an error on Bosh sahifa.
      setPromos((current) => current ?? []);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);
  useEffect(() => { void refresh(); }, [refresh]);

  const count = promos?.length ?? 0;

  useEffect(() => {
    if (count < 2 || touched || reduced) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % count), AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [count, reduced, touched]);

  // The strip follows the page — moved by the timer, or settled after a swipe
  // (where it is already there and this does nothing visible).
  useEffect(() => {
    if (count > 0) list.current?.scrollToOffset({ offset: page * (width + spacing.md), animated: true });
  }, [count, page, width]);

  // Stable for the list's lifetime: FlatList refuses a new callback on the fly.
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Promo>[] }) => {
    for (const token of viewableItems) {
      const item = token.item;
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        trackPromo(item.id, "view");
      }
    }
  }, []);

  if (promos === null) {
    return (
      <View style={styles.section}>
        <Skeleton height={18} width={220} />
        <Skeleton height={height} radius={radius.xl} />
      </View>
    );
  }
  if (count === 0) return null;

  const open = (promo: Promo) => {
    if (promo.action === "link" && promo.link_url) {
      trackPromo(promo.id, "click");
      openPromoUrl(promo.link_url, router);
      return;
    }
    trackPromo(promo.id, "click");
    router.push({ pathname: "/(app)/promo/[id]", params: { id: promo.id } });
  };

  return (
    <View style={styles.section} onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>{t("promo.section")}</Text>
        {count > 1 ? <Text style={styles.counter}>{page + 1}/{count}</Text> : null}
      </View>

      <FlatList
        ref={list}
        data={promos}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + spacing.md}
        decelerationRate="fast"
        disableIntervalMomentum
        ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
        onScrollBeginDrag={() => setTouched(true)}
        onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / (width + spacing.md)))}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        style={styles.strip}
        renderItem={({ item }) => {
          const isAd = item.kind === "ad";
          // The label is the console's to set: the default ("Reklama" on an
          // advertisement), its own words, or none.
          const badge = promoBadgeText(item, t("promo.ad"));
          const defaultAd = isAd && item.badge === null;
          const external = item.action === "link";
          const overlay = item.banner_style !== "image";
          return (
            <Pressable
              accessibilityRole={external ? "link" : "button"}
              accessibilityLabel={`${badge ? `${badge}. ` : ""}${item.title}`}
              onPress={() => open(item)}
              style={({ pressed }) => [styles.card, { width, height }, pressed && styles.pressed]}
            >
              <PromoMedia uri={item.banner_url} kind={item.banner_kind} style={StyleSheet.absoluteFill} />
              {/* "Faqat rasm": artwork that carries its own words is shown as it
                  is — no title, no shade, no arrow. The label, if the console
                  left one, shrinks to a small tag in the corner. */}
              {overlay ? (
                <LinearGradient
                  colors={["rgba(10,4,26,0)", "rgba(10,4,26,0.15)", "rgba(10,4,26,0.78)"]}
                  locations={[0, 0.35, 1]}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {badge ? (
                <View style={[styles.adChip, !overlay && styles.adChipQuiet]}>
                  {overlay && defaultAd ? <Megaphone color="#3A2304" size={11} strokeWidth={2.6} /> : null}
                  <Text style={[styles.adText, !overlay && styles.adTextQuiet]} numberOfLines={1}>
                    {badge}{overlay && isAd && item.sponsor ? ` · ${item.sponsor}` : ""}
                  </Text>
                </View>
              ) : null}
              {overlay ? (
                <View style={styles.copy}>
                  <View style={styles.copyText}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                    {item.subtitle ? <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                  </View>
                  <View style={styles.go}>
                    {external
                      ? <ArrowUpRight color="#FFFFFF" size={18} strokeWidth={2.4} />
                      : <ChevronRight color="#FFFFFF" size={18} strokeWidth={2.4} />}
                  </View>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      {count > 1 ? (
        <View style={styles.dots}>
          {promos.map((item, index) => (
            <View key={item.id} style={[styles.dot, index === page && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  section: { gap: spacing.md, marginTop: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { ...typography.heading, color: colors.ink, flex: 1 },
  counter: { ...typography.caption, color: colors.inkSoft, fontVariant: ["tabular-nums"] },
  strip: { overflow: "visible" },
  card: { borderRadius: radius.xl, overflow: "hidden", backgroundColor: "#1B0D45" },
  pressed: { opacity: 0.94, transform: [{ scale: 0.99 }] },
  adChip: {
    position: "absolute", top: 10, left: 10, maxWidth: "70%", flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: "#F6C453",
  },
  adText: { fontFamily: "Manrope_800ExtraBold", fontSize: 10, letterSpacing: 0.4, color: "#3A2304", flexShrink: 1 },
  adChipQuiet: { top: 8, left: 8, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "rgba(10,4,26,0.45)" },
  adTextQuiet: { fontSize: 8.5, color: "rgba(255,255,255,0.9)" },
  copy: { position: "absolute", left: 14, right: 12, bottom: 11, flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  copyText: { flex: 1, gap: 1 },
  cardTitle: { fontFamily: "Manrope_800ExtraBold", fontSize: 17, lineHeight: 22, color: "#FFFFFF", letterSpacing: -0.2 },
  cardSubtitle: { fontFamily: "Manrope_500Medium", fontSize: 12.5, lineHeight: 17, color: "rgba(255,255,255,0.82)" },
  go: {
    width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.32)",
  },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: -2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotOn: { width: 18, backgroundColor: colors.primary },
}));

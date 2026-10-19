import { PROMO_HERO_RATIO, promoBadgeText, type Promo, type PromoButton } from "@jaxongirman/types";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ArrowUpRight, ChevronLeft, Megaphone } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation, interpolate, runOnJS, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PromoArticle, pinnedButtons } from "@/components/promo/PromoArticle";
import { PromoButtonView } from "@/components/promo/PromoButtonView";
import { PromoMedia } from "@/components/promo/PromoMedia";
import { promoFaces, usePromoFonts } from "@/components/promo/promoFonts";
import { ErrorState, Skeleton } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { fetchPromo, openPromoUrl, peekPromos, trackPromo } from "@/lib/promos";
import { withAlpha } from "@/theme/color";
import { radius, spacing } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** How much of the sheet's top edge rides up over the hero. */
const OVERLAP = 34;

/**
 * One recommendation or advertisement, opened.
 *
 * The hero — a picture or a silent looping video — is fixed to the top of the
 * screen and the article is a sheet that slides up over it: the picture drifts
 * up at half the scroll speed, and pulling down past the top stretches it
 * instead of showing a gap. Buttons the console pinned stay at the bottom of
 * the screen, over a frosted strip, for the whole read.
 */
export default function PromoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const { t } = useTranslation("home");
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const fontsReady = usePromoFonts();

  // The banner already on Bosh sahifa gives the hero and title at once; the
  // article fills in when it arrives.
  const [promo, setPromo] = useState<Promo | null>(() => peekPromos()?.find((item) => item.id === id) ?? null);
  const [bodyLoaded, setBodyLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overHero, setOverHero] = useState(true);
  const [dockHeight, setDockHeight] = useState(0);

  const heroHeight = Math.round(Math.min(width / PROMO_HERO_RATIO, height * 0.62));

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await fetchPromo(id);
      if (!next) { setError(t("promo.gone")); return; }
      setPromo(next);
      setBodyLoaded(true);
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (id) trackPromo(id, "view"); }, [id]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => { scrollY.value = event.contentOffset.y; });

  // The status bar is light while it sits on the picture and follows the theme once the sheet covers it.
  useAnimatedReaction(() => scrollY.value < heroHeight - OVERLAP - insets.top - 40, (next, previous) => {
    if (next !== previous) runOnJS(setOverHero)(next);
  }, [heroHeight, insets.top]);

  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    return {
      transform: [
        { translateY: y < 0 ? y / 2 : -y * 0.5 },
        { scale: y < 0 ? 1 + -y / heroHeight : 1 },
      ],
    };
  });
  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [heroHeight - OVERLAP - insets.top - 90, heroHeight - OVERLAP - insets.top - 30], [0, 1], Extrapolation.CLAMP),
  }));

  const pinned = promo && bodyLoaded ? pinnedButtons(promo.body) : [];
  const faces = promoFaces(promo?.theme.font ?? "editorial", fontsReady);
  const isAd = promo?.kind === "ad";
  // A recommendation on its default says who recommends it; anything else
  // follows the label the console set — including none.
  const chip = promo ? (promo.badge === null && !isAd ? t("promo.recommends") : promoBadgeText(promo, t("promo.ad"))) : null;
  const defaultAd = isAd && promo?.badge === null;

  const press = (button: PromoButton) => {
    if (promo) trackPromo(promo.id, "click");
    openPromoUrl(button.url, router);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style={overHero ? "light" : scheme === "dark" ? "light" : "dark"} animated />

      {/* ------------------------------------------------------------- hero */}
      <Animated.View style={[styles.hero, { height: heroHeight }, heroStyle]}>
        <PromoMedia uri={promo?.hero_url ?? promo?.banner_url ?? null} kind={promo?.hero_url ? promo.hero_kind : promo?.banner_kind ?? "image"} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={["rgba(8,4,20,0.55)", "rgba(8,4,20,0)"]} style={[styles.heroTopShade, { height: insets.top + 90 }]} />
        <LinearGradient colors={["rgba(8,4,20,0)", "rgba(8,4,20,0.35)"]} style={styles.heroBottomShade} />
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: heroHeight - OVERLAP, paddingBottom: (pinned.length > 0 ? dockHeight : insets.bottom) + spacing.xxl }}
      >
        <View style={[styles.sheet, { minHeight: height - heroHeight + OVERLAP }]}>
          <View style={styles.grip} />
          {promo ? (
            <>
              {chip || (isAd && promo.sponsor) ? (
                <View style={styles.kindRow}>
                  {chip ? (
                    <View style={[styles.kindChip, isAd ? styles.kindChipAd : { backgroundColor: colors.primarySoft }]}>
                      {defaultAd ? <Megaphone color="#9A5B06" size={13} strokeWidth={2.4} /> : null}
                      <Text style={[styles.kindText, isAd ? styles.kindTextAd : { color: colors.primary }]}>{chip}</Text>
                    </View>
                  ) : null}
                  {isAd && promo.sponsor ? <Text numberOfLines={1} style={styles.sponsor}>{promo.sponsor}</Text> : null}
                </View>
              ) : null}
              <Text style={[styles.title, { fontFamily: faces.display }]}>{promo.title}</Text>
              {promo.subtitle ? <Text style={styles.subtitle}>{promo.subtitle}</Text> : null}
              <View style={[styles.rule, { backgroundColor: promo.theme.accent }]} />

              {bodyLoaded ? (
                <PromoArticle blocks={promo.body} theme={promo.theme} faces={faces} onButton={press} />
              ) : !error ? (
                <View style={styles.bodySkeleton}>
                  <Skeleton height={16} width="96%" />
                  <Skeleton height={16} width="88%" />
                  <Skeleton height={16} width="92%" />
                  <Skeleton height={16} width="60%" />
                </View>
              ) : null}

              {/* A link banner opened from somewhere other than Bosh sahifa still has its way out. */}
              {bodyLoaded && promo.action === "link" && promo.link_url ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => { trackPromo(promo.id, "click"); openPromoUrl(promo.link_url!, router); }}
                  style={styles.linkRow}
                >
                  <Text style={[styles.linkText, { color: promo.theme.accent }]} numberOfLines={1}>{promo.link_url.replace(/^https?:\/\//, "")}</Text>
                  <ArrowUpRight color={promo.theme.accent} size={18} />
                </Pressable>
              ) : null}
            </>
          ) : !error ? (
            <View style={styles.bodySkeleton}>
              <Skeleton height={14} width={120} />
              <Skeleton height={34} width="90%" />
              <Skeleton height={16} width="70%" />
            </View>
          ) : null}
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        </View>
      </Animated.ScrollView>

      {/* ------------------------------------------------- top bar */}
      <Animated.View pointerEvents="none" style={[styles.bar, { height: insets.top + 56 }, barStyle]}>
        {Platform.OS === "ios" ? <BlurView intensity={50} tint={scheme} style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, opacity: Platform.OS === "ios" ? 0.72 : 0.97 }]} />
        <Text numberOfLines={1} style={[styles.barTitle, { top: insets.top + 17 }]}>{promo?.title ?? ""}</Text>
      </Animated.View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("promo.back")}
        onPress={() => router.back()}
        hitSlop={8}
        style={[styles.back, { top: insets.top + 8 }, overHero ? styles.backOnHero : { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <ChevronLeft color={overHero ? "#FFFFFF" : colors.ink} size={24} strokeWidth={2.4} />
      </Pressable>

      {/* ----------------------------------------------- pinned buttons */}
      {pinned.length > 0 ? (
        <View
          onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
          style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xs }]}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LinearGradient colors={[withAlpha(colors.canvas, 0), withAlpha(colors.canvas, 0.94), colors.canvas]} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
          </View>
          {pinned.map((button, index) => <PromoButtonView key={index} button={button} onPress={() => press(button)} />)}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  hero: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden", backgroundColor: "#140A33" },
  heroTopShade: { position: "absolute", top: 0, left: 0, right: 0 },
  heroBottomShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 120 },

  sheet: {
    backgroundColor: colors.canvas, borderTopLeftRadius: 32, borderTopRightRadius: 32,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.md,
    shadowColor: "#0B0420", shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: -8 }, elevation: 12,
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  kindRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  kindChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  kindChipAd: { backgroundColor: "#FDF0D5" },
  kindText: { fontFamily: "Manrope_800ExtraBold", fontSize: 11, letterSpacing: 1.1 },
  kindTextAd: { color: "#9A5B06" },
  sponsor: { fontFamily: "Manrope_600SemiBold", fontSize: 13, color: colors.inkMuted, flexShrink: 1 },
  title: { fontSize: 34, lineHeight: 41, color: colors.ink, letterSpacing: -0.6 },
  subtitle: { fontFamily: "Manrope_500Medium", fontSize: 16.5, lineHeight: 25, color: colors.inkMuted },
  rule: { width: 44, height: 4, borderRadius: 2, marginVertical: spacing.sm },
  bodySkeleton: { gap: spacing.md, paddingVertical: spacing.md },
  linkRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", marginTop: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  linkText: { fontFamily: "Manrope_700Bold", fontSize: 14, maxWidth: 260 },

  bar: { position: "absolute", top: 0, left: 0, right: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  barTitle: { position: "absolute", left: 72, right: 72, textAlign: "center", fontFamily: "Manrope_700Bold", fontSize: 15, color: colors.ink },
  back: {
    position: "absolute", left: spacing.lg, width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  backOnHero: { backgroundColor: "rgba(10,4,26,0.38)", borderColor: "rgba(255,255,255,0.28)" },

  dock: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xl, paddingTop: spacing.xxl + spacing.md, gap: spacing.sm },
}));

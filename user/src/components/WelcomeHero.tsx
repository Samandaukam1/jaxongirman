import { useRouter } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BrandSurface } from "@/components/BrandSurface";
import { useReduceMotion } from "@/lib/motion";
import { formatNumber } from "@/lib/money";
import type { Wallet } from "@/lib/wallet";
import { brandInk, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** One free deck is ten pages at most; the welcome is three of them. */
const DECK_PAGES = 10;
const DECKS = 3;
/** Dashes in the tear line; enough to read as perforation at any phone width. */
const PERFORATION = 26;

/**
 * The welcome, while it lasts: a gift voucher for three free decks.
 *
 * One large figure says how many free decks are left — counted only when
 * whole, so 25 pages is two decks "and five more pages", never two and a half.
 * Under the tear line, one slot per deck: the decks are spent from the first,
 * so a used deck reads as used and a half-used one says how many pages it
 * still holds. It stands in place of the J Tanga card until the welcome is
 * spent, and keeps the J Tanga figure in its foot so nothing is hidden.
 */
export function WelcomeHero({ wallet }: { wallet: Wallet }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation("home", { keyPrefix: "welcome" });

  const granted = Math.max(wallet.welcome.granted, DECK_PAGES * DECKS);
  const remaining = Math.max(0, wallet.welcome.remaining);
  const used = Math.max(0, granted - remaining);
  const wholeDecks = Math.floor(remaining / DECK_PAGES);
  const spare = remaining % DECK_PAGES;
  // Pages still in each slot, spent from the first slot onwards.
  const slots = Array.from({ length: DECKS }, (_, index) => DECK_PAGES - Math.min(Math.max(used - index * DECK_PAGES, 0), DECK_PAGES));

  // Made once; the effect below moves them.
  const [fill] = useState(() => slots.map((left) => new Animated.Value(reduceMotion ? left / DECK_PAGES : 0)));

  useEffect(() => {
    if (reduceMotion) {
      slots.forEach((left, index) => fill[index]!.setValue(left / DECK_PAGES));
      return;
    }
    Animated.stagger(90, slots.map((left, index) => Animated.timing(fill[index]!, {
      toValue: left / DECK_PAGES, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }))).start();
    // The slots move only when what is left changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, reduceMotion]);

  const figure = wholeDecks > 0 ? wholeDecks : remaining;
  const words = wholeDecks > 0 ? t("decks", { count: wholeDecks }) : t("pages");
  const detail = wholeDecks > 0
    ? (spare > 0 ? t("plusPages", { pages: spare }) : t("eachUpTo"))
    : t("oneDeck");

  return (
    <BrandSurface radius={radius.xl} style={styles.card}>
      <View accessible accessibilityLabel={t("a11y", { remaining, granted })} style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.label}>{t("label")}</Text>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{t("pagesLeft", { remaining, granted })}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.figure} numberOfLines={1} maxFontSizeMultiplier={1}>{figure}</Text>
          <View style={styles.words}>
            <Text style={styles.wordsText}>{words}</Text>
            <Text style={styles.detail}>{detail}</Text>
          </View>
        </View>

        <Text style={styles.lead}>{t("lead")}</Text>
      </View>

      {/* The tear line of a voucher: two notches cut by the screen behind the
          card, and a dashed rule between them. */}
      <View style={styles.perforation} accessible={false}>
        <View style={[styles.notch, styles.notchLeft, { backgroundColor: colors.canvas }]} />
        <View style={styles.dashes}>
          {Array.from({ length: PERFORATION }, (_, index) => <View key={index} style={styles.dash} />)}
        </View>
        <View style={[styles.notch, styles.notchRight, { backgroundColor: colors.canvas }]} />
      </View>

      <View style={styles.slots} accessible={false}>
        {slots.map((left, index) => {
          const number = index + 1;
          const caption = left === DECK_PAGES
            ? t("slotFull", { number })
            : left === 0 ? t("slotSpent", { number }) : t("slotPart", { number, pages: left });
          return (
            <View key={index} style={styles.slot}>
              <View style={styles.track}>
                <Animated.View
                  style={[styles.fill, { width: fill[index]!.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
                />
              </View>
              <Text style={[styles.caption, left === 0 && styles.captionSpent]} numberOfLines={1}>{caption}</Text>
            </View>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/(app)/create")}
        style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
      >
        <Text style={styles.ctaText}>{t("cta")}</Text>
        <ArrowRight color={brandInk.onPlate} size={18} strokeWidth={2.4} />
      </Pressable>

      <View style={styles.foot}>
        <Text style={styles.footLabel}>{t("balance")}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("shop")} onPress={() => router.push("/(app)/coins/buy")} hitSlop={8}>
          <Text style={styles.footBalance}>{formatNumber(wallet.balance)} J</Text>
        </Pressable>
      </View>
    </BrandSurface>
  );
}

const useStyles = makeStyles(() => ({
  card: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.xl - 4, paddingBottom: spacing.lg + 2, gap: spacing.lg, overflow: "hidden" },
  body: { gap: spacing.lg },

  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  label: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 12.5, letterSpacing: 0.2, color: brandInk.muted, flexShrink: 1 },
  pill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  pillText: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 12, color: brandInk.strong, fontVariant: ["tabular-nums"] },

  hero: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md + 2 },
  // The line box is taller than the glyph on purpose. At 84 against a 92 pt
  // face the top of the digit was cut off on phones whose text metrics run a
  // little taller (and anywhere the system font scale is raised). The extra
  // height is given back with negative margins, so the card does not grow, and
  // the side padding keeps the tight tracking from shaving the last digit.
  figure: {
    fontFamily: "Manrope_800ExtraBold", fontSize: 92, lineHeight: 112, letterSpacing: -5,
    color: brandInk.strong, fontVariant: ["tabular-nums"], includeFontPadding: false,
    marginTop: -14, marginBottom: -14, paddingRight: 6,
  },
  words: { flex: 1, gap: 4, paddingBottom: 6 },
  wordsText: { fontFamily: "Manrope_800ExtraBold", fontSize: 21, lineHeight: 24, letterSpacing: -0.3, color: brandInk.strong },
  detail: { ...typography.caption, fontSize: 13, color: brandInk.muted },
  lead: { ...typography.caption, fontSize: 13.5, lineHeight: 19, color: brandInk.muted },

  perforation: { height: 18, marginHorizontal: -(spacing.xl - 4), flexDirection: "row", alignItems: "center" },
  notch: { width: 18, height: 18, borderRadius: 9 },
  notchLeft: { marginLeft: -9 },
  notchRight: { marginRight: -9 },
  dashes: { flex: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 },
  dash: { width: 5, height: 1, backgroundColor: "rgba(255,255,255,0.22)" },

  slots: { flexDirection: "row", gap: spacing.sm },
  slot: { flex: 1, gap: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: brandInk.strong },
  caption: { ...typography.caption, fontFamily: "Manrope_600SemiBold", fontSize: 11.5, color: brandInk.muted, fontVariant: ["tabular-nums"] },
  captionSpent: { color: "rgba(255,255,255,0.45)", textDecorationLine: "line-through" },

  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    minHeight: 50, borderRadius: radius.pill, backgroundColor: brandInk.plate, paddingHorizontal: spacing.xl,
  },
  ctaText: { ...typography.bodyMedium, fontFamily: "Manrope_800ExtraBold", fontSize: 15, color: brandInk.onPlate },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },

  foot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  footLabel: { ...typography.caption, flexShrink: 1, color: brandInk.muted },
  footBalance: { ...typography.caption, fontFamily: "Manrope_800ExtraBold", color: brandInk.strong, fontVariant: ["tabular-nums"] },
}));

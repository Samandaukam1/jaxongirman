import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Palette, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Image, Pressable, ScrollView, Text, View } from "react-native";

import { env } from "@/lib/env";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Which design a deck is made in — the author's call only when they want it.
 *
 * "Avtomatik dizayn" is on by default and lit: the generator chooses the
 * style and the colour from the topic, and that is the right answer for most
 * decks. Turned off, the three styles appear — not finished designs to pick
 * from, but the languages the generator composes in — and choosing one opens
 * its colour families. The generator still invents the deck; this only sets
 * its style and, if asked, its family of colour.
 *
 * The keys are the server's (`glass/dna.ts`: STYLES, PALETTES); the swatches
 * are how each family looks, not the exact colours a deck will get.
 */

export type DeckStyleKey = "glass" | "editorial" | "soft3d" | "corporate" | "naqsh" | "spektr" | "mozaika";
export type PaletteKey = "blue" | "teal" | "green" | "gold" | "orange" | "red" | "pink" | "violet";
export type DesignChoice = { auto: boolean; style: DeckStyleKey | null; palette: PaletteKey | null };

export const AUTOMATIC: DesignChoice = { auto: true, style: null, palette: null };

/** The styles, in the order offered. Names and notes are in the `deck` table under `design.style`. */
const STYLES: { key: DeckStyleKey }[] = [
  { key: "glass" }, { key: "editorial" }, { key: "soft3d" }, { key: "corporate" },
  { key: "naqsh" }, { key: "spektr" }, { key: "mozaika" },
];

/** Colour families and their swatch; names are in the `deck` table under `design.palette`. */
export const PALETTES: { key: PaletteKey; color: string }[] = [
  { key: "blue", color: "#3B6FE0" },
  { key: "teal", color: "#12A5B4" },
  { key: "green", color: "#2E9E5B" },
  { key: "gold", color: "#C99A16" },
  { key: "orange", color: "#EF7D2D" },
  { key: "red", color: "#D93A3A" },
  { key: "pink", color: "#E8508E" },
  { key: "violet", color: "#7C4DDB" },
];

/** What the server is sent: nothing when automatic, or when no style was picked. */
export function designRequestOf(choice: DesignChoice): { style: DeckStyleKey; palette: PaletteKey | null } | undefined {
  return choice.auto || !choice.style ? undefined : { style: choice.style, palette: choice.palette };
}

/** A thumbnail of each style, tinted by the chosen family — drawn, not a picture. */
/** The real bodom band a naqsh deck in this family is printed with, from the public catalogue. */
const naqshBand = (family: PaletteKey) => `${env.supabaseUrl}/storage/v1/object/public/design-assets/naqsh/${family}/band-96.jpg`;

/** A Spektr deck's hero gradient and the first colours of its spectrum, by family (`glass/spektr.ts`). */
const SPEKTR: Record<PaletteKey, { hero: [string, string, string]; spectrum: [string, string, string] }> = {
  blue: { hero: ["#1E3FD8", "#6A2BE0", "#C0268E"], spectrum: ["#2563EB", "#7C3AED", "#DB2777"] },
  teal: { hero: ["#0B5F7A", "#0B7A94", "#2F6BEA"], spectrum: ["#0E7490", "#2563EB", "#7C3AED"] },
  green: { hero: ["#04704F", "#0F7A3E", "#4D9A0F"], spectrum: ["#15803D", "#0E7490", "#2563EB"] },
  gold: { hero: ["#7A5200", "#A16207", "#E07A0A"], spectrum: ["#A16207", "#4D7C0F", "#C2410C"] },
  orange: { hero: ["#B2340A", "#CC4A0A", "#EF6C00"], spectrum: ["#C2410C", "#A16207", "#BE185D"] },
  red: { hero: ["#A81F17", "#DC2626", "#E07A0A"], spectrum: ["#DC2626", "#B45309", "#7C3AED"] },
  pink: { hero: ["#A3105A", "#D61F69", "#EF6C00"], spectrum: ["#DB2777", "#C2410C", "#7C3AED"] },
  violet: { hero: ["#4C1DB3", "#8A2BE2", "#E0378A"], spectrum: ["#7C3AED", "#DB2777", "#C2410C"] },
};

/** A Mozaika deck's field and four of its mosaic colours, by family (`glass/mozaika.ts`). */
const MOZAIKA: Record<PaletteKey, { hero: string; tiles: [string, string, string, string] }> = {
  blue: { hero: "#14206B", tiles: ["#F2447C", "#FF7A1F", "#FFC21F", "#13B5A6"] },
  teal: { hero: "#0B4D5A", tiles: ["#13B5A6", "#FFC21F", "#FF7A1F", "#F2447C"] },
  green: { hero: "#0E5A3A", tiles: ["#22B45A", "#FFC21F", "#FF7A1F", "#38B6E8"] },
  gold: { hero: "#17151F", tiles: ["#FFC21F", "#FF7A1F", "#22B45A", "#2F6DF6"] },
  orange: { hero: "#C2410C", tiles: ["#FFC21F", "#13B5A6", "#8B5CF6", "#2F6DF6"] },
  red: { hero: "#C81E2B", tiles: ["#8B5CF6", "#2F6DF6", "#FF7A1F", "#FFC21F"] },
  pink: { hero: "#B0175F", tiles: ["#FFC21F", "#FF7A1F", "#13B5A6", "#8B5CF6"] },
  violet: { hero: "#3A1A8F", tiles: ["#F2447C", "#FFC21F", "#FF7A1F", "#13B5A6"] },
};

function Preview({ style, tint, palette }: { style: DeckStyleKey; tint: string; palette: PaletteKey | null }) {
  const styles = useStyles();
  if (style === "mozaika") {
    const family = MOZAIKA[palette ?? "blue"];
    const [a, b, c, d] = family.tiles;
    return (
      <View style={[styles.preview, { backgroundColor: family.hero }]}>
        <View style={styles.mozaikaWords}>
          <View style={[styles.line, { width: 30, height: 4, backgroundColor: "#FFFFFF" }]} />
          <View style={[styles.line, { width: 20, backgroundColor: "rgba(255,255,255,0.7)" }]} />
        </View>
        <View style={styles.mozaikaGrid}>
          <View style={[styles.mozaikaCell, { backgroundColor: a, borderTopLeftRadius: 21 }]} />
          <View style={[styles.mozaikaCell, { backgroundColor: c }]}>
            <View style={[styles.mozaikaDot, { backgroundColor: d }]} />
          </View>
          <View style={[styles.mozaikaCell, { backgroundColor: b, borderTopLeftRadius: 10.5, borderTopRightRadius: 10.5 }]} />
          <View style={[styles.mozaikaCell, { backgroundColor: d, borderBottomRightRadius: 21, borderTopLeftRadius: 21 }]} />
          <View style={[styles.mozaikaCell, { backgroundColor: "#FFFFFF", borderRadius: 10.5 }]} />
          <View style={[styles.mozaikaCell, { backgroundColor: a, borderBottomLeftRadius: 21 }]} />
        </View>
      </View>
    );
  }
  if (style === "spektr") {
    const family = SPEKTR[palette ?? "violet"];
    return (
      <View style={[styles.preview, { backgroundColor: "#FFFFFF" }]}>
        <LinearGradient colors={family.hero} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={styles.spektrHero}>
          <View style={[styles.line, { width: 24, height: 4, backgroundColor: "#FFFFFF" }]} />
          <View style={[styles.line, { width: 16, backgroundColor: "rgba(255,255,255,0.75)" }]} />
          <View style={styles.spektrRing} />
        </LinearGradient>
        <View style={styles.spektrList}>
          {family.spectrum.map((color) => (
            <View key={color} style={styles.spektrRow}>
              <View style={[styles.spektrDisc, { backgroundColor: color }]} />
              <View style={[styles.line, { flex: 1, backgroundColor: "#1E2430" }]} />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (style === "naqsh") {
    return (
      <View style={[styles.preview, { backgroundColor: "#FFFDF9" }]}>
        <Image source={{ uri: naqshBand(palette ?? "green") }} style={styles.naqshBand} resizeMode="cover" />
        <View style={[styles.naqshLeaf, { borderColor: "#FFFFFF" }]}>
          <View style={[styles.brandPhotoSky, { backgroundColor: "#A9C7E8" }]} />
          <View style={styles.brandPhotoGround} />
        </View>
        <View style={styles.naqshStar}>
          <View style={[styles.naqshSquare, { backgroundColor: tint }]} />
          <View style={[styles.naqshSquare, styles.naqshTurned, { backgroundColor: tint }]} />
        </View>
        <View style={[styles.line, styles.naqshLine, { backgroundColor: "#2A2230" }]} />
      </View>
    );
  }
  if (style === "glass") {
    return (
      <View style={[styles.preview, { backgroundColor: "#1B1530" }]}>
        <View style={[styles.blob, { backgroundColor: tint, left: -14, top: -18, opacity: 0.85 }]} />
        <View style={[styles.blob, { backgroundColor: "#E8508E", right: -20, bottom: -26, opacity: 0.55 }]} />
        <View style={styles.glassCard}>
          <View style={[styles.line, { width: 34, backgroundColor: "rgba(255,255,255,0.85)" }]} />
          <View style={[styles.line, { width: 22, backgroundColor: "rgba(255,255,255,0.5)" }]} />
        </View>
        <View style={styles.sphere} />
      </View>
    );
  }
  if (style === "editorial") {
    return (
      <View style={[styles.preview, { backgroundColor: "#F5F0E8" }]}>
        <View style={[styles.field, { backgroundColor: tint }]}>
          <View style={[styles.line, { width: 26, height: 5, backgroundColor: "#FFFFFF" }]} />
          <View style={[styles.line, { width: 18, backgroundColor: "rgba(255,255,255,0.7)" }]} />
        </View>
        <View style={styles.paperColumn}>
          <View style={[styles.rule, { backgroundColor: "#1D1A16" }]} />
          <View style={[styles.line, { width: 30, backgroundColor: "#1D1A16" }]} />
          <View style={[styles.line, { width: 22, backgroundColor: "rgba(29,26,22,0.4)" }]} />
          <View style={[styles.rule, { backgroundColor: "rgba(29,26,22,0.25)" }]} />
        </View>
      </View>
    );
  }
  if (style === "corporate") {
    return (
      <View style={[styles.preview, { backgroundColor: "#FFFFFF" }]}>
        <View style={[styles.brandBand, { backgroundColor: tint }]} />
        <View style={[styles.brandPhoto, { borderColor: "#FFFFFF" }]}>
          <View style={[styles.brandPhotoSky, { backgroundColor: "#A9C7E8" }]} />
          <View style={styles.brandPhotoGround} />
        </View>
        <View style={styles.brandCard}>
          <View style={[styles.brandTile, { backgroundColor: tint }]} />
          <View style={[styles.line, { width: 22, backgroundColor: "#1E2430" }]} />
        </View>
        <View style={styles.brandDots}>
          {Array.from({ length: 8 }, (_, at) => <View key={at} style={[styles.brandDot, { backgroundColor: tint }]} />)}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.preview, { backgroundColor: "#E4E8EC" }]}>
      <View style={styles.softCard}>
        <View style={[styles.softDot, { backgroundColor: tint }]} />
        <View style={[styles.line, { width: 28, backgroundColor: "#2A3038" }]} />
        <View style={[styles.line, { width: 20, backgroundColor: "rgba(42,48,56,0.4)" }]} />
      </View>
      <View style={styles.dial}>
        <View style={styles.dialWell}>
          <View style={[styles.softDot, { backgroundColor: tint, margin: 0 }]} />
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { backgroundColor: tint }]} />
      </View>
    </View>
  );
}

export function DesignChooser({ value, onChange }: { value: DesignChoice; onChange: (next: DesignChoice) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("deck", { keyPrefix: "design" });
  const tint = PALETTES.find((entry) => entry.key === value.palette)?.color ?? colors.primary;

  const toggleAuto = () => {
    void Haptics.selectionAsync();
    onChange(value.auto ? { auto: false, style: value.style, palette: value.palette } : AUTOMATIC);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("title")}</Text>

      <Pressable accessibilityRole="switch" accessibilityState={{ checked: value.auto }} onPress={toggleAuto} style={styles.autoRow}>
        {value.auto ? (
          <LinearGradient colors={[colors.primaryBright, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.autoIcon, styles.autoIconLit]}>
            <Sparkles color={colors.onPrimary} size={18} strokeWidth={2.2} />
          </LinearGradient>
        ) : (
          <View style={styles.autoIcon}><Sparkles color={colors.inkSoft} size={18} strokeWidth={2} /></View>
        )}
        <View style={styles.autoCopy}>
          <Text style={styles.autoTitle}>{t("auto")}</Text>
          <Text style={styles.autoNote}>{value.auto ? t("autoOn") : t("autoOff")}</Text>
        </View>
        <View style={[styles.switch, value.auto && styles.switchOn]}>
          <View style={[styles.knob, value.auto && styles.knobOn]} />
        </View>
      </Pressable>

      {!value.auto ? (
        <>
          <View style={styles.styles}>
            {STYLES.map((entry) => {
              const active = value.style === entry.key;
              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => { void Haptics.selectionAsync(); onChange({ ...value, style: entry.key }); }}
                  style={({ pressed }) => [styles.styleCard, active && styles.styleCardActive, pressed && styles.pressed]}
                >
                  <Preview style={entry.key} tint={tint} palette={value.palette} />
                  <View style={styles.styleText}>
                    <Text numberOfLines={1} style={[styles.styleName, active && styles.styleNameActive]}>{t(`style.${entry.key}.name`)}</Text>
                    <Text numberOfLines={1} style={styles.styleNote}>{t(`style.${entry.key}.note`)}</Text>
                  </View>
                  {active ? <View style={styles.check}><Check color={colors.onPrimary} size={12} strokeWidth={3} /></View> : null}
                </Pressable>
              );
            })}
          </View>

          {value.style ? (
            <View style={styles.paletteBlock}>
              <View style={styles.paletteHead}>
                <Palette color={colors.inkMuted} size={15} strokeWidth={2} />
                <Text style={styles.paletteTitle}>{t("family")}</Text>
                <Text style={styles.paletteValue}>{value.palette ? t(`palette.${value.palette}`) : t("autoShort")}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={t("autoColor")}
                  accessibilityState={{ selected: !value.palette }}
                  onPress={() => { void Haptics.selectionAsync(); onChange({ ...value, palette: null }); }}
                  style={[styles.swatchRing, !value.palette && styles.swatchRingActive]}
                >
                  <LinearGradient colors={["#3B6FE0", "#E8508E", "#EF7D2D"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch}>
                    <Text style={styles.autoSwatchText}>A</Text>
                  </LinearGradient>
                </Pressable>
                {PALETTES.map((entry) => {
                  const active = value.palette === entry.key;
                  return (
                    <Pressable
                      key={entry.key}
                      accessibilityRole="radio"
                      accessibilityLabel={t(`palette.${entry.key}`)}
                      accessibilityState={{ selected: active }}
                      onPress={() => { void Haptics.selectionAsync(); onChange({ ...value, palette: entry.key }); }}
                      style={[styles.swatchRing, active && { borderColor: entry.color }]}
                    >
                      <View style={[styles.swatch, { backgroundColor: entry.color }]}>
                        {active ? <Check color="#FFFFFF" size={14} strokeWidth={3} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : (
            <Text style={styles.hint}>{t("hint")}</Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.bodyMedium, fontFamily: "Manrope_700Bold", color: colors.ink },
  autoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  autoIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  autoIconLit: { shadowColor: colors.primary, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  autoCopy: { flex: 1, gap: 2 },
  autoTitle: { ...typography.bodyMedium, color: colors.ink },
  autoNote: { ...typography.caption, color: colors.inkMuted },
  switch: { width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: colors.borderStrong, justifyContent: "center" },
  switchOn: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#FFFFFF" },
  knobOn: { alignSelf: "flex-end" },
  styles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  styleCard: { flexBasis: "47%", flexGrow: 1, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" },
  styleCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  styleText: { paddingHorizontal: 8, paddingVertical: 7, gap: 1 },
  styleName: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.ink },
  styleNameActive: { color: colors.primaryDeep },
  styleNote: { ...typography.caption, fontSize: 10, lineHeight: 13, color: colors.inkSoft },
  check: { position: "absolute", top: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  // Thumbnails.
  preview: { height: 64, overflow: "hidden" },
  blob: { position: "absolute", width: 64, height: 64, borderRadius: 32 },
  glassCard: { position: "absolute", left: 12, top: 16, width: 54, height: 34, borderRadius: 9, padding: 7, gap: 4, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
  sphere: { position: "absolute", right: 12, top: 10, width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.35)", borderWidth: 1, borderColor: "rgba(255,255,255,0.7)" },
  field: { position: "absolute", left: 0, top: 0, bottom: 0, width: "44%", padding: 8, gap: 4, justifyContent: "flex-end" },
  paperColumn: { position: "absolute", right: 8, top: 10, width: "44%", gap: 5 },
  rule: { height: 1.5, width: "100%" },
  softCard: { position: "absolute", left: 9, top: 10, width: 52, height: 40, borderRadius: 10, padding: 6, gap: 4, backgroundColor: "#E9EDF1",
    shadowColor: "#8A96A3", shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 3, height: 3 }, elevation: 3 },
  softDot: { width: 7, height: 7, borderRadius: 4 },
  dial: { position: "absolute", right: 10, top: 9, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#E9EDF1",
    shadowColor: "#8A96A3", shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 2, height: 2 }, elevation: 2 },
  dialWell: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#DCE1E6" },
  track: { position: "absolute", right: 8, bottom: 9, width: 34, height: 6, borderRadius: 3, backgroundColor: "#D3D9DF", overflow: "hidden" },
  trackFill: { width: "60%", height: "100%", borderRadius: 3 },
  line: { height: 3, borderRadius: 2 },
  brandBand: { position: "absolute", right: -18, bottom: -22, width: 96, height: 50, borderRadius: 22 },
  brandPhoto: { position: "absolute", left: 8, top: 9, width: 46, height: 46, borderRadius: 14, overflow: "hidden", borderWidth: 2,
    shadowColor: "#1E2430", shadowOpacity: 0.25, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  brandPhotoSky: { flex: 1 },
  brandPhotoGround: { height: 14, backgroundColor: "#6E8B5B" },
  brandCard: { position: "absolute", right: 10, top: 12, width: 44, height: 30, borderRadius: 8, padding: 5, gap: 4, backgroundColor: "#FFFFFF",
    shadowColor: "#1E2430", shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  brandTile: { width: 9, height: 9, borderRadius: 3 },
  brandDots: { position: "absolute", left: 62, bottom: 7, width: 26, flexDirection: "row", flexWrap: "wrap", gap: 3 },
  brandDot: { width: 3, height: 3, borderRadius: 2, opacity: 0.7 },
  naqshBand: { position: "absolute", right: 0, top: 0, bottom: 0, width: 26 },
  // The bodom's leaf: two opposite corners swept wide.
  naqshLeaf: {
    position: "absolute", left: 10, top: 9, width: 40, height: 48, overflow: "hidden", borderWidth: 2,
    borderTopLeftRadius: 16, borderBottomRightRadius: 16, borderTopRightRadius: 4, borderBottomLeftRadius: 4,
  },
  naqshStar: { position: "absolute", left: 60, top: 14, width: 12, height: 12 },
  naqshSquare: { position: "absolute", left: 1.5, top: 1.5, width: 9, height: 9, borderRadius: 1.5 },
  naqshTurned: { transform: [{ rotate: "45deg" }] },
  naqshLine: { position: "absolute", left: 60, top: 34, width: 26 },
  spektrHero: { position: "absolute", left: 0, top: 0, bottom: 0, width: "54%", padding: 8, gap: 4, justifyContent: "flex-end", overflow: "hidden" },
  // The giant line icon, standing off the gradient's right edge.
  spektrRing: { position: "absolute", right: -12, top: 10, width: 34, height: 34, borderRadius: 11, borderWidth: 2.5, borderColor: "rgba(255,255,255,0.9)" },
  spektrList: { position: "absolute", right: 8, top: 11, width: "34%", gap: 6 },
  spektrRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  spektrDisc: { width: 9, height: 9, borderRadius: 5 },
  mozaikaWords: { position: "absolute", left: 9, bottom: 12, gap: 4 },
  // A block of six cells, each a figure of the mosaic.
  mozaikaGrid: { position: "absolute", right: 0, top: 0, width: 63, height: 42, flexDirection: "row", flexWrap: "wrap", marginTop: 11 },
  mozaikaCell: { width: 21, height: 21, alignItems: "center", justifyContent: "center" },
  mozaikaDot: { width: 9, height: 9, borderRadius: 5 },
  hint: { ...typography.caption, color: colors.inkSoft },
  // Colour families.
  paletteBlock: { gap: spacing.sm },
  paletteHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  paletteTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.inkMuted, flex: 1 },
  paletteValue: { ...typography.caption, color: colors.inkSoft },
  swatches: { gap: spacing.sm, paddingVertical: 2, paddingRight: spacing.sm },
  swatchRing: { padding: 3, borderRadius: 22, borderWidth: 2, borderColor: "transparent" },
  swatchRingActive: { borderColor: colors.primary },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  autoSwatchText: { fontFamily: "Manrope_700Bold", fontSize: 13, color: "#FFFFFF" },
}));

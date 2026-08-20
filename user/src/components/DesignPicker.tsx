import { Check, Sparkles } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SlideCanvas } from "@/components/SlideCanvas";
import { assetUrl, familiesOf, loadDesignFonts, previewToCanvas, type RemoteDesign } from "@/lib/jslayd-designs";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

const MODEL_WIDTH = 1000;
const MODEL_HEIGHT = 562.5;
const CARD_WIDTH = 232;

/**
 * The remote-design picker (§64, §65, §66).
 *
 * A card draws the design itself, on sample content, through the same engine
 * that will draw the deck. There used to be an uploaded cover picture in front
 * of this, and it was a second version of the design that nothing kept in step:
 * edit a design's colours and the card went on advertising the old ones, so the
 * deck a person chose was not the deck they saw. The render cannot drift,
 * because there is nothing for it to drift from.
 *
 * The design's typefaces are fetched as its card appears. Until they arrive the
 * preview draws in the fallback the design itself declared, so the card is
 * never blank and never lies about which face it is showing.
 */
function DesignThumbnail({ design }: { design: RemoteDesign }) {
  const { slide, elements } = useMemo(() => previewToCanvas(design.row), [design.row]);
  const scale = CARD_WIDTH / MODEL_WIDTH;

  useEffect(() => { void loadDesignFonts(design); }, [design]);

  /**
   * An imported PowerPoint template shows its own cover.
   *
   * The paragraph above is right about a written design and wrong about this
   * one. A written design's card cannot drift from the design because the card
   * *is* the design, drawn. A template is not drawn at all — the exported deck
   * is the original package with its words replaced — so drawing it produces a
   * picture of something that will never exist, and the closer the renderer
   * gets the more misleading the difference becomes.
   *
   * The package carries the real thing: `docProps/thumbnail.jpeg`, the first
   * slide as PowerPoint itself rasterised it, copied out at import. This cannot
   * drift either, for the opposite reason — it and the exported file come from
   * the same package.
   */
  const cover = design.row.design_source === "pptx"
    ? assetUrl("design-assets", design.row.thumbnail_path)
    : null;
  if (cover) {
    return (
      <View pointerEvents="none" style={[styles.thumb, { width: CARD_WIDTH, height: MODEL_HEIGHT * scale }]}>
        <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={[styles.thumb, { width: CARD_WIDTH, height: MODEL_HEIGHT * scale }]}>
      <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale }], transformOrigin: "top left" }}>
        <SlideCanvas slide={slide} elements={elements} />
      </View>
    </View>
  );
}

export function DesignPicker({
  designs,
  selected,
  onSelect,
}: {
  designs: RemoteDesign[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  if (designs.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {designs.map((design) => {
        const active = design.row.slug === selected;
        return (
          <Pressable
            key={design.row.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            // Tapping the chosen design again clears it, which is how a user
            // gets back to the built-in look without hunting for a reset.
            onPress={() => onSelect(active ? null : design.row.slug)}
            style={[styles.card, active && styles.cardActive]}
          >
            <DesignThumbnail design={design} />
            <View style={styles.meta}>
              <Text numberOfLines={1} style={styles.name}>{design.row.name}</Text>
              <Text numberOfLines={2} style={styles.tagline}>{design.row.description}</Text>
            </View>
            {familiesOf(design.row).length > 1 ? (
              <Text style={styles.families}>{familiesOf(design.row).length} rang oilasi</Text>
            ) : null}
            {design.row.is_premium ? (
              <View style={styles.premium}>
                <Sparkles color={colors.onPrimary} size={11} strokeWidth={icon.strokeBold} />
                <Text style={styles.premiumText}>Premium</Text>
              </View>
            ) : null}
            {active ? (
              <View style={styles.check}><Check color={colors.onPrimary} size={12} strokeWidth={icon.strokeBold} /></View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.md, paddingVertical: spacing.xs, paddingRight: spacing.xl },
  card: { width: CARD_WIDTH + 2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden", ...shadow },
  cardActive: { borderColor: colors.primary, borderWidth: 2 },
  cover: { width: "100%", height: "100%" },
  thumb: { overflow: "hidden", backgroundColor: colors.surfaceMuted },
  meta: { padding: spacing.md, gap: 2 },
  name: { ...typography.bodyMedium, color: colors.ink },
  tagline: { ...typography.caption, color: colors.inkMuted },
  families: { ...typography.caption, color: colors.inkMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  premium: { position: "absolute", top: spacing.sm, left: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.primary },
  premiumText: { ...typography.caption, color: colors.onPrimary, fontSize: 10 },
  check: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});

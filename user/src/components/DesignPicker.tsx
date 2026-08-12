import { Check, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SlideCanvas } from "@/components/SlideCanvas";
import { familiesOf, loadDesignFonts, previewToCanvas, thumbnailUrl, type RemoteDesign } from "@/lib/jslayd-designs";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

const MODEL_WIDTH = 1000;
const MODEL_HEIGHT = 562.5;
const CARD_WIDTH = 232;

/**
 * The remote-design picker (§64, §65, §66).
 *
 * A card shows the admin's own cover artwork when there is one, and otherwise
 * the design rendered on sample content — which is the same engine output the
 * generator will produce, not an illustration of it.
 *
 * The design's typefaces are fetched as its card appears. Until they arrive the
 * thumbnail draws in the fallback the design itself declared, so the card is
 * never blank and never lies about which face it is showing.
 */
function DesignThumbnail({ design }: { design: RemoteDesign }) {
  const cover = thumbnailUrl(design.row);
  const [coverFailed, setCoverFailed] = useState(false);
  const { slide, elements } = useMemo(() => previewToCanvas(design.row), [design.row]);
  const scale = CARD_WIDTH / MODEL_WIDTH;

  useEffect(() => { void loadDesignFonts(design); }, [design]);

  if (cover && !coverFailed) {
    return (
      <Image
        onError={() => setCoverFailed(true)}
        source={{ uri: cover }}
        style={[styles.thumb, { width: CARD_WIDTH, height: MODEL_HEIGHT * scale }]}
        resizeMode="cover"
      />
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
  thumb: { overflow: "hidden", backgroundColor: colors.surfaceMuted },
  meta: { padding: spacing.md, gap: 2 },
  name: { ...typography.bodyMedium, color: colors.ink },
  tagline: { ...typography.caption, color: colors.inkMuted },
  families: { ...typography.caption, color: colors.inkMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  premium: { position: "absolute", top: spacing.sm, left: spacing.sm, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.primary },
  premiumText: { ...typography.caption, color: colors.onPrimary, fontSize: 10 },
  check: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});

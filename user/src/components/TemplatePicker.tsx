import { Check } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { SlideCanvas } from "@/components/SlideCanvas";
import { previewToCanvas, resolvePreview, type PaletteFamilyRow, type SlideTemplateRow } from "@/lib/design";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

const MODEL_WIDTH = 1000;
const MODEL_HEIGHT = 562.5;
const CARD_WIDTH = 216;

/**
 * Thumbnails are the real renderer running the real stored preview, so what the
 * picker shows is exactly what the generator will build.
 */
function Thumbnail({ template, palette }: { template: SlideTemplateRow; palette: PaletteFamilyRow }) {
  const { slide, elements } = useMemo(() => {
    const preview = resolvePreview(template, palette);
    return previewToCanvas(preview, `${template.code}-${palette.code}`);
  }, [palette, template]);

  const scale = CARD_WIDTH / MODEL_WIDTH;
  return (
    <View pointerEvents="none" style={[styles.thumb, { width: CARD_WIDTH, height: MODEL_HEIGHT * scale }]}>
      <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale }], transformOrigin: "top left" }}>
        <SlideCanvas slide={slide} elements={elements} />
      </View>
    </View>
  );
}

export function TemplatePicker({
  templates,
  palette,
  selected,
  onSelect,
}: {
  templates: SlideTemplateRow[];
  palette: PaletteFamilyRow | null;
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  if (!palette || templates.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {templates.map((template) => {
        const active = template.code === selected;
        return (
          <Pressable
            key={template.code}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(template.code)}
            style={[styles.card, active && styles.cardActive]}
          >
            <Thumbnail template={template} palette={palette} />
            <View style={styles.meta}>
              <Text numberOfLines={1} style={styles.name}>{template.name}</Text>
              <Text numberOfLines={2} style={styles.tagline}>{template.tagline}</Text>
            </View>
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
  check: { position: "absolute", top: spacing.sm, right: spacing.sm, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});

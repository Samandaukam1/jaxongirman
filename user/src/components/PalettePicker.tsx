import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { PaletteFamilyRow, PaletteTokens } from "@/lib/design";
import { colors, radius, spacing, typography } from "@/theme/tokens";

/** The three roles that carry a family's identity at a glance. */
const SWATCH_ROLES = ["contrast", "primary", "accent"] as const;

export function PalettePicker({
  palettes,
  selected,
  onSelect,
}: {
  palettes: PaletteFamilyRow[];
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {palettes.map((family) => {
        const tokens = (family.tokens ?? {}) as PaletteTokens;
        const active = family.code === selected;
        return (
          <Pressable
            key={family.code}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(family.code)}
            style={[styles.pill, active && styles.pillActive]}
          >
            <View style={styles.swatches}>
              {SWATCH_ROLES.map((role) => (
                <View key={role} style={[styles.swatch, { backgroundColor: tokens[role] ?? colors.border }]} />
              ))}
            </View>
            <Text numberOfLines={1} style={[styles.name, active && styles.nameActive]}>{family.name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.xl },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 46, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft },
  swatches: { flexDirection: "row" },
  // Overlapping discs read as a colour family rather than three separate chips.
  swatch: { width: 18, height: 18, borderRadius: 9, marginRight: -6, borderWidth: 1.5, borderColor: colors.surface },
  name: { ...typography.caption, color: colors.inkMuted, marginLeft: 6 },
  nameActive: { color: colors.primary },
});

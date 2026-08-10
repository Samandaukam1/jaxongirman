import { Frame, Image as ImageIcon, Plus, Shapes, Type, Video, X, type LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

export type AddKind = "text" | "shape" | "image" | "video" | "frame";

const OPTIONS: { kind: AddKind; label: string; icon: LucideIcon }[] = [
  { kind: "text", label: "Matn", icon: Type },
  { kind: "shape", label: "Shakl", icon: Shapes },
  { kind: "image", label: "Rasm", icon: ImageIcon },
  { kind: "video", label: "Video", icon: Video },
  { kind: "frame", label: "Ramka", icon: Frame },
];

/**
 * The slide's insert point. Collapsed it is a single button next to whatever
 * the editor wants to say; open it fans out the five things a slide can hold.
 */
export function AddElementBar({
  open,
  hint,
  busy,
  onToggle,
  onAdd,
}: {
  open: boolean;
  /** Shown beside the button while nothing is selected. */
  hint: string | null;
  busy: boolean;
  onToggle: () => void;
  onAdd: (kind: AddKind) => void;
}) {
  return (
    <View style={styles.card}>
      {open ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
          {OPTIONS.map((option) => (
            <Pressable key={option.kind} disabled={busy} onPress={() => onAdd(option.kind)} style={[styles.option, busy && styles.busy]}>
              <View style={styles.optionGlyph}>
                <option.icon color={colors.primary} size={icon.md} strokeWidth={icon.stroke} />
              </View>
              <Text style={styles.optionLabel}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        <Pressable accessibilityLabel={open ? "Yopish" : "Element qo‘shish"} onPress={onToggle} style={styles.button}>
          {open
            ? <X color={colors.onPrimary} size={icon.md} strokeWidth={icon.strokeBold} />
            : <Plus color={colors.onPrimary} size={icon.md} strokeWidth={icon.strokeBold} />}
        </Pressable>
        <Text numberOfLines={1} style={styles.hint}>{hint ?? (open ? "Qo‘shiladigan elementni tanlang" : "Element qo‘shish")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden", ...shadow },
  options: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  option: { width: 72, alignItems: "center", gap: 5 },
  optionGlyph: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  optionLabel: { ...typography.caption, color: colors.inkMuted },
  busy: { opacity: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm },
  button: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  hint: { ...typography.caption, color: colors.inkMuted, flex: 1 },
});

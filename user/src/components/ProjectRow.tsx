import { FileText, GraduationCap, Image as ImageIcon, Presentation } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { KIND_LABEL, statusLabel, type Project, type ProjectKind } from "@/lib/projects";
import { colors, radius, spacing, typography } from "@/theme/tokens";

/**
 * One thing this account has made, whatever kind of thing it is.
 *
 * The same row for all four, because from the reader's side they are the same
 * object: something with a name, a date, and a place it opens. A different card
 * per kind would say the opposite — that these are four apps sharing a screen.
 * The only thing that varies is the glyph, which is how you tell them apart at
 * a glance without reading anything.
 */

const GLYPH: Record<ProjectKind, typeof Presentation> = {
  presentation: Presentation,
  portrait: ImageIcon,
  objective: FileText,
  academic: GraduationCap,
};

/** Anything not finished says so; a finished thing says nothing. */
const LOUD = new Set(["writing", "planning", "paused", "failed", "generating", "draft"]);

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "hozir";
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} kun oldin` : new Date(iso).toLocaleDateString("uz");
}

export function ProjectRow({ project, onPress }: { project: Project; onPress: () => void }) {
  const Glyph = GLYPH[project.kind];
  const status = statusLabel(project.status);
  const loud = project.status ? LOUD.has(project.status) : false;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${KIND_LABEL[project.kind]}: ${project.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.glyph}><Glyph color={colors.primary} size={20} strokeWidth={1.9} /></View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{project.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {KIND_LABEL[project.kind]} · {project.detail} · {ago(project.updatedAt)}
        </Text>
      </View>
      {status && loud ? (
        <View style={styles.badge}><Text style={styles.badgeText}>{status}</Text></View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  glyph: {
    width: 44, height: 44, borderRadius: 15,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primarySoft,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: "700", color: colors.ink },
  meta: { ...typography.caption, color: colors.inkSoft },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  badgeText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
});

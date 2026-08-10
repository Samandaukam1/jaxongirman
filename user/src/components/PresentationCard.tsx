import type { Tables } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight, Clock3, Layers3 } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { formatRelativeDate } from "@/lib/format";
import { colors, icon, radius, shadow, spacing, typography } from "@/theme/tokens";

type Presentation = Tables<"presentations">;

const palette: Record<Presentation["style"], readonly [string, string]> = {
  simple: ["#F4F1FB", "#DDD5EE"],
  good: ["#EDE3FC", "#C6AEF0"],
  great: ["#BC90F4", "#7B41DC"],
  super_professional: ["#4B1C96", "#1E0A3C"],
};

const styleLabel: Record<Presentation["style"], string> = {
  simple: "Oddiy",
  good: "Yaxshi",
  great: "Ajoyib",
  super_professional: "Super professional",
};

const statusLabel: Record<Presentation["status"], string> = {
  draft: "Draft",
  queued: "Navbatda",
  generating: "Yaratilmoqda",
  ready: "Tayyor",
  failed: "Xatolik",
  archived: "Arxiv",
};

export function PresentationCard({ item, onPress }: { item: Presentation; onPress: () => void }) {
  const isDark = item.style === "super_professional" || item.style === "great";
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <LinearGradient colors={palette[item.style]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.preview}>
        <View style={[styles.previewLine, isDark && styles.previewLineDark]} />
        <Text numberOfLines={3} style={[styles.previewTitle, isDark && styles.previewTitleDark]}>{item.title}</Text>
        <View style={[styles.previewDot, isDark && styles.previewDotDark]} />
      </LinearGradient>
      <View style={styles.details}>
        <View style={styles.titleRow}>
          <View style={styles.titleArea}>
            <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
            <Text style={styles.styleLabel}>{styleLabel[item.style]}</Text>
          </View>
          <ChevronRight color={colors.inkSoft} size={icon.md} strokeWidth={icon.stroke} />
        </View>
        <View style={styles.meta}>
          <View style={styles.metaItem}><Layers3 color={colors.accent} size={icon.xs} strokeWidth={icon.stroke} /><Text style={styles.metaText}>{item.generated_slide_count || item.requested_slide_count} slayd</Text></View>
          <View style={styles.metaItem}><Clock3 color={colors.accent} size={icon.xs} strokeWidth={icon.stroke} /><Text style={styles.metaText}>{formatRelativeDate(item.created_at)}</Text></View>
          <View style={[styles.status, item.status === "failed" && styles.statusFailed, item.status === "ready" && styles.statusReady]}>
            <Text style={[styles.statusText, item.status === "failed" && styles.statusTextFailed, item.status === "ready" && styles.statusTextReady]}>{statusLabel[item.status]}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadow },
  pressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  preview: { width: 116, aspectRatio: 16 / 10, borderRadius: radius.md, padding: spacing.md, justifyContent: "center", overflow: "hidden" },
  previewLine: { position: "absolute", width: 90, height: 1, backgroundColor: "rgba(21,14,36,.16)", transform: [{ rotate: "-35deg" }], right: -18, top: 16 },
  previewLineDark: { backgroundColor: "rgba(255,255,255,.28)" },
  previewTitle: { fontFamily: "Manrope_700Bold", fontSize: 11, lineHeight: 14, color: colors.ink, maxWidth: 83 },
  previewTitleDark: { color: colors.onPrimary },
  previewDot: { position: "absolute", width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(255,255,255,.55)", right: -5, bottom: -5 },
  previewDotDark: { backgroundColor: "rgba(255,255,255,.22)" },
  details: { flex: 1, justifyContent: "space-between", paddingVertical: spacing.xs },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  titleArea: { flex: 1 },
  title: { ...typography.bodyMedium, color: colors.ink },
  styleLabel: { ...typography.caption, color: colors.inkMuted, marginTop: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  metaItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metaText: { ...typography.caption, color: colors.inkMuted },
  status: { marginLeft: "auto", paddingVertical: 4, paddingHorizontal: 9, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
  statusReady: { backgroundColor: colors.successSoft },
  statusFailed: { backgroundColor: colors.dangerSoft },
  statusText: { fontFamily: "Manrope_600SemiBold", fontSize: 10, color: colors.inkMuted },
  statusTextReady: { color: colors.success },
  statusTextFailed: { color: colors.danger },
});

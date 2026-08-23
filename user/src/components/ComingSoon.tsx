import type { LucideIcon } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { colors, radius, spacing, typography } from "@/theme/tokens";

/**
 * A workflow that is being built, said plainly.
 *
 * The alternative was to leave its card off the projects screen until the
 * engine behind it exists. That hides the shape of the product from the people
 * who would tell us whether it is the right shape — and a card that navigates
 * nowhere is worse than either. So the door is real, it opens, and what is
 * behind it says what it will do and that it is not finished.
 *
 * This component is temporary by design. Each screen that uses it is replaced
 * by the real thing, not extended.
 */
export function ComingSoon({
  title,
  summary,
  steps,
  Glyph,
}: {
  title: string;
  summary: string;
  steps: string[];
  Glyph: LucideIcon;
}) {
  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}><Glyph color={colors.primary} size={30} strokeWidth={1.8} /></View>
        <Text style={styles.summary}>{summary}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Bosqichlar</Text>
          {steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.note}>
          Bu bo‘lim hozir tayyorlanmoqda. Tayyor bo‘lganda shu yerda ochiladi —
          ilovani yangilashingiz shart emas.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.xl, gap: spacing.lg, alignItems: "flex-start" },
  badge: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  summary: { ...typography.body, color: colors.ink },
  card: { alignSelf: "stretch", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, gap: spacing.md },
  cardTitle: { ...typography.caption, fontWeight: "700", color: colors.inkMuted },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  stepNumber: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  stepNumberText: { ...typography.caption, fontWeight: "700", color: colors.onPrimary },
  stepText: { ...typography.body, flex: 1, color: colors.ink },
  note: { ...typography.caption, color: colors.inkSoft },
});

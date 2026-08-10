import { Gamepad2 } from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { BOTTOM_NAV_SPACE } from "@/components/BottomNav";
import { EmptyState } from "@/components/StateBlocks";
import { colors, spacing, typography } from "@/theme/tokens";

/**
 * The games shell. Nothing in the database describes a game yet, so this is a
 * route that exists and says what it is for — not a screen pretending to have
 * content.
 */
export default function GamesScreen() {
  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>JAXONGIRMAN</Text>
          <Text style={styles.title}>O‘yinlar</Text>
          <Text style={styles.subtitle}>Bilim sinovlari va musobaqalar.</Text>
        </View>

        <EmptyState
          icon={Gamepad2}
          title="O‘yinlar tayyorlanmoqda"
          message="Birinchi o‘yinlar qo‘shilganda shu bo‘limda ochiladi."
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas, paddingTop: 58 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: BOTTOM_NAV_SPACE + spacing.xl, gap: spacing.xl },
  header: { gap: 4 },
  eyebrow: { ...typography.caption, color: colors.accent, letterSpacing: 1.7 },
  title: { ...typography.title, color: colors.ink },
  subtitle: { ...typography.body, color: colors.inkMuted },
});

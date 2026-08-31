import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { Text, TextInput, View } from "react-native";

import { ScreenHeader } from "@/components/ScreenHeader";
import { useMarathonEnabled } from "@/lib/marathon";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Where every vote button leads.
 *
 * One destination for all four of them: a person who taps "Ovoz berish" on the
 * marketplace and on the home screen has to arrive at the same place, or they
 * are two features wearing one name.
 *
 * The search itself is the next slice; this screen exists now so the buttons
 * lead somewhere real rather than nowhere, and so the route is in place before
 * anything links to it.
 */
export default function MarathonVoteScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const enabled = useMarathonEnabled();
  const router = useRouter();

  // The route is public in the sense that Expo Router will match it; the
  // marathon being off means it shows nothing and offers a way back.
  if (!enabled) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Ovoz berish" variant="back" />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Marafon hozircha faol emas.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="OVOZ BERISH" variant="back" />
      <View style={styles.content}>
        <Text style={styles.lead}>
          Qo‘llab-quvvatlamoqchi bo‘lgan ishtirokchini username orqali toping.
        </Text>
        <View style={styles.searchRow}>
          <Search color={colors.inkMuted} size={icon.sm} strokeWidth={icon.stroke} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="@ username orqali qidiring"
            placeholderTextColor={colors.inkMuted}
            style={styles.searchInput}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.lg },
  lead: { ...typography.body, color: colors.inkMuted },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    height: 46, paddingHorizontal: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { ...typography.body, color: colors.inkMuted },
}));

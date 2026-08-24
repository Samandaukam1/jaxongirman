import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The deep-link target for `jaxongirman://pair/<token>`.
 *
 * Exists so a code scanned with the phone's own camera app lands somewhere
 * useful rather than nowhere. The claim is the same server call the in-app
 * scanner makes, with the same one-use guarantee.
 */
export default function PairScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!token) { setError("Kod topilmadi."); return; }
      const { data, error: claimError } = await supabase.rpc("presentation_pairing_claim", {
        p_token: token,
        // Null rather than omitted: this parameter happens to have a default
        // today, and a call that only works because of that is one schema
        // change away from failing with "function not found".
        p_presentation_id: null as unknown as string,
      });
      if (!active) return;
      if (claimError) { setError(asErrorMessage(claimError)); return; }
      const result = data as unknown as { session_id: string; realtime_token: string };
      router.replace({
        pathname: "/(app)/present/[sessionId]",
        params: { sessionId: result.session_id, realtimeToken: result.realtime_token },
      });
    })();
    return () => { active = false; };
  }, [router, token]);

  if (error) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Ulanish" variant="close" />
        <View style={styles.content}>
          <ErrorState message={error} />
          <PrimaryButton label="Qaytadan skaner qilish" onPress={() => router.replace("/(app)/present/scan")} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Ulanmoqda" />
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.copy}>Ekran bilan bog‘lanmoqda…</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  copy: { ...typography.body, color: colors.inkMuted },
}));

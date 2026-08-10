import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { colors, spacing, typography } from "@/theme/tokens";

/**
 * Landing screen for the email-confirmation deep link. AuthProvider consumes the
 * URL and creates the session; this screen only waits for that to land.
 */
export default function AuthCallbackScreen() {
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  if (!loading && session) return <Redirect href="/(app)" />;
  if (timedOut) return <Redirect href="/(auth)/sign-in" />;

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.label}>Email tasdiqlanmoqda…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  label: { ...typography.body, color: colors.inkMuted, marginTop: spacing.lg },
});

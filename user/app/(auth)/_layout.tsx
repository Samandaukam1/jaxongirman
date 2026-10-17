import { LinearGradient } from "expo-linear-gradient";
import { Redirect, Stack } from "expo-router";
import { View } from "react-native";

import { useRoom } from "@/lib/useDesktop";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * Signed out. In a wide browser window the sign-in screen keeps a phone's width
 * in the middle of the page, on the same wash it draws for itself, so the two
 * meet without a seam.
 */
export default function AuthLayout() {
  const { session } = useAuth();
  const { colors } = useTheme();
  const room = useRoom();
  if (session) return <Redirect href="/(app)" />;
  return (
    <LinearGradient colors={colors.authWash} locations={[0, 0.42, 0.78]} style={{ flex: 1 }}>
      <View style={{ flex: 1, width: "100%", maxWidth: room === "phone" ? undefined : 480, alignSelf: "center" }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }} />
      </View>
    </LinearGradient>
  );
}

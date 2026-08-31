import { Arimo_400Regular, Arimo_700Bold } from "@expo-google-fonts/arimo";
import { CaveatBrush_400Regular } from "@expo-google-fonts/caveat-brush";
import { Inter_400Regular, Inter_900Black } from "@expo-google-fonts/inter";
import { LeagueSpartan_700Bold, LeagueSpartan_800ExtraBold } from "@expo-google-fonts/league-spartan";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, useFonts } from "@expo-google-fonts/manrope";
import { PinyonScript_400Regular } from "@expo-google-fonts/pinyon-script";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/providers/AuthProvider";
import { ThemeProvider, useTheme } from "@/theme/ThemeProvider";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Manrope carries the app chrome. The rest are here because published designs
  // ask for them by name and ship no files of their own — a design that names
  // "Inter" and uploads nothing is relying on the app to have it. Checked
  // against the catalogue, not assumed: these six are every family the current
  // designs reference. Dropping one does not fail loudly; it renders that
  // design's type in whatever the platform substitutes.
  const [loaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
    LeagueSpartan_700Bold, LeagueSpartan_800ExtraBold,
    PinyonScript_400Regular,
    Arimo_400Regular, Arimo_700Bold,
    Inter_400Regular, Inter_900Black,
    CaveatBrush_400Regular,
  });

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ThemedShell />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The navigator, inside the theme rather than around it.
 *
 * The status bar and the colour behind every screen are both decided by the
 * palette, and a component cannot read a provider it is a parent of — so the
 * shell is its own component under `ThemeProvider`. Without this, the gap that
 * shows during a push transition stays white all night.
 */
function ThemedShell() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen name="auth/callback" />
        {/* Reachable signed out: a scanned marathon QR has to be remembered
            before the sign-in gate can throw the destination away. */}
        <Stack.Screen name="marathon/[campaignId]/[candidateId]" />
      </Stack>
    </>
  );
}

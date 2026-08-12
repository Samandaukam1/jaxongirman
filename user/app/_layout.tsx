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
import { colors } from "@/theme/tokens";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Manrope carries the app chrome; the rest are slide-template voices. Inter
  // and Caveat Brush are Toza osmon's only two faces — that design uses nothing
  // else, so both must be present before a slide renders.
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
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="auth/callback" />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

import { Redirect, Stack } from "expo-router";

import { AccountProvider } from "@/providers/AccountProvider";
import { PaymentPolicyProvider } from "@/providers/PaymentPolicyProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";

export default function AppLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;
  return (
    // Mounted inside the authenticated area so the wallet, profile and inbox
    // subscriptions only ever exist for a signed-in person, and tear down with
    // the session rather than outliving it.
    <AccountProvider>
      <PaymentPolicyProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
              // Named rather than left to the platform default, so a push feels
              // the same on both. 260ms is the far edge of "instant" — long
              // enough to see where the screen came from, short enough that
              // nobody waits through it twice.
              animation: "slide_from_right",
              animationDuration: 260,
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="notifications"
              options={{ presentation: "modal", animation: "slide_from_bottom" }}
            />
            {/* A full screen rather than a sheet, and no swipe-to-dismiss: a
              half-filled form should only be abandoned on purpose, through the
              button in its own header. */}
            <Stack.Screen
              name="create"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            <Stack.Screen
              name="generation/[id]"
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen name="presentation/[id]" />
            <Stack.Screen name="coins/send" />
            <Stack.Screen name="coins/buy" />
            <Stack.Screen name="tarif/index" />
            <Stack.Screen name="survey/index" />
            {/* The survey builder and the response form are both long forms whose
              in-progress state lives only in memory — the same rule as `create`. */}
            <Stack.Screen
              name="survey/create"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            <Stack.Screen name="survey/templates" />
            <Stack.Screen name="survey/access" />
            <Stack.Screen
              name="survey/[id]"
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen name="survey/results/[id]" />
            <Stack.Screen name="marketplace/[id]" />
            {/* A viewer, not a document: full screen, and left on purpose. */}
            <Stack.Screen
              name="marketplace/preview/[id]"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            {/* Checkout and the seller form are both flows a person should leave on
              purpose, through their own header button, rather than by swiping. */}
            <Stack.Screen
              name="marketplace/checkout"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            <Stack.Screen
              name="marketplace/sell"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            <Stack.Screen name="marketplace/seller" />
            <Stack.Screen name="marketplace/library" />
            <Stack.Screen name="earnings" />
            <Stack.Screen name="cards" />
            {/* The scanner is a camera surface; leaving it should be deliberate. */}
            <Stack.Screen
              name="present/scan"
              options={{ presentation: "fullScreenModal", animation: "slide_from_bottom", gestureEnabled: false }}
            />
            <Stack.Screen
              name="present/[sessionId]"
              options={{ gestureEnabled: false }}
            />
            <Stack.Screen name="pair/[token]" />
          </Stack>
      </PaymentPolicyProvider>
    </AccountProvider>
  );
}

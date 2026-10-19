import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";

import { BottomNav } from "@/components/BottomNav";
import { RouteError } from "@/components/RouteError";
import { useDesktop } from "@/lib/useDesktop";
import { useTheme } from "@/theme/ThemeProvider";

/** A screen that throws shows a retry, rather than closing the app. */
export const ErrorBoundary = RouteError;

/**
 * The five places a person moves between. A tab navigator rather than stack
 * pushes, so the pill is mounted once and only the page under it swaps —
 * switching tabs animates nothing that should stay put.
 *
 * Order matters: it is the order the pill draws, left to right.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation("nav");
  // On a desktop the side menu is the navigation; the bar would be a second one.
  const desktop = useDesktop();
  return (
    <Tabs
      tabBar={(props) => (desktop ? null : <BottomNav {...props} />)}
      screenOptions={{
        headerShown: false,
        // A short cross-fade rather than an instant swap. Nothing slides —
        // sliding implies the tabs are laid out side by side and invites a
        // swipe that does not exist — but a hard cut reads as a dropped frame,
        // which is exactly what the app was being accused of.
        animation: "fade",
        transitionSpec: { animation: "timing", config: { duration: 160 } },
        sceneStyle: { backgroundColor: colors.canvas },
        // A tab that is not on screen does not re-render. Without this every
        // change to the account (a balance, an unread count) re-drew all five
        // pages, four of them invisible — which is what made switching tabs
        // stutter once a few had been opened.
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("home") }} />
      <Tabs.Screen name="projects" options={{ title: t("projects") }} />
      <Tabs.Screen name="marketplace" options={{ title: t("store") }} />
      <Tabs.Screen name="games" options={{ title: t("games") }} />
      <Tabs.Screen name="profile" options={{ title: t("profile") }} />
    </Tabs>
  );
}

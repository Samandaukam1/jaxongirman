import { Tabs } from "expo-router";

import { BottomNav } from "@/components/BottomNav";
import { useTheme } from "@/theme/ThemeProvider";

/**
 * The five places a person moves between. A tab navigator rather than stack
 * pushes, so the pill is mounted once and only the page under it swaps —
 * switching tabs animates nothing that should stay put.
 *
 * Order matters: it is the order the pill draws, left to right.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        // A short cross-fade rather than an instant swap. Nothing slides —
        // sliding implies the tabs are laid out side by side and invites a
        // swipe that does not exist — but a hard cut reads as a dropped frame,
        // which is exactly what the app was being accused of.
        animation: "fade",
        transitionSpec: { animation: "timing", config: { duration: 160 } },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Bosh sahifa" }} />
      <Tabs.Screen name="projects" options={{ title: "Loyihalar" }} />
      <Tabs.Screen name="marketplace" options={{ title: "Do‘kon" }} />
      <Tabs.Screen name="games" options={{ title: "O‘yinlar" }} />
      <Tabs.Screen name="profile" options={{ title: "Profil" }} />
    </Tabs>
  );
}

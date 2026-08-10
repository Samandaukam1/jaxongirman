import { Tabs } from "expo-router";

import { BottomNav } from "@/components/BottomNav";
import { colors } from "@/theme/tokens";

/**
 * The five places a person moves between. A tab navigator rather than stack
 * pushes, so the pill is mounted once and only the page under it swaps —
 * switching tabs animates nothing that should stay put.
 *
 * Order matters: it is the order the pill draws, left to right.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        animation: "none",
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

import { Platform, useWindowDimensions } from "react-native";

/**
 * How much room a browser window gives the app.
 *
 * - `desktop` — a laptop or a monitor: the side menu replaces the bottom bar
 *   and pages sit in a centred column.
 * - `tablet` — a narrow window or a tablet: the bottom bar stays, the page is
 *   kept to a readable width.
 * - `phone` — a phone's browser, or the app itself: the layout the app was
 *   drawn for, untouched.
 *
 * Native is always `phone`; a tablet build is still the phone layout.
 */
export type Room = "desktop" | "tablet" | "phone";

export const DESKTOP_MIN_WIDTH = 1024;
export const TABLET_MIN_WIDTH = 720;

export function useRoom(): Room {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web") return "phone";
  if (width >= DESKTOP_MIN_WIDTH) return "desktop";
  if (width >= TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

export function useDesktop(): boolean {
  return useRoom() === "desktop";
}

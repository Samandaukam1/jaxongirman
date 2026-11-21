import { useCameraPermissions } from "expo-camera";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState, Linking } from "react-native";

/**
 * The camera a QR scanner can count on, Android in particular.
 *
 * The plain permission hook leaves three things to the screen, and the
 * O‘yingoh scanners got all three wrong:
 *
 * - A refusal the phone remembers. After two "Deny"s on Android 11+, or one
 *   on iOS, asking again returns "denied" at once and shows nothing, so a
 *   "Ruxsat berish" button that only asks again does nothing at all. Then the
 *   way in is the phone's settings, and `ask` opens them (`blocked` says so).
 * - Coming back from those settings. Expo's hook reads the permission once,
 *   on mount, so a person who switched the camera on and came back still saw
 *   the refusal. It is read again whenever the app comes to the front, which
 *   also catches an Android "Only this time" grant that lapsed meanwhile.
 * - A screen that is not in front. Android binds the camera to the whole
 *   activity, not to the view (`active` is iOS-only), so a scanner under
 *   another screen kept the camera from everything else. `live` is true only
 *   while this screen is focused, and the scanner is mounted only then.
 */
export function useScannerCamera() {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const focused = useIsFocused();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") getPermission().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [getPermission]);

  const granted = permission?.granted === true;
  const blocked = permission !== null && !permission.granted && !permission.canAskAgain;

  const ask = useCallback(async () => {
    if (blocked) {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    await requestPermission().catch(() => undefined);
  }, [blocked, requestPermission]);

  return { granted, blocked, ask, live: granted && focused };
}

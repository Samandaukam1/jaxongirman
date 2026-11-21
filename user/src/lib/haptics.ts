import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * The chat's touch, in one vocabulary, so every screen answers a finger the
 * same way: a tick for choosing, a light tap for small things, a firmer one
 * for lifting a message, a double knock for done, a buzz for a warning.
 * Silent in a browser, where there is nothing to vibrate.
 */
const on = Platform.OS !== "web";

export const haptic = {
  /** Choosing among things: a reaction, a tab, a checkbox. */
  select: () => { if (on) void Haptics.selectionAsync(); },
  /** A small action: send, a menu row, a swipe that reached its mark. */
  light: () => { if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); },
  /** Lifting something: a long press, recording starting. */
  medium: () => { if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); },
  /** Something heavy landing: a lock, a big sticker arriving. */
  heavy: () => { if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); },
  /** Soft and round: a bubble settling, a pin. */
  soft: () => { if (on) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft); },
  success: () => { if (on) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
  warning: () => { if (on) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); },
  error: () => { if (on) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); },
};

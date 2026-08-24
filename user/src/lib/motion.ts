import { useEffect, useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import {
  useAnimatedStyle, useSharedValue, withSpring, withTiming, type WithSpringConfig,
} from "react-native-reanimated";

/**
 * The app's motion, in one place, so every screen moves the same way.
 *
 * Two settings and no more. A press is a spring, because a press is a physical
 * event and a person's thumb expects the surface to give and come back.
 * Everything else is a short ease, because a transition is not a physical event
 * and springing it makes the interface look nervous.
 *
 * Both are silent when the system asks for reduced motion — not shortened,
 * silent. Somebody who turns that on is often turning it on because motion
 * makes them ill, and a faster version of the thing that makes them ill is not
 * an accommodation.
 */

/** A press: fast, slightly overdamped, no visible wobble on release. */
export const PRESS_SPRING: WithSpringConfig = { damping: 18, stiffness: 340, mass: 0.5 };

/** How far a tappable gives under a thumb. Deliberately small. */
const PRESS_SCALE = 0.97;

/** And how far it dims, so the feedback survives a press that barely moves. */
const PRESS_DIM = 0.94;

/** Everything that is not a press. */
export const EASE = 200;

/**
 * Whether the system has asked for less movement.
 *
 * One query and one listener for the whole app, not one per component. A list
 * of twenty-six rows each asking the platform the same question, and each
 * registering its own listener for the answer, is a lot of bridge traffic for a
 * value that is the same for every one of them.
 *
 * It answers `false` until the platform says otherwise, and that default is the
 * important part: anything that fades in must be allowed to start fading in
 * immediately. A component that waits for this answer before revealing itself
 * is a component that stays invisible if the answer never arrives — with
 * nothing in the logs to say so.
 */
let reduced = false;
let asked = false;
const listeners = new Set<() => void>();

const announce = (next: boolean) => {
  if (next === reduced) return;
  reduced = next;
  for (const listener of listeners) listener();
};

function watchReduceMotion(listener: () => void): () => void {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    AccessibilityInfo.isReduceMotionEnabled().then(announce).catch(() => {});
    AccessibilityInfo.addEventListener("reduceMotionChanged", announce);
  }
  return () => { listeners.delete(listener); };
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(watchReduceMotion, () => reduced, () => false);
}

/**
 * Press feedback for anything tappable.
 *
 *     const press = usePressScale();
 *     <AnimatedPressable {...press.handlers} style={[styles.card, press.style]} />
 *
 * Spread onto the Pressable rather than built into a wrapper component, because
 * a wrapper adds a view to every row in every list and the feedback is worth
 * one shared value, not one extra node.
 */
export function usePressScale(enabled = true): {
  handlers: { onPressIn: () => void; onPressOut: () => void };
  style: { transform: { scale: number }[]; opacity: number };
} {
  const reduced = useReduceMotion();
  const press = useSharedValue(0);
  const active = enabled && !reduced;

  /**
   * The dim rides the same value as the give.
   *
   * It could have been Pressable's own `pressed` styling, but that means a
   * function-form `style`, and a function cannot be handed to an animated
   * component — Reanimated spreads the style to find animated entries in it,
   * and spreading a function yields nothing, so the whole style is silently
   * dropped. One shared value driving both is the version that cannot fail
   * that way.
   */
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * (1 - PRESS_SCALE) }],
    opacity: 1 - press.value * (1 - PRESS_DIM),
  }));

  return {
    handlers: {
      onPressIn: () => { if (active) press.value = withSpring(1, PRESS_SPRING); },
      onPressOut: () => { if (active) press.value = withSpring(0, PRESS_SPRING); },
    },
    // The cast keeps callers from having to know the style is animated: it is
    // an ordinary transform to everything that reads it.
    style: style as unknown as { transform: { scale: number }[]; opacity: number },
  };
}

/**
 * A value that eases to whatever it is set to, for things that change state
 * rather than things that are pressed — a tab becoming selected, a panel
 * opening, a badge switching colour.
 */
export function useEased(to: number, duration = EASE): { opacity: number } {
  const reduced = useReduceMotion();
  const progress = useSharedValue(to);

  useEffect(() => {
    progress.value = reduced ? to : withTiming(to, { duration });
  }, [duration, progress, reduced, to]);

  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return style as unknown as { opacity: number };
}

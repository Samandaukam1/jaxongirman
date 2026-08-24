import { useEffect, useState } from "react";
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

/** Everything that is not a press. */
export const EASE = 200;

/**
 * Whether the system has asked for less movement.
 *
 * Read once and then watched, because it is a switch a person flips in the
 * middle of using the app — usually the moment the app has annoyed them.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { alive = false; listener.remove(); };
  }, []);

  return reduced;
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
  style: { transform: { scale: number }[] };
} {
  const reduced = useReduceMotion();
  const scale = useSharedValue(1);
  const active = enabled && !reduced;

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  /* eslint-disable react-hooks/immutability -- these two run from a touch and
     never during render, which is the case the rule cannot see: a shared value
     written in an event handler is the documented way to drive a spring. */
  return {
    handlers: {
      onPressIn: () => { if (active) scale.value = withSpring(PRESS_SCALE, PRESS_SPRING); },
      onPressOut: () => { if (active) scale.value = withSpring(1, PRESS_SPRING); },
    },
    /* eslint-enable react-hooks/immutability */
    // The cast keeps callers from having to know the style is animated: it is
    // an ordinary transform to everything that reads it.
    style: style as unknown as { transform: { scale: number }[] },
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

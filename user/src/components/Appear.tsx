import { useEffect, type ReactNode } from "react";
import { AccessibilityInfo, type ViewStyle } from "react-native";
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from "react-native-reanimated";

/**
 * The small movement that makes a list feel like it arrived rather than blinked.
 *
 * A screen that swaps from a skeleton to eight rows in one frame reads as a
 * stutter, whatever the frame rate — nothing moved, so nothing was drawn, so it
 * looks like the app hitched. Six pixels of rise and a fade over two hundred
 * milliseconds is the whole effect, and it is enough.
 *
 * Three rules keep it from becoming the thing people wait through:
 *
 * **Short.** 220 ms, which is under the threshold where a transition starts
 * being a delay you notice.
 *
 * **Staggered, briefly.** Rows follow each other by 40 ms and the stagger stops
 * after the sixth: an eighth row waiting half a second to appear is a list that
 * loads slowly, however smooth each row was.
 *
 * **Off when asked.** A system set to reduce motion gets no movement at all,
 * not a shorter version of it.
 */

const DURATION = 220;
const STAGGER = 40;
const MAX_STAGGERED = 6;

export function Appear({
  children,
  index = 0,
  style,
}: {
  children: ReactNode;
  index?: number;
  style?: ViewStyle;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!alive) return;
      if (reduced) {
        progress.value = 1;
        return;
      }
      progress.value = withDelay(
        Math.min(index, MAX_STAGGERED) * STAGGER,
        withTiming(1, { duration: DURATION, easing: Easing.out(Easing.cubic) }),
      );
    });
    return () => { alive = false; };
  }, [index, progress]);

  const animation = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));

  return <Animated.View style={[style, animation]}>{children}</Animated.View>;
}

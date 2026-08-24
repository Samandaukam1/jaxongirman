import { Pressable, type PressableProps, type PressableStateCallbackType, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { usePressScale } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that gives under a thumb.
 *
 * The spring lives on one shared value per instance, which is why this is a
 * component and not a hook a screen calls once: three cards in a row rendered
 * from one `map` would otherwise share a single value and press together.
 *
 * `style` takes the same shapes `Pressable` does — an object, an array, or a
 * function of the press state — and the spring is appended to whatever comes
 * back, so a caller keeps its own pressed styling if it wants one.
 */
export function Touchable({
  style,
  children,
  disabled,
  ...props
}: PressableProps & { style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>) }) {
  const press = usePressScale(!disabled);

  return (
    <AnimatedPressable
      disabled={disabled}
      {...press.handlers}
      style={(state: PressableStateCallbackType) => [
        typeof style === "function" ? style(state) : style,
        press.style,
      ]}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}

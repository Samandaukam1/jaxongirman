import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
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
 * `style` is an object or an array and **never a function**. Pressable accepts
 * a function so a caller can style the pressed state, but an animated component
 * cannot: Reanimated spreads each style entry looking for animated ones, and
 * spreading a function yields nothing at all, so the caller's style disappears
 * without an error anywhere. The press state is the spring's job here, which
 * removes the reason to reach for the function form.
 */
export function Touchable({
  style,
  children,
  disabled,
  ...props
}: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle> }) {
  const press = usePressScale(!disabled);

  return (
    <AnimatedPressable disabled={disabled} {...press.handlers} style={[style, press.style]} {...props}>
      {children}
    </AnimatedPressable>
  );
}

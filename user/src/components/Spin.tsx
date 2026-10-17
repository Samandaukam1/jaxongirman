import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

/**
 * Turns what it holds, one turn every 0.9 s, on the native driver — so it keeps
 * turning while the JS thread is busy, which is exactly when a loader is being
 * looked at. It turns under Reduce Motion too, as the system's own spinner
 * does: it says work is happening, it is not decoration.
 */
export function Spin({ children }: { children: ReactNode }) {
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{children}</Animated.View>;
}

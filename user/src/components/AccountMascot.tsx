import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { MascotCanvas } from "@/components/mascot/MascotCanvas";
import { useReduceMotion } from "@/lib/motion";

/**
 * Jaxongirman on the account card: a rigged 3D character rendered live.
 *
 * He waves once when the tab comes into view and then settles into the idle
 * breathing loop. The surface stops rendering when the screen is not on show,
 * and stops moving entirely when the system asks for reduced motion — the
 * model is still there, just held on a still frame.
 */
export function AccountMascot({ style }: { style?: StyleProp<ViewStyle> }) {
  const reduced = useReduceMotion();
  const [focused, setFocused] = useState(false);
  const [greetToken, setGreetToken] = useState(0);
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    setGreetToken((token) => token + 1);
    return () => setFocused(false);
  }, []));

  if (failed) return <View style={style} />;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, style]}
    >
      <MascotCanvas
        style={StyleSheet.absoluteFill}
        paused={!focused}
        greetToken={greetToken}
        onFailed={() => setFailed(true)}
        options={{
          reducedMotion: reduced,
          bodyTurn: -0.22,
          // Framed from mid-thigh up: at card size the head and the waving
          // hand are what has to read, and boots would only shrink them.
          framing: { bottom: 0.62, top: 2.12, width: 1.05 },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
});

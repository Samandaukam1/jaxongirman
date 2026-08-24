import { useState } from "react";
import { Image, Text, View, type ViewStyle } from "react-native";

import { brandInk, gradients } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  uri?: string | null;
  initials: string;
  size?: number;
  style?: ViewStyle;
  /** A ring reads as "this is you" in the header without a second label. */
  ring?: boolean;
};

/**
 * A person's picture, or their initials on the brand gradient.
 *
 * The fallback is deliberately typographic rather than a generated face: an
 * invented portrait would be indistinguishable from a real one, and nobody
 * should have to wonder whether the person they are sending coins to looks like
 * that.
 */
export function Avatar({ uri, initials, size = 48, style, ring = false }: Props) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius: size / 2 };
  const showImage = Boolean(uri) && !failed;

  /**
   * The picture fills what the border leaves, rather than repeating the frame.
   *
   * A border is drawn inside the box, so a bordered 28-point avatar has a
   * 25-point content area — and a child asked for the full 28 starts at the
   * content box's corner and hangs a border's width past the ring on two sides.
   * At 1.5 points that is not a layout you notice reading the code; on the tab
   * bar it is a photograph sitting visibly askew inside its own circle.
   */
  return (
    <View style={[frame, styles.clip, ring && styles.ring, style]}>
      {showImage ? (
        <Image
          source={{ uri: uri as string }}
          style={[styles.fill, styles.image]}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.fill, styles.center]}>
          <Text style={[styles.initials, { fontSize: Math.round(size * 0.36) }]} numberOfLines={1}>
            {initials}
          </Text>
        </LinearGradient>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { alignItems: "center", justifyContent: "center" },
  fill: { width: "100%", height: "100%" },
  // The round crop comes from the parent, so it follows whatever border the
  // caller puts on it instead of needing its own matching radius.
  clip: { overflow: "hidden" },
  image: { backgroundColor: colors.surfaceMuted },
  ring: { borderWidth: 2, borderColor: colors.primarySoft },
  initials: { fontFamily: "Manrope_700Bold", color: brandInk.strong, letterSpacing: 0.4 },
}));

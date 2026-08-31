import { drawQr } from "@jaxongirman/qr-video";
import { useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { radius } from "@/theme/tokens";

/**
 * A scannable code, drawn rather than fetched.
 *
 * The same `drawQr` the projector and the console use, so a code produced on a
 * phone and a code produced on a big screen are the same symbol at the same
 * error correction — one place to be right about, and no image request in the
 * way of showing somebody a code they are holding out to a friend.
 *
 * Black on white and nothing else. A tinted or rounded code photographs well
 * and scans badly, and this one is read across a table in whatever light the
 * room has.
 */
export function QrCode({ value, size = 220, style }: { value: string; size?: number; style?: ViewStyle }) {
  const drawing = useMemo(() => drawQr(value), [value]);

  return (
    <View style={[{ width: size, height: size, borderRadius: radius.md, overflow: "hidden" }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${drawing.extent} ${drawing.extent}`}>
        {/* The quiet zone is part of the symbol: a scanner finds the edges by it. */}
        <Rect x={0} y={0} width={drawing.extent} height={drawing.extent} fill="#FFFFFF" />
        <Path d={drawing.path} fill="#000000" />
      </Svg>
    </View>
  );
}

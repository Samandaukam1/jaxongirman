import { gameAvatarArt, type GameAvatarShape } from "@jaxongirman/types";
import { memo } from "react";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

function paint(shape: GameAvatarShape) {
  return {
    fill: shape.fill ?? "none",
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    opacity: shape.opacity,
    clipPath: shape.clip ? `url(#${shape.clip})` : undefined,
  };
}

/**
 * One of the forty characters, drawn from the shared portrait data so the
 * phone and the projector show the identical person. Memoised: lobbies render
 * forty of these in a grid and again for every joined player.
 */
export const GameAvatar = memo(function GameAvatar({ id, size = 56 }: { id: number; size?: number }) {
  const art = gameAvatarArt(id);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {art.defs.map((def) => {
          if (def.kind === "clip") return <ClipPath key={def.id} id={def.id}><Path d={def.d} /></ClipPath>;
          const stops = def.stops.map((stop, at) => <Stop key={at} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity ?? 1} />);
          return def.kind === "linear"
            ? <LinearGradient key={def.id} id={def.id} gradientUnits="userSpaceOnUse" x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>{stops}</LinearGradient>
            : <RadialGradient key={def.id} id={def.id} gradientUnits="userSpaceOnUse" cx={def.cx} cy={def.cy} r={def.r} fx={def.fx ?? def.cx} fy={def.fy ?? def.cy}>{stops}</RadialGradient>;
        })}
      </Defs>
      <G clipPath={`url(#${art.frame})`}>
        {art.shapes.map((shape, index) => {
          switch (shape.kind) {
            case "circle": return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint(shape)} />;
            case "ellipse": return <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paint(shape)} />;
            case "rect": return <Rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...paint(shape)} />;
            case "path": return <Path key={index} d={shape.d} {...paint(shape)} />;
          }
        })}
      </G>
    </Svg>
  );
});

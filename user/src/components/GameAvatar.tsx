import { gameAvatarShapes } from "@jaxongirman/types";
import { memo } from "react";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

/**
 * One of the forty faces, drawn from the shared shape data so the phone and
 * the projector show the identical character. Memoised: lobbies render forty
 * of these in a grid and again for every joined player.
 */
export const GameAvatar = memo(function GameAvatar({ id, size = 56 }: { id: number; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {gameAvatarShapes(id).map((shape, index) => {
        switch (shape.kind) {
          case "circle":
            return <Circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
          case "ellipse":
            return <Ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.fill} />;
          case "rect":
            return <Rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} fill={shape.fill} />;
          case "path":
            return (
              <Path
                key={index}
                d={shape.d}
                fill={shape.fill ?? "none"}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                strokeLinecap="round"
              />
            );
        }
      })}
    </Svg>
  );
});

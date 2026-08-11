import { gameAvatarShapes } from "@jaxongirman/types";

/**
 * The same forty faces the app draws, from the same shape data. A player sees
 * their own character on their phone and again on the projector — identical,
 * because neither renderer decides anything.
 */
export function GameAvatar({ id, size = 56 }: { id: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      {gameAvatarShapes(id).map((shape, index) => {
        switch (shape.kind) {
          case "circle":
            return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
          case "ellipse":
            return <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={shape.fill} />;
          case "rect":
            return <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} fill={shape.fill} />;
          case "path":
            return (
              <path
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
    </svg>
  );
}

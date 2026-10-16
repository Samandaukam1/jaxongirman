import { gameAvatarArt, type GameAvatarShape } from "@jaxongirman/types";

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
 * The same forty characters the app draws, from the same portrait data. A
 * player sees their own character on their phone and again on the projector —
 * identical, because neither renderer decides anything. Every def id carries
 * the character's number, so a lobby of forty on one page never mixes them up.
 */
export function GameAvatar({ id, size = 56 }: { id: number; size?: number }) {
  const art = gameAvatarArt(id);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        {art.defs.map((def) => {
          if (def.kind === "clip") return <clipPath key={def.id} id={def.id}><path d={def.d} /></clipPath>;
          const stops = def.stops.map((stop, at) => <stop key={at} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity ?? 1} />);
          return def.kind === "linear"
            ? <linearGradient key={def.id} id={def.id} gradientUnits="userSpaceOnUse" x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>{stops}</linearGradient>
            : <radialGradient key={def.id} id={def.id} gradientUnits="userSpaceOnUse" cx={def.cx} cy={def.cy} r={def.r} fx={def.fx ?? def.cx} fy={def.fy ?? def.cy}>{stops}</radialGradient>;
        })}
      </defs>
      <g clipPath={`url(#${art.frame})`}>
        {art.shapes.map((shape, index) => {
          switch (shape.kind) {
            case "circle": return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint(shape)} />;
            case "ellipse": return <ellipse key={index} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paint(shape)} />;
            case "rect": return <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} {...paint(shape)} />;
            case "path": return <path key={index} d={shape.d} {...paint(shape)} />;
          }
        })}
      </g>
    </svg>
  );
}

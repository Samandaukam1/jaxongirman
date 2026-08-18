import { renderElement, type JElement, type JElementFamily } from "@jaxongirman/jelement";
import { useMemo } from "react";

/**
 * An element, actually drawn.
 *
 * The same `renderElement` the server uses, so what an admin sees here is what
 * a slide gets — not an approximation of it. That matters more than it sounds:
 * the whole point of storing geometry rather than prose is that one drawing is
 * the drawing, and a preview computed some other way would quietly become a
 * second opinion.
 *
 * A component with an outline is drawn as SVG, the rest as positioned boxes.
 * Both, because both are real: a cabin panel is a rectangle and saying so costs
 * one div, while a truck's silhouette is a path and drawing it as a rectangle
 * is what made every element in the library look like the same stack of
 * blocks.
 */
export function JElementPreview({
  element,
  family,
  size = 160,
  rotation = 0,
  background = "light",
  overrides = {},
}: {
  element: JElement;
  family: JElementFamily;
  size?: number;
  rotation?: number;
  background?: "light" | "dark";
  overrides?: Record<string, string>;
}) {
  const shapes = useMemo(
    () => renderElement(element, family, { x: 0, y: 0, width: size, height: size, rotation }, overrides as never),
    [element, family, size, rotation, overrides],
  );

  return (
    <div
      className="jelement-preview"
      style={{
        width: size,
        height: size,
        background: background === "dark" ? "#14121A" : "#FFFFFF",
      }}
    >
      {shapes.map((shape, index) => {
        const frame = {
          position: "absolute" as const,
          left: shape.x,
          top: shape.y,
          width: shape.width,
          height: shape.height,
          transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
          opacity: shape.opacity,
          zIndex: shape.zIndex,
        };

        const outline = shape.style.path as string | undefined;
        if (outline) {
          return (
            <svg
              key={`${shape.zIndex}-${index}`}
              style={frame}
              viewBox={shape.style.viewBox as string}
              // The path is authored inside its own box, so it stretches with
              // that box rather than keeping a ratio the author never stated.
              preserveAspectRatio="none"
            >
              <path
                d={outline}
                fill={(shape.style.fill as string) ?? "none"}
                stroke={shape.style.borderColor as string | undefined}
                strokeWidth={shape.style.borderColor ? Number(shape.style.borderWidth ?? 1) : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          );
        }

        return (
          <div
            key={`${shape.zIndex}-${index}`}
            style={{
              ...frame,
              background: shape.style.fill as string | undefined,
              borderRadius: shape.style.borderRadius as number | undefined,
              border: shape.style.borderColor
                ? `${shape.style.borderWidth ?? 1}px solid ${shape.style.borderColor}`
                : undefined,
            }}
          />
        );
      })}
      {shapes.length === 0 ? (
        // An element with no geometry ships as an asset. Saying so beats an
        // empty square that reads as a broken preview.
        <span className="jelement-preview-empty">Geometriya yo‘q</span>
      ) : null}
    </div>
  );
}

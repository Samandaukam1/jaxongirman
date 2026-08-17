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
 * Rendered as positioned boxes rather than SVG paths because that is what the
 * element model is: filled, rounded, rotatable rectangles. Anything needing a
 * true path ships as an asset, and this draws that instead.
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
      {shapes.map((shape, index) => (
        <div
          key={`${shape.zIndex}-${index}`}
          style={{
            position: "absolute",
            left: shape.x,
            top: shape.y,
            width: shape.width,
            height: shape.height,
            transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
            opacity: shape.opacity,
            zIndex: shape.zIndex,
            background: shape.style.backgroundColor as string | undefined,
            borderRadius: shape.style.borderRadius as number | undefined,
            border: shape.style.borderColor
              ? `${shape.style.borderWidth ?? 1}px solid ${shape.style.borderColor}`
              : undefined,
          }}
        />
      ))}
      {shapes.length === 0 ? (
        // An element with no geometry ships as an asset. Saying so beats an
        // empty square that reads as a broken preview.
        <span className="jelement-preview-empty">Geometriya yo‘q</span>
      ) : null}
    </div>
  );
}

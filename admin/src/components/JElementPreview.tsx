import { renderElement, type JElement, type JElementFamily } from "@jaxongirman/jelement";
import { useMemo } from "react";

import { assetUrl, hueOf } from "@/lib/jelement";

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

  /**
   * The colour the palette asks for, live, without waiting for a file.
   *
   * A picture element recolours by serving a different file, and those files
   * are made when the sheet is cut — so before this existed, dragging the
   * accent to magenta changed five swatches and nothing else, because no
   * magenta file had ever been rendered. Two colours appeared to work and the
   * rest appeared broken.
   *
   * `assetFor` has already picked the nearest file it has; whatever gap is
   * left is closed here with a hue rotation. It is a rotation of the whole
   * image rather than of the accent alone, which for these renders is very
   * nearly the same thing — graphite, black and white have no hue to rotate,
   * so only the accent moves. Nearly, not exactly: a gold rim would follow
   * along. That is why this is the preview and the rendered file is the deck.
   */
  const rotation360 = useMemo(() => {
    if (!element.assetPath || typeof element.assetAccentHue !== "number") return 0;
    const wanted = hueOf(overrides.accent ?? family.colorTokens.accent ?? "");
    if (wanted === null) return 0;

    // Which file `assetFor` settled on, and therefore what it is already
    // showing. Applying the whole difference would double-count a variant.
    let showing = element.assetAccentHue;
    let best = 20;
    for (const hue of Object.keys(element.assetVariants ?? {})) {
      const gap = Math.abs(((wanted - Number(hue) + 540) % 360) - 180);
      if (gap <= best) { best = gap; showing = Number(hue); }
    }
    const own = Math.abs(((wanted - element.assetAccentHue + 540) % 360) - 180);
    if (own <= 20) showing = element.assetAccentHue;

    return ((wanted - showing + 540) % 360) - 180;
  }, [element, family, overrides]);

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

        if (shape.type === "image") {
          // The render itself. Contained rather than stretched: the crop is
          // already tight to the object, so a ratio the box does not share
          // means the box is wrong and squashing it would hide that.
          const source = assetUrl(shape.content.assetPath as string | undefined);
          return source ? (
            <img
              key={`${shape.zIndex}-${index}`}
              src={source}
              alt=""
              style={{
                ...frame,
                objectFit: "contain",
                ...(Math.abs(rotation360) > 1 ? { filter: `hue-rotate(${rotation360}deg)` } : {}),
              }}
            />
          ) : null;
        }

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

import QRCode from "qrcode";

/**
 * The QR Video Experience, in the two places it has to agree with itself.
 *
 * The site paints the real thing on a projector; the console paints a preview
 * an admin drags a code around in. If those two ever disagree — about where a
 * percentage lands, about how wide the quiet zone is — the preview stops being
 * a preview and becomes a guess, and the only way to see the truth is to walk
 * into a lecture hall. So the geometry and the symbol live here, once, and both
 * surfaces import them.
 */

export const QR_VIDEO_BUCKET = "qr-video";

export type QrVideoSurface = "taqdimot" | "oyingoh";

export const SURFACE_LABELS: Record<QrVideoSurface, string> = {
  taqdimot: "Taqdimot qilish",
  oyingoh: "O‘yingohni ochish",
};

/** What the reference design specifies, and what "reset" goes back to. */
export const REFERENCE = {
  appearMs: 5060,
  x: 46.8,
  y: 66,
  size: 18.3,
  gradientFrom: "#A855F7",
  gradientVia: "#7C3AED",
  gradientTo: "#4F46E5",
  background: "#FFFFFF",
  glow: 0.35,
} as const;

/** The settings that decide where and how the code is drawn. */
export type QrPlacement = {
  x: number;
  y: number;
  size: number;
};

export type Box = { width: number; height: number };

export type QrRect = { left: number; top: number; side: number };

/**
 * Where the code goes, in pixels, given percentages of the *video's* frame.
 *
 * `object-fit: cover` crops: on a 16:9 clip in a taller window, a band of the
 * footage is off screen at the sides, and a percentage of the *element* would
 * land somewhere the designer never looked. This repeats the cover arithmetic,
 * so the code sits on the same square of footage in every window shape — which
 * is what a reference coordinate is for.
 *
 * X and Y are the code's top-left corner and the size is its width; the code is
 * square, so that is all it takes.
 */
export function placeQr(placement: QrPlacement, frame: Box, stage: Box): QrRect | null {
  if (!frame.width || !frame.height || !stage.width || !stage.height) return null;
  const scale = Math.max(stage.width / frame.width, stage.height / frame.height);
  const drawnWidth = frame.width * scale;
  const drawnHeight = frame.height * scale;
  const offsetX = (stage.width - drawnWidth) / 2;
  const offsetY = (stage.height - drawnHeight) / 2;
  return {
    left: offsetX + (placement.x / 100) * drawnWidth,
    top: offsetY + (placement.y / 100) * drawnHeight,
    side: (placement.size / 100) * drawnWidth,
  };
}

/* ------------------------------------------------------------- the symbol */

export type QrDrawing = {
  /** Module count per side, before the quiet zone. */
  modules: number;
  /** Side of the SVG's coordinate space, quiet zone included. */
  extent: number;
  /** Every dark module as one path, so the gradient paints them all at once. */
  path: string;
};

/**
 * The quiet zone the specification asks for. Four modules is not decoration —
 * a scanner uses the clear margin to find the symbol's edges, and a code laid
 * over moving footage has no other border to rely on.
 */
export const QUIET_ZONE = 4;

/**
 * Builds the real symbol for a value.
 *
 * `M` correction is what the rest of the site pairs at, and it is what these
 * codes are read at: a phone half a room from a projector, holding the frame
 * for a second. The modules stay square and fully filled — rounded or gapped
 * modules photograph well and scan badly, and this code has to work.
 */
export function drawQr(value: string): QrDrawing {
  const symbol = QRCode.create(value, { errorCorrectionLevel: "M" });
  const modules = symbol.modules.size;
  const parts: string[] = [];

  for (let row = 0; row < modules; row += 1) {
    let run = 0;
    for (let column = 0; column <= modules; column += 1) {
      const dark = column < modules && symbol.modules.get(row, column) === 1;
      if (dark) {
        run += 1;
        continue;
      }
      // Runs of neighbouring modules are merged into one rectangle: the same
      // shape with a fraction of the path data, and without the hairline seams
      // antialiasing leaves between separately drawn squares.
      if (run > 0) {
        parts.push(`M${column - run + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`);
        run = 0;
      }
    }
  }

  return { modules, extent: modules + QUIET_ZONE * 2, path: parts.join("") };
}

/**
 * The drop-shadow that gives the code its glow.
 *
 * Deliberately restrained: a halo wide enough to be obvious is also wide enough
 * to wash out the quiet zone, and a code that photographs beautifully and does
 * not scan is worse than no code at all. Returns nothing at zero, so "no glow"
 * costs no filter and no compositing layer.
 */
export function glowFilter(glow: number, color = "124, 58, 237"): string | undefined {
  if (glow <= 0) return undefined;
  const blur = glow * 26;
  const alpha = Math.min(0.6, glow * 0.5);
  return `drop-shadow(0 0 ${blur}px rgba(${color}, ${alpha}))`;
}

/**
 * Cutting a reference sheet apart, and changing what colour it is.
 *
 * The library's elements are rendered CGI: a transparent PNG of a black-and-
 * lime book, a bust, a fountain pen. Nothing here redraws them — redrawing was
 * the previous attempt and it produced twelve piles of rectangles. These
 * functions move pixels and nothing else, so what comes out is what the render
 * engine put in.
 *
 * Two jobs. Splitting one sheet into twelve objects, and shifting the accent
 * colour so the same object can be lime on one deck and amber on the next.
 *
 * Deliberately free of canvas, DOM and any image library: everything takes and
 * returns plain RGBA bytes. That is what lets the rules below be tested on a
 * developer machine, and it is also why the same code can run in the admin's
 * browser today and on a server later without being rewritten.
 */

export type Pixels = {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
};

export type Rect = { x: number; y: number; width: number; height: number };

/* ------------------------------------------------------------- colour */

/** 0–360, 0–1, 0–1. */
export function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255, g = green / 255, b = blue / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const span = max - min;
  const saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min);

  let hue: number;
  if (max === r) hue = ((g - b) / span + (g < b ? 6 : 0)) * 60;
  else if (max === g) hue = ((b - r) / span + 2) * 60;
  else hue = ((r - g) / span + 4) * 60;

  return [hue, saturation, lightness];
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 360) + 360) % 360 / 360;
  if (saturation === 0) {
    const value = Math.round(lightness * 255);
    return [value, value, value];
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  const channel = (t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };

  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ];
}

/** The shortest way round the wheel, signed. */
function hueDistance(first: number, second: number): number {
  const raw = ((second - first + 540) % 360) - 180;
  return raw;
}

export function hexToHsl(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return rgbToHsl((value >> 16) & 255, (value >> 8) & 255, value & 255);
}

/**
 * The accent, found rather than declared.
 *
 * These assets are one dark structural mass and one loud colour, so the accent
 * is whichever hue the saturated pixels agree on. Greys, blacks and the
 * near-white of a page are ignored: they carry no hue worth counting and there
 * are far more of them, so including them would return "grey" every time.
 *
 * Counted in ten-degree buckets. Finer would split one ribbon across two
 * buckets over a gradient; coarser would merge lime into yellow.
 */
export function dominantHue(pixels: Pixels, options: { minSaturation?: number; minAlpha?: number } = {}): number | null {
  const minSaturation = options.minSaturation ?? 0.35;
  const minAlpha = options.minAlpha ?? 128;
  const buckets = new Array<number>(36).fill(0);

  for (let index = 0; index < pixels.data.length; index += 4) {
    if (pixels.data[index + 3]! < minAlpha) continue;
    const [hue, saturation, lightness] = rgbToHsl(pixels.data[index]!, pixels.data[index + 1]!, pixels.data[index + 2]!);
    // Very dark and very light pixels have unstable hue — a black panel with a
    // faint green bounce is not the accent.
    if (saturation < minSaturation || lightness < 0.12 || lightness > 0.94) continue;
    buckets[Math.floor(hue / 10) % 36]! += 1;
  }

  let best = -1;
  let bestCount = 0;
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    if (buckets[bucket]! > bestCount) { bestCount = buckets[bucket]!; best = bucket; }
  }
  if (best < 0 || bestCount === 0) return null;

  // The bucket's own centre, nudged by its neighbours so a hue sitting on a
  // boundary does not snap to the middle of the wrong ten degrees.
  const before = buckets[(best + 35) % 36]!;
  const after = buckets[(best + 1) % 36]!;
  const total = before + bestCount + after;
  const offset = total === 0 ? 0 : ((after - before) / total) * 10;
  return (best * 10 + 5 + offset + 360) % 360;
}

export type RecolourOptions = {
  /** How far from the source hue still counts as the accent. */
  tolerance?: number;
  /** Below this, a pixel is structure rather than colour, and is left alone. */
  minSaturation?: number;
  /** Multiplies the target's saturation, for an accent that should read softer. */
  saturationScale?: number;
};

/**
 * Moves one hue to another and leaves everything else exactly as it was.
 *
 * The point is what it does *not* touch. A graphite body, a cream page, a gold
 * rim and a black mask all stay themselves; only the pixels that were part of
 * the lime ribbon become amber. Shading survives because lightness is never
 * touched — a highlight on the ribbon is still a highlight, in the new colour.
 *
 * Pixels near the edge of the tolerance are moved proportionally rather than
 * all at once. Without that, antialiased edges keep their old hue and the
 * recoloured object gets a one-pixel green halo, which is exactly the kind of
 * thing nobody notices until it is on a projector.
 */
export function recolour(pixels: Pixels, fromHue: number, toHue: number, options: RecolourOptions = {}): Pixels {
  const tolerance = options.tolerance ?? 45;
  const minSaturation = options.minSaturation ?? 0.18;
  const saturationScale = options.saturationScale ?? 1;
  const data = new Uint8ClampedArray(pixels.data);

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3]! === 0) continue;

    const [hue, saturation, lightness] = rgbToHsl(data[index]!, data[index + 1]!, data[index + 2]!);
    if (saturation < minSaturation) continue;

    const distance = Math.abs(hueDistance(fromHue, hue));
    if (distance > tolerance) continue;

    // 1 at the centre of the accent, falling to 0 at the edge of tolerance.
    const strength = 1 - distance / tolerance;
    const shifted = hue + hueDistance(hue, toHue) * strength;
    const nextSaturation = Math.min(1, saturation * (1 + (saturationScale - 1) * strength));

    const [red, green, blue] = hslToRgb(shifted, nextSaturation, lightness);
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
  }

  return { width: pixels.width, height: pixels.height, data };
}

/* -------------------------------------------------------------- slicing */

/**
 * The cells of a sheet laid out as a grid.
 *
 * A generated reference sheet is a regular grid — four across, three down —
 * so the columns and rows are the input rather than something to infer. What
 * is inferred is where the object actually sits inside its cell, which is
 * `trim`'s job.
 */
export function gridCells(width: number, height: number, columns: number, rows: number): Rect[] {
  if (columns < 1 || rows < 1) return [];
  const cells: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: Math.round((column * width) / columns),
        y: Math.round((row * height) / rows),
        width: Math.round(((column + 1) * width) / columns) - Math.round((column * width) / columns),
        height: Math.round(((row + 1) * height) / rows) - Math.round((row * height) / rows),
      });
    }
  }
  return cells;
}

/**
 * The object inside a cell, without the empty space around it.
 *
 * Everything downstream treats an element's image as filling its box, so a
 * pen with forty per cent transparent margin would be drawn forty per cent too
 * small and land off-centre next to a book that had none. Trimming is what
 * makes twelve separately generated objects sit consistently on a slide.
 *
 * A little padding is kept, because a render's soft shadow and glow are part
 * of the object and cropping to the last opaque pixel cuts them off.
 */
export function trim(
  pixels: Pixels,
  region: Rect,
  options: { threshold?: number; padding?: number } = {},
): Rect | null {
  const threshold = options.threshold ?? 8;
  const padding = options.padding ?? 2;

  let left = region.x + region.width;
  let right = region.x - 1;
  let top = region.y + region.height;
  let bottom = region.y - 1;

  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const alpha = pixels.data[(y * pixels.width + x) * 4 + 3] ?? 0;
      if (alpha <= threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return null;

  const x = Math.max(region.x, left - padding);
  const y = Math.max(region.y, top - padding);
  return {
    x,
    y,
    width: Math.min(region.x + region.width, right + 1 + padding) - x,
    height: Math.min(region.y + region.height, bottom + 1 + padding) - y,
  };
}

/** Copies a rectangle out of a larger image. */
export function crop(pixels: Pixels, region: Rect): Pixels {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y += 1) {
    const from = ((region.y + y) * pixels.width + region.x) * 4;
    data.set(pixels.data.subarray(from, from + region.width * 4), y * region.width * 4);
  }
  return { width: region.width, height: region.height, data };
}

/**
 * A sheet, cut into the objects on it.
 *
 * Returns one entry per cell in reading order — left to right, top to bottom —
 * which is the order the analyzer prompt already asks for, so the nth image
 * belongs to the nth element without anybody matching them up by eye.
 *
 * An empty cell yields null rather than a blank image. A sheet of eleven
 * objects in a twelve-cell grid should produce eleven elements and one gap,
 * not a transparent square somebody has to notice and delete.
 */
export function sliceSheet(
  pixels: Pixels,
  columns: number,
  rows: number,
  options: { threshold?: number; padding?: number } = {},
): (Pixels | null)[] {
  return gridCells(pixels.width, pixels.height, columns, rows).map((cell) => {
    const bounds = trim(pixels, cell, options);
    return bounds ? crop(pixels, bounds) : null;
  });
}

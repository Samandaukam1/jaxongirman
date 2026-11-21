/**
 * Reading a filled-in answer sheet from a photograph.
 *
 * Dependency-free, so it runs the same in the edge function, in the tests and
 * on the phone, which reads camera frames with it live: the app keeps a copy
 * in `user/src/lib/omr/` (only the `.ts` on the import below differs, which
 * Deno needs and the app's TypeScript refuses), and
 * `user/tests/omr-live.test.mjs` fails when the two drift apart.
 * The photograph arrives as luminance; the sheet's own layout says where
 * everything is (`test-sheet.ts`). The steps:
 *
 * 1. Dark pixels, against their neighbourhood rather than one global level, so
 *    a shadow across the sheet does not swallow half of it.
 * 2. Solid, square blobs: the corner squares are found by shape — filled,
 *    convex and rectangular — which a filled bubble (a circle), a letter or a
 *    scribble is not.
 * 3. Which four are the corners, and which way is up: each plausible quad, at
 *    each of its four turns, is tried until one has the orientation square
 *    where it belongs and a code strip whose checksum holds. A dark object in
 *    the background can be a candidate; it never passes that check.
 * 4. The perspective, then the two edge squares halfway down, which split it
 *    into an upper and a lower half so a fold across the middle is followed.
 * 5. Each bubble's darkness against the paper around it, and one threshold for
 *    the whole sheet from how those darknesses fall (Otsu) — so a light pencil
 *    on one sheet and a heavy pen on another are both read.
 *
 * Every answer comes back with whether it was clear: two bubbles filled, or a
 * mark near the threshold, is flagged for the person checking rather than
 * guessed.
 */
import {
  decodeSheetCode, sheetLayout, type SheetCode, type SheetLayout, type SheetPoint,
} from "./test-sheet.ts";

export type GrayImage = { width: number; height: number; data: Uint8Array };
export type Point = { x: number; y: number };

export type ScanFlag = "multiple" | "uncertain" | null;

export type ScanRead = {
  ok: true;
  answers: (number | null)[];
  flags: ScanFlag[];
  /** Per question, per option, 0 (paper) to 1 (black). */
  darkness: number[][];
  threshold: number;
  /** Where things were found, in the image's pixels: for drawing over the photo. */
  image: { width: number; height: number };
  corners: Point[];
  bubbles: { x: number; y: number; r: number }[][];
};

export type ScanFailure = {
  ok: false;
  code: "no_markers" | "not_a_sheet" | "other_test";
  /** What the strip said, when it was one of our sheets but not this one. */
  read?: SheetCode;
};

export type ScanResult = ScanRead | ScanFailure;

// ------------------------------------------------------------------ images --

/** Luminance from RGBA (or RGB with `channels` 3). */
export function toGray(pixels: ArrayLike<number>, width: number, height: number, channels = 4): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 1, p += channels) {
    data[i] = (pixels[p]! * 77 + pixels[p + 1]! * 150 + pixels[p + 2]! * 29) >> 8;
  }
  return { width, height, data };
}

/** No side longer than `max`, by averaging boxes of pixels. */
export function shrink(image: GrayImage, max: number): GrayImage {
  const scale = Math.max(image.width, image.height) / max;
  if (scale <= 1) return image;
  const width = Math.round(image.width / scale);
  const height = Math.round(image.height / scale);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scale);
    const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        const row = yy * image.width;
        for (let xx = x0; xx < x1; xx += 1) sum += image.data[row + xx]!;
      }
      data[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, data };
}

function sample(image: GrayImage, x: number, y: number): number {
  const fx = Math.min(Math.max(x, 0), image.width - 1.001);
  const fy = Math.min(Math.max(y, 0), image.height - 1.001);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const dx = fx - x0;
  const dy = fy - y0;
  const i = y0 * image.width + x0;
  const d = image.data;
  return (d[i]! * (1 - dx) + d[i + 1]! * dx) * (1 - dy) + (d[i + image.width]! * (1 - dx) + d[i + image.width + 1]! * dx) * dy;
}

/** Dark against the neighbourhood: a box mean `window` wide, through an integral image. */
function darkMask(image: GrayImage): Uint8Array {
  const { width: W, height: H, data } = image;
  const integral = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y += 1) {
    let row = 0;
    for (let x = 0; x < W; x += 1) {
      row += data[y * W + x]!;
      integral[(y + 1) * (W + 1) + x + 1] = integral[y * (W + 1) + x + 1]! + row;
    }
  }
  const half = Math.max(8, Math.round(Math.min(W, H) / 14));
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(H, y + half + 1);
    for (let x = 0; x < W; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(W, x + half + 1);
      const sum = integral[y1 * (W + 1) + x1]! - integral[y0 * (W + 1) + x1]! - integral[y1 * (W + 1) + x0]! + integral[y0 * (W + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      mask[y * W + x] = data[y * W + x]! < mean * 0.72 && data[y * W + x]! < 170 ? 1 : 0;
    }
  }
  return mask;
}

// -------------------------------------------------------------- the blobs --

type Blob = { area: number; x: number; y: number; minX: number; maxX: number; minY: number; maxY: number; label: number };

/** Connected dark regions, four-way, through a union-find labelling. */
function blobs(mask: Uint8Array, W: number, H: number): { list: Blob[]; labels: Int32Array } {
  const labels = new Int32Array(W * H);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const up = y > 0 ? labels[i - W]! : 0;
      const left = x > 0 ? labels[i - 1]! : 0;
      if (!up && !left) {
        parent.push(parent.length);
        labels[i] = parent.length - 1;
      } else if (up && left) {
        const a = find(up);
        const b = find(left);
        labels[i] = Math.min(a, b);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else {
        labels[i] = up || left;
      }
    }
  }
  const byRoot = new Map<number, Blob>();
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!labels[i]) continue;
      const root = find(labels[i]!);
      labels[i] = root;
      const blob = byRoot.get(root);
      if (blob) {
        blob.area += 1; blob.x += x; blob.y += y;
        if (x < blob.minX) blob.minX = x;
        if (x > blob.maxX) blob.maxX = x;
        if (y < blob.minY) blob.minY = y;
        if (y > blob.maxY) blob.maxY = y;
      } else {
        byRoot.set(root, { area: 1, x, y, minX: x, maxX: x, minY: y, maxY: y, label: root });
      }
    }
  }
  const list = [...byRoot.values()].map((blob) => ({ ...blob, x: blob.x / blob.area, y: blob.y / blob.area }));
  return { list, labels };
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** The smallest rectangle around a convex polygon, by its edges (rotating calipers). */
function minRectArea(points: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const p of points) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    best = Math.min(best, (maxU - minU) * (maxV - minV));
  }
  return best;
}

/**
 * Square, solid blobs of a plausible size. The outline used for the shape is
 * each row's leftmost and rightmost pixel, widened by half a pixel, so the
 * hull's area is the blob's own and not a pixel short on every side.
 */
function squares(image: GrayImage, mask: Uint8Array): Blob[] {
  const { width: W, height: H } = image;
  const { list, labels } = blobs(mask, W, H);
  const minDim = Math.min(W, H);
  const minSide = Math.max(5, minDim * 0.008);
  const maxSide = minDim * 0.16;
  const candidates = list.filter((blob) => {
    const w = blob.maxX - blob.minX + 1;
    const h = blob.maxY - blob.minY + 1;
    return w >= minSide && h >= minSide && w <= maxSide && h <= maxSide && w / h < 2.2 && h / w < 2.2
      && blob.area >= 0.45 * w * h;
  });
  const out: Blob[] = [];
  for (const blob of candidates) {
    const edges: Point[] = [];
    for (let y = blob.minY; y <= blob.maxY; y += 1) {
      let lo = -1;
      let hi = -1;
      for (let x = blob.minX; x <= blob.maxX; x += 1) {
        if (labels[y * W + x] === blob.label) {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      if (lo >= 0) {
        edges.push({ x: lo - 0.5, y: y - 0.5 }, { x: lo - 0.5, y: y + 0.5 }, { x: hi + 0.5, y: y - 0.5 }, { x: hi + 0.5, y: y + 0.5 });
      }
    }
    const shape = hull(edges);
    const hullArea = polygonArea(shape);
    if (hullArea <= 0) continue;
    const solidity = blob.area / hullArea;
    const rectangularity = blob.area / minRectArea(shape);
    if (solidity >= 0.9 && rectangularity >= 0.86) out.push(blob);
  }
  return out;
}

// ------------------------------------------------------------- perspective --

type Homography = number[];

/** The perspective that takes four sheet points to four image points. */
function homography(from: SheetPoint[], to: Point[]): Homography | null {
  const A: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) if (Math.abs(A[row]![col]!) > Math.abs(A[pivot]![col]!)) pivot = row;
    if (Math.abs(A[pivot]![col]!) < 1e-10) return null;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = A[row]![col]! / A[col]![col]!;
      for (let k = col; k < 9; k += 1) A[row]![k]! -= factor * A[col]![k]!;
    }
  }
  return [...Array.from({ length: 8 }, (_, i) => A[i]![8]! / A[i]![i]!), 1];
}

function project(h: Homography, p: SheetPoint): Point {
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return { x: (h[0]! * p.x + h[1]! * p.y + h[2]!) / w, y: (h[3]! * p.x + h[4]! * p.y + h[5]!) / w };
}

/** Mean luminance over a disc of radius `r` (sheet units) around `p`, sampled on the sheet and projected. */
function discMean(image: GrayImage, h: Homography, p: SheetPoint, r: number): number {
  let sum = 0;
  let count = 0;
  for (let i = -3; i <= 3; i += 1) {
    for (let j = -3; j <= 3; j += 1) {
      if (i * i + j * j > 9.5) continue;
      const q = project(h, { x: p.x + (i / 3) * r, y: p.y + (j / 3) * r });
      sum += sample(image, q.x, q.y);
      count += 1;
    }
  }
  return sum / count;
}

/** The paper's brightness near `p`: a high percentile of a square around it. */
function paperNear(image: GrayImage, h: Homography, p: SheetPoint, r: number): number {
  const values: number[] = [];
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      const q = project(h, { x: p.x + (i / 4) * r, y: p.y + (j / 4) * r });
      values.push(sample(image, q.x, q.y));
    }
  }
  values.sort((a, b) => a - b);
  return Math.max(values[Math.floor(values.length * 0.85)]!, 1);
}

function darknessAt(image: GrayImage, h: Homography, p: SheetPoint, inner: number, around: number): number {
  return Math.min(Math.max(1 - discMean(image, h, p, inner) / paperNear(image, h, p, around), 0), 1);
}

// ----------------------------------------------------------------- reading --

/** Clockwise from the top-left as the image shows it (y down). */
function clockwise(points: Point[]): Point[] {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function isConvex(quad: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const c = cross(quad[i]!, quad[(i + 1) % 4]!, quad[(i + 2) % 4]!);
    if (c === 0) return false;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function readCode(image: GrayImage, h: Homography, layout: SheetLayout): SheetCode | null {
  const bits = layout.code.map((p) => darknessAt(image, h, p, layout.codeSize * 0.3, layout.codeSize * 1.2) > 0.4);
  return decodeSheetCode(bits);
}

/** Where a square really is, near where the perspective puts it: the dark blob closest to the guess. */
function refine(image: GrayImage, mask: Uint8Array, guess: Point, side: number): Point | null {
  const radius = Math.ceil(side * 1.3);
  const x0 = Math.max(0, Math.floor(guess.x - radius));
  const x1 = Math.min(image.width - 1, Math.ceil(guess.x + radius));
  const y0 = Math.max(0, Math.floor(guess.y - radius));
  const y1 = Math.min(image.height - 1, Math.ceil(guess.y + radius));
  let sx = 0; let sy = 0; let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (mask[y * image.width + x] && Math.hypot(x - guess.x, y - guess.y) <= side * 0.9) {
        sx += x; sy += y; n += 1;
      }
    }
  }
  if (n < side * side * 0.35) return null;
  const found = { x: sx / n, y: sy / n };
  return Math.hypot(found.x - guess.x, found.y - guess.y) <= side * 0.8 ? found : null;
}

/** Otsu's threshold over values in 0..1. */
function otsu(values: number[]): number {
  const bins = 100;
  const histogram = new Array<number>(bins).fill(0);
  for (const value of values) histogram[Math.min(bins - 1, Math.floor(value * bins))]! += 1;
  const total = values.length;
  let sumAll = 0;
  histogram.forEach((count, at) => { sumAll += at * count; });
  let weightBelow = 0;
  let sumBelow = 0;
  let best = 0;
  let threshold = 0.35;
  for (let at = 0; at < bins; at += 1) {
    weightBelow += histogram[at]!;
    if (weightBelow === 0) continue;
    const weightAbove = total - weightBelow;
    if (weightAbove === 0) break;
    sumBelow += at * histogram[at]!;
    const meanBelow = sumBelow / weightBelow;
    const meanAbove = (sumAll - sumBelow) / weightAbove;
    const between = weightBelow * weightAbove * (meanBelow - meanAbove) ** 2;
    if (between > best) {
      best = between;
      threshold = (at + 1) / bins;
    }
  }
  return threshold;
}

/** The lightest a fill may be and still count, and the darkest an empty bubble may be. */
const FLOOR = 0.24;
const CEILING = 0.55;
const MARGIN = 0.07;

export function readSheet(source: GrayImage, expect: SheetCode, debug?: (event: string, data: unknown) => void): ScanResult {
  const image = shrink(source, 1600);
  const mask = darkMask(image);
  const found = squares(image, mask).sort((a, b) => b.area - a.area).slice(0, 14);
  debug?.("squares", found.map((blob) => ({ x: Math.round(blob.x), y: Math.round(blob.y), area: blob.area })));
  if (found.length < 4) return { ok: false, code: "no_markers" };

  const layout = sheetLayout(expect.questions, expect.options);
  const quads: { points: Point[]; area: number }[] = [];
  for (let a = 0; a < found.length; a += 1) {
    for (let b = a + 1; b < found.length; b += 1) {
      for (let c = b + 1; c < found.length; c += 1) {
        for (let d = c + 1; d < found.length; d += 1) {
          const four = [found[a]!, found[b]!, found[c]!, found[d]!];
          const areas = four.map((blob) => blob.area);
          if (Math.max(...areas) > Math.min(...areas) * 3) continue;
          const points = clockwise(four.map((blob) => ({ x: blob.x, y: blob.y })));
          if (!isConvex(points)) continue;
          quads.push({ points, area: polygonArea(points) });
        }
      }
    }
  }
  quads.sort((a, b) => b.area - a.area);

  let other: SheetCode | undefined;
  for (const quad of quads.slice(0, 40)) {
    for (let turn = 0; turn < 4; turn += 1) {
      const corners = [0, 1, 2, 3].map((i) => quad.points[(i + turn) % 4]!);
      const h = homography(layout.markers, corners);
      if (!h) continue;
      // Up is where the small square is, and nowhere else.
      const marked = darknessAt(image, h, layout.orientation, layout.orientationSize * 0.3, layout.orientationSize * 1.3);
      const mirrored = darknessAt(image, h, { x: layout.width - layout.orientation.x, y: layout.orientation.y }, layout.orientationSize * 0.3, layout.orientationSize * 1.3);
      debug?.("turn", { turn, area: Math.round(quad.area), marked: +marked.toFixed(2), mirrored: +mirrored.toFixed(2) });
      if (marked < 0.4 || mirrored > 0.25) continue;
      const code = readCode(image, h, layout);
      debug?.("code", { code, bits: layout.code.map((p) => +darknessAt(image, h, p, layout.codeSize * 0.3, layout.codeSize * 1.2).toFixed(2)) });
      if (!code) continue;
      if (code.questions !== expect.questions || code.options !== expect.options || code.fingerprint !== expect.fingerprint) {
        other = other ?? code;
        continue;
      }
      return readBubbles(image, mask, h, corners, layout);
    }
  }
  return other ? { ok: false, code: "other_test", read: other } : { ok: false, code: quads.length ? "not_a_sheet" : "no_markers" };
}

function readBubbles(image: GrayImage, mask: Uint8Array, h: Homography, corners: Point[], layout: SheetLayout): ScanRead {
  // A fold across the middle: the edge squares split the sheet into two
  // perspectives, each held by four squares that are really there.
  const side = Math.hypot(...(() => {
    const a = project(h, layout.markers[0]);
    const b = project(h, { x: layout.markers[0].x + layout.middleSize, y: layout.markers[0].y });
    return [b.x - a.x, b.y - a.y] as [number, number];
  })());
  const left = refine(image, mask, project(h, layout.middles[0]), side);
  const right = refine(image, mask, project(h, layout.middles[1]), side);
  let upper = h;
  let lower = h;
  if (left && right) {
    upper = homography([layout.markers[0], layout.markers[1], layout.middles[1], layout.middles[0]], [corners[0]!, corners[1]!, right, left]) ?? h;
    lower = homography([layout.middles[0], layout.middles[1], layout.markers[2], layout.markers[3]], [left, right, corners[2]!, corners[3]!]) ?? h;
  }
  const half = layout.height / 2;
  const at = (p: SheetPoint) => (p.y < half ? upper : lower);

  const darkness: number[][] = Array.from({ length: layout.questions }, () => []);
  const places: { x: number; y: number; r: number }[][] = Array.from({ length: layout.questions }, () => []);
  for (const bubble of layout.bubbles) {
    const hh = at(bubble);
    darkness[bubble.question]![bubble.option] = darknessAt(image, hh, bubble, bubble.r * 0.55, bubble.r * 1.35);
    const centre = project(hh, bubble);
    const edge = project(hh, { x: bubble.x + bubble.r, y: bubble.y });
    places[bubble.question]![bubble.option] = { x: centre.x, y: centre.y, r: Math.hypot(edge.x - centre.x, edge.y - centre.y) };
  }

  const all = darkness.flat();
  // With nothing filled, Otsu splits the noise of empty bubbles; the floor
  // keeps an empty sheet empty.
  const threshold = Math.min(Math.max(otsu(all), FLOOR), CEILING);
  const answers: (number | null)[] = [];
  const flags: ScanFlag[] = [];
  for (const row of darkness) {
    const order = row.map((value, option) => ({ value, option })).sort((a, b) => b.value - a.value);
    const first = order[0]!;
    const second = order[1]!;
    const filled = order.filter((entry) => entry.value >= threshold);
    const close = row.some((value) => Math.abs(value - threshold) < MARGIN);
    if (filled.length === 0) {
      answers.push(null);
      flags.push(close ? "uncertain" : null);
    } else if (filled.length === 1) {
      answers.push(first.option);
      flags.push(close ? "uncertain" : null);
    } else if (first.value - second.value >= 0.25) {
      // One clearly darker than the rest: an answer changed and half rubbed out.
      answers.push(first.option);
      flags.push("uncertain");
    } else {
      answers.push(null);
      flags.push("multiple");
    }
  }

  return {
    ok: true,
    answers,
    flags,
    darkness: darkness.map((row) => row.map((value) => Math.round(value * 1000) / 1000)),
    threshold: Math.round(threshold * 1000) / 1000,
    image: { width: image.width, height: image.height },
    corners,
    bubbles: places,
  };
}

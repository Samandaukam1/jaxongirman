import fontkit from "@pdf-lib/fontkit";
import {
  appendBezierCurve,
  clip,
  closePath,
  degrees,
  endPath,
  lineTo,
  moveTo,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  rotateDegrees,
  translate,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

import { ExportAssetLoader, type ExportAsset } from "./export-assets.ts";
import {
  applyTextTransform,
  boolean,
  clamp,
  colorAt,
  interpolateHex,
  linearBands,
  radialBands,
  stopsOf,
  MODEL_HEIGHT,
  MODEL_WIDTH,
  number,
  object,
  rgba,
  string,
  type ExportDeck,
  type ExportElement,
  type JsonObject,
} from "./export-model.ts";
import { DEFAULT_FACE, bundledUrl, faceRequest, type FaceRequest } from "./fonts.ts";

/**
 * The faces a deck actually needs, embedded once each.
 *
 * The export used to draw every deck in one Manrope regular/bold pair, which
 * meant a design's typography — the whole point of choosing one — never
 * survived to PDF. Now each text row names the face it is set in, a custom
 * upload is embedded from Storage when there is one, and the design's own
 * declared fallback covers the rest. Nothing is substituted without the
 * substitution being the one the design asked for (§78).
 */
class FontBook {
  private readonly embedded = new Map<string, PDFFont>();
  private constructor(private readonly pdf: PDFDocument, readonly custom: boolean, private readonly base: PDFFont) {}

  static async open(pdf: PDFDocument, styles: readonly JsonObject[]): Promise<FontBook> {
    let base: PDFFont;
    let custom = false;
    try {
      pdf.registerFontkit(fontkit);
  /**
   * Fonts are embedded whole, never subset.
   *
   * `@pdf-lib/fontkit@1.1.1` builds a broken subset for some faces: the text
   * layer is correct — a reader extracts every word — and most of the glyphs
   * are simply not drawn. An obyektivka came out reading "'L" where it should
   * have said "MA'LUMOTNOMA". Manrope survives it and Tinos does not, which is
   * why it took a document to find.
   *
   * Not subsetting costs a few hundred kilobytes per file. Subsetting costs a
   * document nobody can read, and there is no version of that trade worth
   * making.
   */
      base = await pdf.embedFont(await fetchFont(bundledUrl(DEFAULT_FACE)!));
      custom = true;
    } catch {
      // No network, or a face that will not parse. Helvetica keeps the export
      // producing a readable document rather than failing outright.
      base = await pdf.embedFont(StandardFonts.Helvetica);
    }
    const book = new FontBook(pdf, custom, base);
    if (custom) await book.preload(styles);
    return book;
  }

  /**
   * Embeds every distinct face the deck uses, before any page is drawn.
   *
   * pdf-lib embeds asynchronously and the drawing pass is synchronous, so the
   * work has to happen up front. Downloading them together also means a deck
   * with four faces waits once rather than four times.
   */
  private async preload(styles: readonly JsonObject[]): Promise<void> {
    const wanted = new Map<string, FaceRequest>();
    for (const style of styles) {
      const request = faceRequest(style);
      if (!wanted.has(request.key)) wanted.set(request.key, request);
    }
    await Promise.all([...wanted.values()].map(async (request) => {
      for (const url of [request.url, bundledUrl(request.fallback)]) {
        if (!url) continue;
        try {
          const font = await this.pdf.embedFont(await fetchFont(url));
          this.embedded.set(request.key, font);
          return;
        } catch (error) {
          // A face that will not download or parse is reported and skipped; the
          // row then draws in the base face rather than taking the deck down.
          console.warn("pdf font unavailable", url, error instanceof Error ? error.message : error);
        }
      }
    }));
  }

  /** The embedded face for a text row, or the base face when it never arrived. */
  faceFor(style: JsonObject): PDFFont {
    if (!this.custom) return this.base;
    return this.embedded.get(faceRequest(style).key) ?? this.base;
  }
}

async function fetchFont(url: string): Promise<Uint8Array> {
  // Several faces are fetched once per export, and a cold CDN edge is slow;
  // eight seconds was tuned for a single small file and timed the rest out.
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`font download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function safeText(value: string, custom: boolean): string {
  return custom ? value : value.normalize("NFKD").replace(/[^\x20-\xFF\n]/g, "'");
}

function pdfColor(value: unknown, fallback = "#151A18") {
  const parsed = rgba(value, fallback);
  return { color: rgb(parsed.red, parsed.green, parsed.blue), alpha: parsed.alpha };
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawPlaceholder(page: PDFPage, element: ExportElement, label = "Rasm") {
  const y = MODEL_HEIGHT - element.y - element.height;
  page.drawRectangle({
    x: element.x,
    y,
    width: element.width,
    height: element.height,
    color: rgb(0.94, 0.92, 0.98),
    borderColor: rgb(0.75, 0.69, 0.86),
    borderWidth: 1.5,
    opacity: element.opacity,
  });
  page.drawText(label, {
    x: element.x + Math.max(8, element.width * 0.04),
    y: y + element.height / 2 - 7,
    size: Math.max(8, Math.min(18, element.height * 0.12)),
    color: rgb(0.42, 0.33, 0.61),
    opacity: element.opacity,
  });
}

/** A rounded rectangle as path operators, in PDF space (y up). */
/**
 * A row's corner radii, top-left, top-right, bottom-right, bottom-left: its
 * own four when it carries them (the naqsh leaf), else its one radius.
 */
function cornerRadii(style: JsonObject): readonly number[] {
  const list = style.borderRadiusCorners;
  if (Array.isArray(list) && list.length === 4) return list.map((value) => Math.max(0, number(value, 0)));
  const one = Math.max(0, number(style.borderRadius, 0));
  return [one, one, one, one];
}

/**
 * The corners fitted to the box the way CSS — and so the phone and the web
 * viewer — fit them: all scaled down together only where two curves on one
 * side would overlap. A single corner may sweep the whole side, which is what
 * makes a quarter disc of a square.
 */
function fitted(corners: readonly number[] | number, width: number, height: number): [number, number, number, number] {
  const list = typeof corners === "number" ? [corners, corners, corners, corners] : corners;
  const [tl, tr, br, bl] = list.map((value) => Math.max(0, value)) as [number, number, number, number];
  const room = (side: number, sum: number) => (sum > 0 ? side / sum : Infinity);
  const scale = Math.min(1, room(width, tl + tr), room(width, bl + br), room(height, tl + bl), room(height, tr + br));
  return [tl * scale, tr * scale, br * scale, bl * scale];
}

/**
 * A rounded rectangle in PDF space, `(x, y)` its bottom-left. Corners are given
 * the way the slide names them — top-left, top-right, bottom-right,
 * bottom-left — and turned here into PDF's upward y.
 */
function roundedRectPath(x: number, y: number, width: number, height: number, corners: readonly number[] | number) {
  const [tl, tr, br, bl] = fitted(corners, width, height);
  const k = 0.5523;
  return [
    moveTo(x + bl, y),
    lineTo(x + width - br, y),
    appendBezierCurve(x + width - br + br * k, y, x + width, y + br - br * k, x + width, y + br),
    lineTo(x + width, y + height - tr),
    appendBezierCurve(x + width, y + height - tr + tr * k, x + width - tr + tr * k, y + height, x + width - tr, y + height),
    lineTo(x + tl, y + height),
    appendBezierCurve(x + tl - tl * k, y + height, x, y + height - tl + tl * k, x, y + height - tl),
    lineTo(x, y + bl),
    appendBezierCurve(x, y + bl - bl * k, x + bl - bl * k, y, x + bl, y),
    closePath(),
  ];
}

/** The same outline as an SVG path, for strokes (y down from the top-left). */
function roundedRectSvg(width: number, height: number, corners: readonly number[] | number): string {
  const [tl, tr, br, bl] = fitted(corners, width, height);
  return `M ${tl} 0 H ${width - tr} A ${tr} ${tr} 0 0 1 ${width} ${tr} V ${height - br} A ${br} ${br} 0 0 1 ${width - br} ${height} `
    + `H ${bl} A ${bl} ${bl} 0 0 1 0 ${height - bl} V ${tl} A ${tl} ${tl} 0 0 1 ${tl} 0 Z`;
}

/**
 * A filled shape: rectangles, rounded glass cards, ellipses and radial light.
 *
 * The Liquid Glass engine's backgrounds are radial gradients fading to
 * nothing, and its cards are translucent rounded rectangles with a lit top
 * edge. PDF has neither primitive in pdf-lib's API, so a radial fill is drawn
 * as solved concentric layers (`radialBands`) and a gradient card as strips
 * clipped to its rounded outline. Rotation turns round the shape's centre, as
 * it does on the phone.
 */
function drawShape(page: PDFPage, element: ExportElement, style: JsonObject) {
  const stops = stopsOf(style);
  const stroke = typeof style.stroke === "string" ? pdfColor(style.stroke, "#000000") : null;
  const strokeWidth = stroke ? Math.max(0.5, number(style.strokeWidth, 1)) : 0;
  const cx = element.x + element.width / 2;
  const cy = MODEL_HEIGHT - element.y - element.height / 2;

  if (string(style.shape) === "ellipse" || string(style.gradientType) === "radial") {
    const rotate = degrees(-element.rotation);
    const rx = element.width / 2;
    const ry = element.height / 2;
    if (string(style.gradientType) === "radial" && stops.length >= 2) {
      for (const band of radialBands(stops, 28)) {
        page.drawEllipse({
          x: cx, y: cy, xScale: Math.max(0.1, rx * band.scale), yScale: Math.max(0.1, ry * band.scale),
          color: pdfColor(`#${band.hex}`).color, opacity: clamp(element.opacity * band.alpha, 0, 1), rotate,
        });
      }
    } else {
      const fill = colorAt(stops, 0);
      if (fill.alpha > 0.002) {
        page.drawEllipse({ x: cx, y: cy, xScale: rx, yScale: ry, color: pdfColor(`#${fill.hex}`).color, opacity: clamp(element.opacity * fill.alpha, 0, 1), rotate });
      }
    }
    if (stroke && stroke.alpha > 0.002) {
      page.drawEllipse({
        x: cx, y: cy, xScale: Math.max(0.1, rx - strokeWidth / 2), yScale: Math.max(0.1, ry - strokeWidth / 2),
        borderColor: stroke.color, borderWidth: strokeWidth, borderOpacity: clamp(element.opacity * stroke.alpha, 0, 1), rotate,
      });
    }
    return;
  }

  const corners = cornerRadii(style);
  const radius = Math.max(...fitted(corners, element.width, element.height));
  const left = element.x;
  const bottom = MODEL_HEIGHT - element.y - element.height;

  if (radius > 0.5 || stops.length >= 2) {
    page.pushOperators(pushGraphicsState());
    if (element.rotation) page.pushOperators(translate(cx, cy), rotateDegrees(-element.rotation), translate(-cx, -cy));
    page.pushOperators(...roundedRectPath(left, bottom, element.width, element.height, corners), clip(), endPath());
    if (stops.length >= 2) {
      for (const band of linearBands(stops, number(style.gradientAngle, 135))) {
        if (band.alpha <= 0.002) continue;
        const from = band.reverse ? 1 - band.to : band.from;
        const to = band.reverse ? 1 - band.from : band.to;
        const color = pdfColor(`#${band.hex}`).color;
        const opacity = clamp(element.opacity * band.alpha, 0, 1);
        // Edge to edge and never overlapping: two translucent strips sharing a
        // sliver would double its alpha and draw a line across the glass.
        if (band.vertical) {
          page.drawRectangle({ x: left + element.width * from, y: bottom, width: element.width * (to - from), height: element.height, color, opacity });
        } else {
          // Strips are measured from the top, and PDF counts from the bottom.
          page.drawRectangle({ x: left, y: bottom + element.height * (1 - to), width: element.width, height: element.height * (to - from), color, opacity });
        }
      }
    } else {
      const fill = colorAt(stops, 0);
      if (fill.alpha > 0.002) {
        page.drawRectangle({ x: left, y: bottom, width: element.width, height: element.height, color: pdfColor(`#${fill.hex}`).color, opacity: clamp(element.opacity * fill.alpha, 0, 1) });
      }
    }
    page.pushOperators(popGraphicsState());
    if (stroke && stroke.alpha > 0.002) {
      page.pushOperators(pushGraphicsState());
      if (element.rotation) page.pushOperators(translate(cx, cy), rotateDegrees(-element.rotation), translate(-cx, -cy));
      page.drawSvgPath(roundedRectSvg(element.width, element.height, corners), {
        x: left, y: MODEL_HEIGHT - element.y,
        borderColor: stroke.color, borderWidth: strokeWidth, borderOpacity: clamp(element.opacity * stroke.alpha, 0, 1),
      });
      page.pushOperators(popGraphicsState());
    }
    return;
  }

  const fill = pdfColor(style.fill, "#EEEEEE");
  const opacity = clamp(element.opacity * fill.alpha, 0, 1);
  const gradientTo = string(style.gradientTo);
  if (gradientTo) {
    const steps = 28;
    const angle = ((number(style.gradientAngle, 135) % 360) + 360) % 360;
    const vertical = angle >= 45 && angle < 135 || angle >= 225 && angle < 315;
    for (let index = 0; index < steps; index += 1) {
      const color = pdfColor(`#${interpolateHex(style.fill, gradientTo, index / (steps - 1))}`).color;
      page.drawRectangle(vertical
        ? { x: element.x + element.width * index / steps, y: bottom, width: element.width / steps + 0.5, height: element.height, color, opacity }
        : { x: element.x, y: bottom + element.height * index / steps, width: element.width, height: element.height / steps + 0.5, color, opacity });
    }
  } else {
    page.drawRectangle({
      x: element.x,
      y: bottom,
      width: element.width,
      height: element.height,
      color: fill.color,
      opacity,
      rotate: degrees(element.rotation),
    });
  }
  if (stroke) {
    page.drawRectangle({
      x: element.x,
      y: bottom,
      width: element.width,
      height: element.height,
      borderColor: stroke.color,
      borderWidth: strokeWidth,
      borderOpacity: clamp(element.opacity * stroke.alpha, 0, 1),
      opacity: 0,
      rotate: degrees(element.rotation),
    });
  }
}

function drawLine(page: PDFPage, element: ExportElement, style: JsonObject) {
  const radians = element.rotation * Math.PI / 180;
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const dx = Math.cos(radians) * element.width / 2;
  const dy = Math.sin(radians) * element.width / 2;
  const color = pdfColor(style.color, "#151A18");
  page.drawLine({
    start: { x: centerX - dx, y: MODEL_HEIGHT - (centerY - dy) },
    end: { x: centerX + dx, y: MODEL_HEIGHT - (centerY + dy) },
    thickness: Math.max(0.5, number(style.strokeWidth, Math.max(1, element.height))),
    color: color.color,
    opacity: clamp(element.opacity * color.alpha, 0, 1),
  });
}

function drawText(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject, fonts: FontBook) {
  const font = fonts.faceFor(style);
  const size = Math.max(4, number(style.fontSize, 30));
  const lineHeight = Math.max(size, number(style.lineHeight, size * 1.2));
  const raw = applyTextTransform(string(content.text, ""), style);
  const text = safeText(raw, fonts.custom);
  const lines = wrap(text, font, size, element.width).slice(0, Math.max(1, Math.floor(element.height / lineHeight)));
  const blockHeight = Math.max(size, lines.length * lineHeight);
  const vertical = string(style.verticalAlign, "center");
  const inset = vertical === "bottom" ? Math.max(0, element.height - blockHeight) : vertical === "top" ? 0 : Math.max(0, (element.height - blockHeight) / 2);
  const color = pdfColor(style.color, "#151A18");
  const alignment = string(style.textAlign, "left");

  lines.forEach((line, index) => {
    const width = font.widthOfTextAtSize(line, size);
    const x = alignment === "center"
      ? element.x + (element.width - width) / 2
      : alignment === "right"
        ? element.x + element.width - width
        : element.x;
    const top = element.y + inset + index * lineHeight;
    page.drawText(line, {
      x,
      y: MODEL_HEIGHT - top - size,
      size,
      font,
      color: color.color,
      opacity: clamp(element.opacity * color.alpha, 0, 1),
      rotate: degrees(element.rotation),
    });
    if (boolean(style.underline) || string(style.textDecoration).includes("underline")) {
      page.drawLine({
        start: { x, y: MODEL_HEIGHT - top - size - 2 },
        end: { x: x + width, y: MODEL_HEIGHT - top - size - 2 },
        thickness: Math.max(0.5, size / 18),
        color: color.color,
        opacity: clamp(element.opacity * color.alpha, 0, 1),
      });
    }
  });
}

async function embedImage(pdf: PDFDocument, asset: ExportAsset): Promise<PDFImage | null> {
  if (asset.mimeType === "image/png") return await pdf.embedPng(asset.bytes);
  if (asset.mimeType === "image/jpeg") return await pdf.embedJpg(asset.bytes);
  return null;
}

async function drawImage(page: PDFPage, pdf: PDFDocument, element: ExportElement, style: JsonObject, asset: ExportAsset | null) {
  if (!asset) {
    const kind = string(object(element.content).kind, "image");
    drawPlaceholder(page, element, kind === "video" ? "Video" : "Rasm");
    return;
  }
  const image = await embedImage(pdf, asset);
  if (!image) {
    drawPlaceholder(page, element, "Rasm formati");
    return;
  }
  const y = MODEL_HEIGHT - element.y - element.height;
  const mode = string(style.objectFit, "cover");
  let x = element.x;
  let drawY = y;
  let width = element.width;
  let height = element.height;
  if (mode === "contain") {
    const scale = Math.min(element.width / image.width, element.height / image.height);
    width = image.width * scale;
    height = image.height * scale;
    x += (element.width - width) / 2;
    drawY += (element.height - height) / 2;
  } else {
    const scale = Math.max(element.width / image.width, element.height / image.height);
    width = image.width * scale;
    height = image.height * scale;
    x += (element.width - width) / 2;
    drawY += (element.height - height) / 2;
    // Clipped to the row's own corners, so a rounded or leaf-cut photograph
    // keeps its shape in the PDF as it has it on the screen.
    page.pushOperators(
      pushGraphicsState(),
      ...roundedRectPath(element.x, y, element.width, element.height, cornerRadii(style)),
      clip(),
      endPath(),
    );
  }
  page.drawImage(image, { x, y: drawY, width, height, opacity: element.opacity, rotate: degrees(element.rotation) });
  if (mode !== "contain") page.pushOperators(popGraphicsState());
}

/**
 * An icon the deck carries as outlines: drawn as its own paths, so the PDF
 * shows the same glyph as the phone. A gradient is laid as strips, each the
 * glyph clipped to one band of the gradient (pdf-lib has no gradient fill);
 * the shadow is the glyph again, offset and faint, under it.
 */
function drawVectorIcon(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject): boolean {
  const vector = object(content.vector);
  const paths = (Array.isArray(vector.paths) ? vector.paths : [])
    .map((path) => object(path))
    .filter((path) => typeof path.d === "string" && path.d);
  if (!paths.length) return false;
  const box = number(vector.box, 256);
  const size = Math.min(element.width, element.height);
  const scale = size / box;
  const left = element.x + (element.width - size) / 2;
  const top = element.y + (element.height - size) / 2;
  const draw = (x: number, y: number, color: ReturnType<typeof pdfColor>["color"], opacity: number) => {
    for (const path of paths) {
      const alpha = clamp(opacity * number(path.opacity, 1), 0, 1);
      if (alpha <= 0.002) continue;
      page.drawSvgPath(string(path.d), { x, y: MODEL_HEIGHT - y, scale, color, opacity: alpha, borderWidth: 0 });
    }
  };

  const shadow = object(style.iconShadow);
  if (typeof shadow.color === "string") {
    const tone = pdfColor(shadow.color, "#000000");
    const strength = number(shadow.opacity, 0.3) * element.opacity;
    // Two offsets, the nearer one darker: a step toward the blur a PDF cannot draw.
    draw(left + number(shadow.dx, 0) * 0.5, top + number(shadow.dy, 2) * 0.5, tone.color, strength * 0.35);
    draw(left + number(shadow.dx, 0), top + number(shadow.dy, 2), tone.color, strength * 0.3);
  }

  const graded = Array.isArray(style.gradientStops) && style.gradientStops.length >= 2;
  if (!graded) {
    const color = pdfColor(style.color, "#151A18");
    draw(left, top, color.color, element.opacity * color.alpha);
    return true;
  }
  const bottom = MODEL_HEIGHT - top - size;
  for (const band of linearBands(stopsOf(style), number(style.gradientAngle, 135), 10)) {
    if (band.alpha <= 0.002) continue;
    const from = band.reverse ? 1 - band.to : band.from;
    const to = band.reverse ? 1 - band.from : band.to;
    page.pushOperators(pushGraphicsState());
    page.pushOperators(
      band.vertical
        ? rectangle(left + size * from, bottom, size * (to - from) + 0.3, size)
        : rectangle(left, bottom + size * (1 - to), size, size * (to - from) + 0.3),
      clip(),
      endPath(),
    );
    draw(left, top, pdfColor(`#${band.hex}`).color, element.opacity * band.alpha);
    page.pushOperators(popGraphicsState());
  }
  return true;
}

function drawIcon(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject) {
  if (drawVectorIcon(page, element, style, content)) return;
  const color = pdfColor(style.color, "#151A18");
  const opacity = clamp(element.opacity * color.alpha, 0, 1);
  const centerX = element.x + element.width / 2;
  const centerY = MODEL_HEIGHT - element.y - element.height / 2;
  const size = Math.min(element.width, element.height);
  const name = string(content.icon, "Sparkles");
  if (name === "Target") {
    page.drawCircle({ x: centerX, y: centerY, size: size * 0.45, borderColor: color.color, borderWidth: Math.max(1, size * 0.08), opacity: 0, borderOpacity: opacity });
    page.drawCircle({ x: centerX, y: centerY, size: size * 0.16, color: color.color, opacity });
  } else if (name === "Layers") {
    for (let index = 0; index < 3; index += 1) page.drawRectangle({ x: element.x + size * 0.08 * index, y: centerY - size * 0.24 + size * 0.08 * index, width: size * 0.68, height: size * 0.42, borderColor: color.color, borderWidth: Math.max(1, size * 0.07), opacity: 0, borderOpacity: opacity });
  } else {
    page.drawLine({ start: { x: centerX - size * 0.42, y: centerY }, end: { x: centerX + size * 0.42, y: centerY }, thickness: Math.max(1, size * 0.08), color: color.color, opacity });
    page.drawLine({ start: { x: centerX, y: centerY - size * 0.42 }, end: { x: centerX, y: centerY + size * 0.42 }, thickness: Math.max(1, size * 0.08), color: color.color, opacity });
    page.drawLine({ start: { x: centerX - size * 0.28, y: centerY - size * 0.28 }, end: { x: centerX + size * 0.28, y: centerY + size * 0.28 }, thickness: Math.max(1, size * 0.06), color: color.color, opacity });
    page.drawLine({ start: { x: centerX - size * 0.28, y: centerY + size * 0.28 }, end: { x: centerX + size * 0.28, y: centerY - size * 0.28 }, thickness: Math.max(1, size * 0.06), color: color.color, opacity });
  }
}

function seriesColors(style: JsonObject): string[] {
  return Array.isArray(style.series) ? style.series.filter((value): value is string => typeof value === "string") : [];
}

function drawChart(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject, fonts: FontBook) {
  const values = Array.isArray(content.values) ? content.values.map((value) => number(value, 0)).filter((value) => Number.isFinite(value)) : [];
  if (!values.length) return;
  const labels = Array.isArray(content.labels) ? content.labels.map((label) => String(label ?? "")) : [];
  const colors = seriesColors(style);
  const primary = string(style.color, "#173E35");
  const type = string(content.chartType, "bar");
  const max = Math.max(...values.map(Math.abs), 1);
  const baseY = MODEL_HEIGHT - element.y - element.height;
  const font = fonts.faceFor({});
  const labelColor = pdfColor(style.labelColor, "#777777");
  const labelSize = Math.max(6, number(style.labelSize, 11));

  if (type === "donut" || type === "pie") {
    // Arcs stroked round the centre, the way the phone draws the ring.
    const size = Math.min(element.width, element.height);
    const thickness = Math.min(number(style.strokeWidth, size * 0.19), size / 2);
    const radius = size / 2 - thickness / 2;
    const cx = element.width / 2;
    const cy = element.height / 2;
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const track = pdfColor(style.trackColor, "#E5E5E5");
    page.drawCircle({ x: element.x + cx, y: MODEL_HEIGHT - element.y - cy, size: radius, borderColor: track.color, borderWidth: thickness, borderOpacity: clamp(element.opacity * track.alpha, 0, 1), opacity: 0 });
    let cursor = -90;
    values.forEach((value, index) => {
      const sweep = Math.max(0, value) / total * 359.9;
      if (sweep <= 0) return;
      const start = cursor * Math.PI / 180;
      const end = (cursor + sweep) * Math.PI / 180;
      cursor += sweep;
      const path = `M ${cx + radius * Math.cos(start)} ${cy + radius * Math.sin(start)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${cx + radius * Math.cos(end)} ${cy + radius * Math.sin(end)}`;
      page.drawSvgPath(path, {
        x: element.x, y: MODEL_HEIGHT - element.y,
        borderColor: pdfColor(colors[index % Math.max(1, colors.length)] ?? primary).color,
        borderWidth: thickness, borderOpacity: element.opacity,
      });
    });
    return;
  }

  if (type === "line") {
    const step = values.length > 1 ? element.width / (values.length - 1) : element.width;
    for (let index = 0; index < values.length - 1; index += 1) {
      page.drawLine({
        start: { x: element.x + index * step, y: baseY + values[index]! / max * element.height * 0.9 },
        end: { x: element.x + (index + 1) * step, y: baseY + values[index + 1]! / max * element.height * 0.9 },
        thickness: Math.max(1.5, element.height * 0.012),
        color: pdfColor(primary).color,
        opacity: element.opacity,
      });
    }
    return;
  }

  // Bars, with the room for their labels kept underneath as on the phone.
  const band = style.showLabels !== false && labels.length ? Math.max(16, labelSize * 1.5) : 0;
  const plot = Math.max(4, element.height - band);
  const gap = number(style.gap, element.width / Math.max(8, values.length * 4));
  const width = Math.max(1, (element.width - gap * (values.length - 1)) / values.length);
  values.forEach((value, index) => {
    const height = Math.max(2, Math.abs(value) / max * plot * 0.88);
    const x = element.x + index * (width + gap);
    page.drawRectangle({
      x,
      y: baseY + band,
      width,
      height,
      color: pdfColor(colors[index % Math.max(1, colors.length)] ?? primary).color,
      opacity: element.opacity,
    });
    const draw = (text: string, y: number) => {
      const safe = safeText(text, fonts.custom).slice(0, 40);
      const measured = font.widthOfTextAtSize(safe, labelSize);
      page.drawText(safe, { x: x + width / 2 - Math.min(measured, width + gap) / 2, y, size: labelSize, font, color: labelColor.color, opacity: clamp(element.opacity * labelColor.alpha, 0, 1), maxWidth: width + gap });
    };
    if (style.showValues) draw(String(value), baseY + band + height + 4);
    if (band && labels[index]) draw(labels[index]!, baseY + 3);
  });
}

function drawTable(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject, fonts: FontBook) {
  const rows = Array.isArray(content.rows) ? content.rows.filter(Array.isArray).slice(0, 20) as unknown[][] : [];
  if (!rows.length) return;
  const columns = Math.max(...rows.map((row) => row.length), 1);
  const rowHeight = element.height / rows.length;
  const columnWidth = element.width / columns;
  const border = pdfColor(style.color, "#C9D2CF").color;
  rows.forEach((row, rowIndex) => row.slice(0, columns).forEach((cell, columnIndex) => {
    const x = element.x + columnIndex * columnWidth;
    const y = MODEL_HEIGHT - element.y - (rowIndex + 1) * rowHeight;
    page.drawRectangle({ x, y, width: columnWidth, height: rowHeight, borderColor: border, borderWidth: 0.75, opacity: 0, borderOpacity: element.opacity });
    page.drawText(safeText(String(cell ?? ""), fonts.custom).slice(0, 200), {
      x: x + 4,
      y: y + Math.max(2, rowHeight - 16),
      size: Math.max(6, Math.min(12, rowHeight * 0.32)),
      font: fonts.faceFor({}),
      color: pdfColor(style.color, "#151A18").color,
      opacity: element.opacity,
    });
  }));
}

export async function renderPdf(deck: ExportDeck, assets: ExportAssetLoader): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(deck.presentation.title);
  pdf.setCreator("Jaxongirman");
  pdf.setProducer("Jaxongirman PDF export");
  // Every text row in the deck, so each distinct face is embedded exactly once.
  const fonts = await FontBook.open(pdf, deck.elements
    .filter((element) => element.type === "text" || element.type === "table")
    .map((element) => object(element.style)));

  for (const slide of deck.slides) {
    const page = pdf.addPage([MODEL_WIDTH, MODEL_HEIGHT]);
    const background = object(slide.background);
    const backgroundColor = pdfColor(background.color, "#FFFFFF");
    page.drawRectangle({ x: 0, y: 0, width: MODEL_WIDTH, height: MODEL_HEIGHT, color: backgroundColor.color, opacity: backgroundColor.alpha });
    // A slide's own gradient ground, drawn under everything as the phone does.
    if (Array.isArray(background.gradientStops) && background.gradientStops.length >= 2) {
      drawShape(page, {
        id: `${slide.id}:ground`, slide_id: slide.id, presentation_id: slide.presentation_id, type: "shape",
        x: 0, y: 0, width: MODEL_WIDTH, height: MODEL_HEIGHT, rotation: 0, z_index: -1, opacity: 1, style: {}, content: {},
      } as unknown as ExportElement, background);
    }
    const elements = deck.elements.filter((element) => element.slide_id === slide.id).sort((left, right) => left.z_index - right.z_index);
    for (const element of elements) {
      const style = object(element.style);
      const content = object(element.content);
      if (element.type === "shape") drawShape(page, element, style);
      else if (element.type === "line") drawLine(page, element, style);
      else if (element.type === "text") drawText(page, element, style, content, fonts);
      else if (element.type === "image") await drawImage(page, pdf, element, style, await assets.forElement(element));
      else if (element.type === "icon") drawIcon(page, element, style, content);
      else if (element.type === "chart") drawChart(page, element, style, content, fonts);
      else if (element.type === "table") drawTable(page, element, style, content, fonts);
    }
  }

  // Keep page dictionaries as regular indirect objects. Besides making the
  // artifact easier for common PDF validators to inspect, this avoids clients
  // that still have incomplete PDF 1.5 object-stream support.
  return await pdf.save({ useObjectStreams: false });
}

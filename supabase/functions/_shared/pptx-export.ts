import PptxGenJS from "pptxgenjs";

import { ExportAssetLoader, type ExportAsset } from "./export-assets.ts";
import { pptxFace } from "./fonts.ts";
import {
  applyTextTransform,
  averageColor,
  boolean,
  bytesToBase64,
  clamp,
  colorAt,
  linearBands,
  radialBands,
  rgba,
  stopsOf,
  fontPoints,
  inch,
  interpolateHex,
  isBold,
  mimeDataUri,
  number,
  object,
  pptxColor,
  string,
  transparency,
  type ExportDeck,
  type ExportElement,
  type JsonObject,
} from "./export-model.ts";

function frame(element: ExportElement) {
  return { x: inch(element.x), y: inch(element.y), w: inch(element.width), h: inch(element.height) };
}

function svgData(svg: string): string {
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
}

function iconSvg(name: string, color: string): string {
  const common = `fill="none" stroke="#${color}" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"`;
  let body: string;
  if (name === "Target") body = `<circle cx="12" cy="12" r="9" ${common}/><circle cx="12" cy="12" r="3" ${common}/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3" ${common}/>`;
  else if (name === "Layers") body = `<path d="m12 2 9 5-9 5-9-5 9-5Z" ${common}/><path d="m3 12 9 5 9-5M3 17l9 5 9-5" ${common}/>`;
  else if (name === "Image") body = `<rect x="3" y="3" width="18" height="18" rx="2" ${common}/><circle cx="8.5" cy="8.5" r="1.5" ${common}/><path d="m21 15-5-5L5 21" ${common}/>`;
  else body = `<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" ${common}/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" ${common}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
}

function lineOptions(style: JsonObject, opacity: number) {
  const stroke = string(style.stroke) || string(style.color);
  // The stroke's own alpha counts: a glass card's rim is a quarter-opaque
  // white hairline, and drawn solid it reads as a drawn outline.
  return stroke
    ? { color: pptxColor(stroke), width: Math.max(0.5, number(style.strokeWidth, 1)), transparency: transparency(opacity, rgba(stroke).alpha) }
    : { color: "FFFFFF", transparency: 100 };
}

const NO_LINE = { color: "FFFFFF", transparency: 100 };

/**
 * A rectangle whose corners differ — a quarter disc, an arch, a leaf, a drop.
 * PowerPoint's preset rounded rectangle rounds every corner alike, so the
 * outline is drawn exactly, as one SVG picture in its fill or gradient and
 * with its outline. The corners are fitted the way CSS fits them, as the
 * phone and the web viewer do. Returns false for a shape the presets draw.
 */
function sweptShape(slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject): boolean {
  const list = style.borderRadiusCorners;
  if (!Array.isArray(list) || list.length !== 4 || string(style.shape) === "ellipse") return false;
  const raw = list.map((value) => Math.max(0, number(value, 0)));
  if (raw.every((value) => Math.abs(value - raw[0]!) < 0.5)) return false;
  const w = element.width;
  const h = element.height;
  const room = (side: number, sum: number) => (sum > 0 ? side / sum : Infinity);
  const scale = Math.min(1, room(w, raw[0]! + raw[1]!), room(w, raw[3]! + raw[2]!), room(h, raw[0]! + raw[3]!), room(h, raw[1]! + raw[2]!));
  const [tl, tr, br, bl] = raw.map((value) => +(value * scale).toFixed(3)) as [number, number, number, number];
  const d = `M ${tl} 0 H ${w - tr} A ${tr} ${tr} 0 0 1 ${w} ${tr} V ${h - br} A ${br} ${br} 0 0 1 ${w - br} ${h} `
    + `H ${bl} A ${bl} ${bl} 0 0 1 0 ${h - bl} V ${tl} A ${tl} ${tl} 0 0 1 ${tl} 0 Z`;
  const stops = Array.isArray(style.gradientStops) ? style.gradientStops.map((stop) => object(stop)) : [];
  let defs = "";
  let paint: string;
  if (stops.length >= 2) {
    const radians = (number(style.gradientAngle, 135) * Math.PI) / 180;
    const dx = Math.sin(radians) / 2;
    const dy = -Math.cos(radians) / 2;
    const marks = stops.map((stop) => {
      const tone = svgPaint(stop.color, "#000000");
      return `<stop offset="${number(stop.offset, 0)}%" stop-color="${tone.hex}" stop-opacity="${tone.alpha.toFixed(3)}"/>`;
    }).join("");
    defs = `<defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${marks}</linearGradient></defs>`;
    paint = `fill="url(#g)"`;
  } else {
    const tone = svgPaint(style.fill, "#EEEEEE");
    paint = `fill="${tone.hex}" fill-opacity="${tone.alpha.toFixed(3)}"`;
  }
  const outline = typeof style.stroke === "string"
    ? (() => {
      const tone = svgPaint(style.stroke, "#000000");
      return ` stroke="${tone.hex}" stroke-opacity="${tone.alpha.toFixed(3)}" stroke-width="${Math.max(0.5, number(style.strokeWidth, 1))}"`;
    })()
    : "";
  slide.addImage({
    data: svgData(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}<path d="${d}" ${paint}${outline}/></svg>`),
    ...frame(element),
    rotate: element.rotation,
    transparency: transparency(element.opacity),
  });
  return true;
}

function addShape(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject) {
  if (sweptShape(slide, element, style)) return;
  const position = frame(element);
  const stops = stopsOf(style);

  /**
   * Ellipses and radial light. PowerPoint has a radial fill but pptxgenjs does
   * not write one, so the light is drawn as nested translucent ellipses whose
   * alphas are solved to stack into the gradient (`radialBands`) — ten layers,
   * enough to fade smoothly and few enough to leave the file editable.
   */
  if (string(style.shape) === "ellipse" || string(style.gradientType) === "radial") {
    if (string(style.gradientType) === "radial" && stops.length >= 2) {
      for (const band of radialBands(stops, 10)) {
        const w = position.w * band.scale;
        const h = position.h * band.scale;
        slide.addShape(pptx.ShapeType.ellipse, {
          x: position.x + (position.w - w) / 2, y: position.y + (position.h - h) / 2, w, h,
          fill: { color: band.hex, transparency: transparency(element.opacity, band.alpha) },
          line: NO_LINE, rotate: element.rotation,
        });
      }
    } else {
      const fill = colorAt(stops, 0);
      if (fill.alpha > 0.002) {
        slide.addShape(pptx.ShapeType.ellipse, { ...position, fill: { color: fill.hex, transparency: transparency(element.opacity, fill.alpha) }, line: NO_LINE, rotate: element.rotation });
      }
    }
    if (style.stroke) slide.addShape(pptx.ShapeType.ellipse, { ...position, fill: { color: "FFFFFF", transparency: 100 }, line: lineOptions(style, element.opacity), rotate: element.rotation });
    return;
  }

  /**
   * A glass card: one rounded shape in the gradient's average colour, so it
   * stays a single editable card in PowerPoint, with its rim.
   */
  if (Array.isArray(style.gradientStops) && stops.length >= 2) {
    const radius = Math.min(number(style.borderRadius, 0), element.width / 2, element.height / 2);
    const average = averageColor(stops);
    slide.addShape(radius > 0.5 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
      ...position,
      ...(radius > 0.5 ? { rectRadius: inch(radius) } : {}),
      fill: { color: average.hex, transparency: transparency(element.opacity, average.alpha) },
      line: style.stroke ? lineOptions(style, element.opacity) : NO_LINE,
      rotate: element.rotation,
    });
    return;
  }

  const fill = string(style.fill, "#EEEEEE");
  const colorAlpha = Number.parseInt(fill.replace("#", "").slice(6, 8) || "ff", 16) / 255;
  const gradientTo = string(style.gradientTo);
  if (gradientTo) {
    const steps = 24;
    const angle = ((number(style.gradientAngle, 135) % 360) + 360) % 360;
    const vertical = angle >= 45 && angle < 135 || angle >= 225 && angle < 315;
    for (let index = 0; index < steps; index += 1) {
      slide.addShape(pptx.ShapeType.rect, {
        x: vertical ? position.x + position.w * index / steps : position.x,
        y: vertical ? position.y : position.y + position.h * index / steps,
        w: vertical ? position.w / steps + 0.002 : position.w,
        h: vertical ? position.h : position.h / steps + 0.002,
        fill: { color: interpolateHex(fill, gradientTo, index / (steps - 1)), transparency: transparency(element.opacity, colorAlpha) },
        line: NO_LINE,
        rotate: element.rotation,
      });
    }
    if (style.stroke) slide.addShape(pptx.ShapeType.rect, { ...position, fill: { color: "FFFFFF", transparency: 100 }, line: lineOptions(style, element.opacity), rotate: element.rotation });
    return;
  }

  const radius = number(style.borderRadius, 0);
  const circle = radius >= Math.min(element.width, element.height) / 2 - 1 && Math.abs(element.width - element.height) < 2;
  const shapeType = circle ? pptx.ShapeType.ellipse : radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
  slide.addShape(shapeType, {
    ...position,
    ...(radius > 0 && !circle ? { rectRadius: inch(Math.min(radius, element.width / 2, element.height / 2)) } : {}),
    fill: { color: pptxColor(fill, "#EEEEEE"), transparency: transparency(element.opacity, colorAlpha) },
    line: lineOptions(style, element.opacity),
    rotate: element.rotation,
    ...(boolean(style.shadow) ? { shadow: { type: "outer", color: "1A1030", opacity: 0.16, blur: 10, angle: 45, offset: 4 } } : {}),
  });
}

function addText(slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, content: JsonObject) {
  const color = string(style.color, "#151A18");
  const vertical = string(style.verticalAlign, "center");
  const alignment = string(style.textAlign, "left");
  const decoration = string(style.textDecoration);
  const text = applyTextTransform(string(content.text), style);
  slide.addText(text, {
    ...frame(element),
    margin: 0,
    fontFace: pptxFace(style),
    fontSize: fontPoints(number(style.fontSize, 30)),
    bold: isBold(style),
    italic: style.fontStyle === "italic",
    color: pptxColor(color),
    transparency: transparency(element.opacity),
    align: alignment === "center" || alignment === "right" ? alignment : "left",
    valign: vertical === "top" ? "top" : vertical === "bottom" ? "bottom" : "middle",
    charSpacing: Math.max(0, number(style.letterSpacing, 0) * 0.96),
    lineSpacing: Math.max(1, fontPoints(number(style.lineHeight, number(style.fontSize, 30) * 1.2))),
    rotate: element.rotation,
    fit: "shrink",
    breakLine: false,
    underline: boolean(style.underline) || decoration.includes("underline") ? { color: pptxColor(color), style: "sng" } : undefined,
    strike: boolean(style.strikethrough) || decoration.includes("line-through") ? "sngStrike" : undefined,
    ...(string(style.textEffect) === "shadow" ? { shadow: { type: "outer", color: "000000", opacity: 0.4, blur: 2, angle: 45, offset: 2 } } : {}),
  });
}

function addPlaceholder(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, label: string) {
  const position = frame(element);
  slide.addShape(pptx.ShapeType.roundRect, {
    ...position,
    fill: { color: "EFE9F9", transparency: transparency(element.opacity) },
    line: { color: "C9BAE6", width: 1.5, dashType: "dash", transparency: transparency(element.opacity) },
  });
  const size = Math.min(position.w, position.h) * 0.34;
  slide.addImage({
    data: svgData(iconSvg("Image", "8C7BB4")),
    x: position.x + (position.w - size) / 2,
    y: position.y + (position.h - size) / 2 - 0.08,
    w: size,
    h: size,
    transparency: transparency(element.opacity),
  });
  slide.addText(label, { x: position.x, y: position.y + position.h * 0.68, w: position.w, h: Math.min(0.3, position.h * 0.22), margin: 0, align: "center", fontSize: 9, color: "6C568F" });
}

function supportedImage(asset: ExportAsset): boolean {
  return asset.mimeType === "image/png" || asset.mimeType === "image/jpeg" || asset.mimeType === "image/svg+xml";
}

function addImage(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, asset: ExportAsset | null) {
  const kind = string(object(element.content).kind, "image");
  if (!asset || !supportedImage(asset)) {
    addPlaceholder(pptx, slide, element, kind === "video" ? "Video" : "Rasm");
    return;
  }
  const position = frame(element);
  const mode = string(style.objectFit, "cover") === "contain" ? "contain" : "cover";
  const radius = number(style.borderRadius, 0);
  slide.addImage({
    data: mimeDataUri(asset.bytes, asset.mimeType),
    ...position,
    sizing: { type: mode, ...position },
    rotate: element.rotation,
    transparency: transparency(element.opacity),
    rounding: radius >= Math.min(element.width, element.height) / 2 - 1 && Math.abs(element.width - element.height) < 2,
  });
}

function addLine(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject) {
  const color = string(style.color, "#151A18");
  slide.addShape(pptx.ShapeType.line, {
    x: inch(element.x),
    y: inch(element.y + element.height / 2),
    w: inch(element.width),
    h: 0,
    rotate: element.rotation,
    line: { color: pptxColor(color), width: Math.max(0.5, number(style.strokeWidth, Math.max(1, element.height))), transparency: transparency(element.opacity) },
  });
}

/** A colour as SVG wants it: `#RRGGBB` and, separately, its opacity. */
function svgPaint(value: unknown, fallback: string): { hex: string; alpha: number } {
  const parsed = rgba(value, fallback);
  const byte = (channel: number) => Math.round(channel * 255).toString(16).padStart(2, "0");
  return { hex: `#${byte(parsed.red)}${byte(parsed.green)}${byte(parsed.blue)}`, alpha: parsed.alpha };
}

/**
 * An icon the deck carries as outlines, as one SVG picture: its gradient as an
 * SVG gradient, its shadow as two faint offset copies under it. PowerPoint
 * draws SVG natively, so the slide keeps a sharp vector rather than a bitmap.
 * The picture is padded on every side so the shadow is not cut at its frame.
 */
function vectorIcon(style: JsonObject, content: JsonObject, size: number): { svg: string; pad: number } | null {
  const vector = object(content.vector);
  const paths = (Array.isArray(vector.paths) ? vector.paths : []).map((path) => object(path)).filter((path) => typeof path.d === "string" && path.d);
  if (!paths.length) return null;
  const box = number(vector.box, 256);
  const pad = box * 0.12;
  const glyph = (fill: string, opacity: number) => paths
    .map((path) => `<path d="${string(path.d)}" fill="${fill}" fill-opacity="${clamp(opacity * number(path.opacity, 1), 0, 1).toFixed(3)}"/>`)
    .join("");
  const stops = Array.isArray(style.gradientStops) ? style.gradientStops.map((stop) => object(stop)) : [];
  let defs = "";
  let fill: string;
  let alpha = 1;
  if (stops.length >= 2) {
    const radians = (number(style.gradientAngle, 135) * Math.PI) / 180;
    const dx = Math.sin(radians) / 2;
    const dy = -Math.cos(radians) / 2;
    const marks = stops.map((stop) => {
      const paint = svgPaint(stop.color, "#000000");
      return `<stop offset="${number(stop.offset, 0)}%" stop-color="${paint.hex}" stop-opacity="${paint.alpha.toFixed(3)}"/>`;
    }).join("");
    defs = `<defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${marks}</linearGradient></defs>`;
    fill = "url(#g)";
  } else {
    const paint = svgPaint(style.color, "#151A18");
    fill = paint.hex;
    alpha = paint.alpha;
  }
  const shadow = object(style.iconShadow);
  let under = "";
  if (typeof shadow.color === "string") {
    const tone = svgPaint(shadow.color, "#000000");
    const strength = number(shadow.opacity, 0.3);
    // Offsets are in slide points; the glyph's own units are `box` per its drawn size.
    const unit = box / Math.max(1, size);
    const sx = number(shadow.dx, 0) * unit;
    const sy = number(shadow.dy, 2) * unit;
    under = `<g transform="translate(${sx / 2} ${sy / 2})">${glyph(tone.hex, strength * 0.35)}</g><g transform="translate(${sx} ${sy})">${glyph(tone.hex, strength * 0.3)}</g>`;
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${box + pad * 2} ${box + pad * 2}">${defs}${under}${glyph(fill, alpha)}</svg>`,
    pad: pad / box,
  };
}

function addIcon(slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, content: JsonObject) {
  const size = Math.min(element.width, element.height);
  const drawn = vectorIcon(style, content, size);
  if (drawn) {
    // Centred in its frame and grown by the padding, so the glyph lands where it does on the phone.
    const grow = size * drawn.pad;
    slide.addImage({
      data: svgData(drawn.svg),
      x: inch(element.x + (element.width - size) / 2 - grow),
      y: inch(element.y + (element.height - size) / 2 - grow),
      w: inch(size + grow * 2),
      h: inch(size + grow * 2),
      rotate: element.rotation,
      transparency: transparency(element.opacity),
    });
    return;
  }
  slide.addImage({
    data: svgData(iconSvg(string(content.icon, "Sparkles"), pptxColor(style.color, "#151A18"))),
    ...frame(element),
    rotate: element.rotation,
    transparency: transparency(element.opacity),
  });
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, content: JsonObject) {
  const values = Array.isArray(content.values) ? content.values.map((value) => number(value, 0)).filter(Number.isFinite) : [];
  if (!values.length) return;
  const labels = Array.isArray(content.labels) ? content.labels.map((value) => String(value)) : values.map((_, index) => String(index + 1));
  const chartType = string(content.chartType, "bar");
  const type = chartType === "line" ? pptx.ChartType.line : chartType === "donut" ? pptx.ChartType.doughnut : pptx.ChartType.bar;
  const series = Array.isArray(style.series) ? style.series.filter((value): value is string => typeof value === "string").map((value) => pptxColor(value)) : [];
  slide.addChart(type, [{ name: "Ma’lumot", labels, values }], {
    ...frame(element),
    showTitle: false,
    showLegend: false,
    showValue: false,
    showCategoryName: false,
    showPercent: chartType === "donut",
    chartColors: series.length ? series : [pptxColor(style.color, "#173E35")],
    catAxisLabelColor: pptxColor(style.labelColor, "#777777"),
    valAxisLabelColor: pptxColor(style.labelColor, "#777777"),
    showBorder: false,
    showLeaderLines: false,
    ...(chartType === "bar" ? { barDir: "col", grouping: "clustered" } : {}),
    ...(chartType === "donut" ? { holeSize: 62 } : {}),
  });
}

function addTable(slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, content: JsonObject) {
  const rows = Array.isArray(content.rows)
    ? content.rows.filter(Array.isArray).slice(0, 20).map((row) => row.slice(0, 12).map((cell) => String(cell ?? "")))
    : [];
  if (!rows.length) return;
  slide.addTable(rows, {
    ...frame(element),
    margin: 3,
    fontFace: pptxFace(style),
    fontSize: Math.max(6, fontPoints(number(style.fontSize, 12))),
    color: pptxColor(style.color, "#151A18"),
    border: { type: "solid", color: pptxColor(style.stroke, "#C9D2CF"), pt: Math.max(0.5, number(style.strokeWidth, 0.75)) },
    fill: pptxColor(style.fill, "#FFFFFF"),
    valign: "middle",
    autoPage: false,
  });
}

async function pptxBytes(pptx: PptxGenJS): Promise<Uint8Array> {
  const output = await pptx.write({ outputType: "uint8array", compression: true });
  if (output instanceof Uint8Array) return output;
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  if (output instanceof Blob) return new Uint8Array(await output.arrayBuffer());
  throw new Error("PowerPoint generator returned an unsupported output type");
}

/**
 * A tiny one-slide package used as a standards-compliant donor when an
 * imported PowerPoint template needs the mandatory editable chart added to
 * one of its cloned pages. The cloner copies the chart, its relationship and
 * its embedded workbook; generating those OOXML parts here avoids hand-writing
 * a second chart serializer.
 */
export async function renderChartPptx(element: ExportElement): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Jaxongirman";
  const slide = pptx.addSlide();
  const style = object(element.style);
  slide.addShape(pptx.ShapeType.roundRect, {
    ...frame(element),
    fill: { color: pptxColor(style.fill, "FFFFFF") },
    line: { color: pptxColor(style.axisColor, "D7DEDB"), width: 0.75 },
  });
  addChart(pptx, slide, element, style, object(element.content));
  return pptxBytes(pptx);
}

export async function renderPptx(deck: ExportDeck, assets: ExportAssetLoader): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Jaxongirman";
  pptx.company = "Jaxongirman";
  pptx.subject = deck.presentation.title;
  pptx.title = deck.presentation.title;
  pptx.lang = "uz-UZ";

  for (const sourceSlide of deck.slides) {
    const slide = pptx.addSlide();
    const ground = object(sourceSlide.background);
    slide.background = { color: pptxColor(ground.color, "#FFFFFF") };
    // A gradient ground, as strips behind everything: PowerPoint's own
    // background gradient is not something pptxgenjs can write.
    if (Array.isArray(ground.gradientStops) && ground.gradientStops.length >= 2) {
      const stops = stopsOf(ground, "#FFFFFF");
      for (const band of linearBands(stops, number(ground.gradientAngle, 135), 20)) {
        const from = band.reverse ? 1 - band.to : band.from;
        const to = band.reverse ? 1 - band.from : band.to;
        slide.addShape(pptx.ShapeType.rect, band.vertical
          ? { x: inch(1000 * from), y: 0, w: inch(1000 * (to - from)) + 0.01, h: inch(562.5), fill: { color: band.hex }, line: NO_LINE }
          : { x: 0, y: inch(562.5 * from), w: inch(1000), h: inch(562.5 * (to - from)) + 0.01, fill: { color: band.hex }, line: NO_LINE });
      }
    }
    const elements = deck.elements.filter((element) => element.slide_id === sourceSlide.id).sort((left, right) => left.z_index - right.z_index);
    for (const element of elements) {
      const style = object(element.style);
      const content = object(element.content);
      if (element.type === "shape") addShape(pptx, slide, element, style);
      else if (element.type === "text") addText(slide, element, style, content);
      else if (element.type === "image") addImage(pptx, slide, element, style, await assets.forElement(element));
      else if (element.type === "line") addLine(pptx, slide, element, style);
      else if (element.type === "icon") addIcon(slide, element, style, content);
      else if (element.type === "chart") addChart(pptx, slide, element, style, content);
      else if (element.type === "table") addTable(slide, element, style, content);
    }
  }

  return pptxBytes(pptx);
}

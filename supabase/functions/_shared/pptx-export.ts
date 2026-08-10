import PptxGenJS from "pptxgenjs";

import { ExportAssetLoader, type ExportAsset } from "./export-assets.ts";
import {
  applyTextTransform,
  boolean,
  bytesToBase64,
  clamp,
  fontFace,
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
  return stroke
    ? { color: pptxColor(stroke), width: Math.max(0.5, number(style.strokeWidth, 1)), transparency: transparency(opacity) }
    : { color: "FFFFFF", transparency: 100 };
}

function addShape(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject) {
  const position = frame(element);
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
        line: { color: "FFFFFF", transparency: 100 },
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
    fontFace: fontFace(style.fontFamily),
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

function addIcon(slide: PptxGenJS.Slide, element: ExportElement, style: JsonObject, content: JsonObject) {
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
    fontFace: fontFace(style.fontFamily),
    fontSize: Math.max(6, fontPoints(number(style.fontSize, 12))),
    color: pptxColor(style.color, "#151A18"),
    border: { type: "solid", color: pptxColor(style.stroke, "#C9D2CF"), pt: Math.max(0.5, number(style.strokeWidth, 0.75)) },
    fill: pptxColor(style.fill, "#FFFFFF"),
    valign: "middle",
    autoPage: false,
  });
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
    slide.background = { color: pptxColor(object(sourceSlide.background).color, "#FFFFFF") };
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

  const output = await pptx.write({ outputType: "uint8array", compression: true });
  if (output instanceof Uint8Array) return output;
  if (output instanceof ArrayBuffer) return new Uint8Array(output);
  if (output instanceof Blob) return new Uint8Array(await output.arrayBuffer());
  throw new Error("PowerPoint generator returned an unsupported output type");
}

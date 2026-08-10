import fontkit from "@pdf-lib/fontkit";
import {
  clip,
  degrees,
  endPath,
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
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
  interpolateHex,
  isBold,
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

const REGULAR_FONT_URL = "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/400Regular/Manrope_400Regular.ttf";
const BOLD_FONT_URL = "https://unpkg.com/@expo-google-fonts/manrope@0.4.2/700Bold/Manrope_700Bold.ttf";

type Fonts = { regular: PDFFont; bold: PDFFont; custom: boolean };

let fontBytesPromise: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("PDF font download failed");
  return new Uint8Array(await response.arrayBuffer());
}

function fontBytes(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  fontBytesPromise ??= Promise.all([
    fetchFont(Deno.env.get("PDF_FONT_REGULAR_URL") ?? REGULAR_FONT_URL),
    fetchFont(Deno.env.get("PDF_FONT_BOLD_URL") ?? BOLD_FONT_URL),
  ]).then(([regular, bold]) => ({ regular, bold }));
  return fontBytesPromise;
}

async function embedFonts(pdf: PDFDocument): Promise<Fonts> {
  try {
    pdf.registerFontkit(fontkit);
    const bytes = await fontBytes();
    return {
      regular: await pdf.embedFont(bytes.regular, { subset: true }),
      bold: await pdf.embedFont(bytes.bold, { subset: true }),
      custom: true,
    };
  } catch {
    return {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold),
      custom: false,
    };
  }
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

function drawShape(page: PDFPage, element: ExportElement, style: JsonObject) {
  const y = MODEL_HEIGHT - element.y - element.height;
  const fill = pdfColor(style.fill, "#EEEEEE");
  const stroke = style.stroke ? pdfColor(style.stroke, "#000000") : null;
  const opacity = clamp(element.opacity * fill.alpha, 0, 1);
  const gradientTo = string(style.gradientTo);
  if (gradientTo) {
    const steps = 28;
    const angle = ((number(style.gradientAngle, 135) % 360) + 360) % 360;
    const vertical = angle >= 45 && angle < 135 || angle >= 225 && angle < 315;
    for (let index = 0; index < steps; index += 1) {
      const color = pdfColor(`#${interpolateHex(style.fill, gradientTo, index / (steps - 1))}`).color;
      page.drawRectangle(vertical
        ? { x: element.x + element.width * index / steps, y, width: element.width / steps + 0.5, height: element.height, color, opacity }
        : { x: element.x, y: y + element.height * index / steps, width: element.width, height: element.height / steps + 0.5, color, opacity });
    }
  } else {
    page.drawRectangle({
      x: element.x,
      y,
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
      y,
      width: element.width,
      height: element.height,
      borderColor: stroke.color,
      borderWidth: Math.max(0.5, number(style.strokeWidth, 1)),
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

function drawText(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject, fonts: Fonts) {
  const font = isBold(style) ? fonts.bold : fonts.regular;
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
    page.pushOperators(
      pushGraphicsState(),
      rectangle(element.x, y, element.width, element.height),
      clip(),
      endPath(),
    );
  }
  page.drawImage(image, { x, y: drawY, width, height, opacity: element.opacity, rotate: degrees(element.rotation) });
  if (mode !== "contain") page.pushOperators(popGraphicsState());
}

function drawIcon(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject) {
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

function drawChart(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject) {
  const values = Array.isArray(content.values) ? content.values.map((value) => number(value, 0)).filter((value) => Number.isFinite(value)) : [];
  if (!values.length) return;
  const colors = seriesColors(style);
  const primary = string(style.color, "#173E35");
  const type = string(content.chartType, "bar");
  const max = Math.max(...values.map(Math.abs), 1);
  const baseY = MODEL_HEIGHT - element.y - element.height;
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
  const gap = element.width / Math.max(8, values.length * 4);
  const width = Math.max(1, (element.width - gap * (values.length - 1)) / values.length);
  values.forEach((value, index) => {
    const height = Math.max(2, Math.abs(value) / max * element.height * 0.92);
    page.drawRectangle({
      x: element.x + index * (width + gap),
      y: baseY,
      width,
      height,
      color: pdfColor(colors[index % Math.max(1, colors.length)] ?? primary).color,
      opacity: element.opacity,
    });
  });
}

function drawTable(page: PDFPage, element: ExportElement, style: JsonObject, content: JsonObject, fonts: Fonts) {
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
      font: fonts.regular,
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
  const fonts = await embedFonts(pdf);

  for (const slide of deck.slides) {
    const page = pdf.addPage([MODEL_WIDTH, MODEL_HEIGHT]);
    const background = object(slide.background);
    const backgroundColor = pdfColor(background.color, "#FFFFFF");
    page.drawRectangle({ x: 0, y: 0, width: MODEL_WIDTH, height: MODEL_HEIGHT, color: backgroundColor.color, opacity: backgroundColor.alpha });
    const elements = deck.elements.filter((element) => element.slide_id === slide.id).sort((left, right) => left.z_index - right.z_index);
    for (const element of elements) {
      const style = object(element.style);
      const content = object(element.content);
      if (element.type === "shape") drawShape(page, element, style);
      else if (element.type === "line") drawLine(page, element, style);
      else if (element.type === "text") drawText(page, element, style, content, fonts);
      else if (element.type === "image") await drawImage(page, pdf, element, style, await assets.forElement(element));
      else if (element.type === "icon") drawIcon(page, element, style, content);
      else if (element.type === "chart") drawChart(page, element, style, content);
      else if (element.type === "table") drawTable(page, element, style, content, fonts);
    }
  }

  // Keep page dictionaries as regular indirect objects. Besides making the
  // artifact easier for common PDF validators to inspect, this avoids clients
  // that still have incomplete PDF 1.5 object-stream support.
  return await pdf.save({ useObjectStreams: false });
}

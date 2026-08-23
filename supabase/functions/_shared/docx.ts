/**
 * Writing a Word document, in the amount of OOXML a real document needs.
 *
 * There was no DOCX writer here, and the products that need one — an
 * obyektivka, a referat, a course paper — all need the same handful of things:
 * a page set up the way an office expects, paragraphs that can be centred or
 * bold, tables with and without borders, a photograph in a fixed place, and a
 * page break. Not a library; those things.
 *
 * The alternative was to render a PDF and call it a document. A PDF is not a
 * document to the person who has to change one line of it before handing it in,
 * and "editable" is most of why anybody asks for DOCX. So this produces a file
 * Word opens, edits and repaginates like any other.
 *
 * Units are the ones OOXML uses, converted at the edge rather than carried
 * around: twips for the page and tables (1/20 point), half-points for type,
 * EMU for images. Every one of those has bitten somebody who assumed points.
 */

import { zip, type ZipFile } from "./zip.ts";

const encoder = new TextEncoder();

/** Twips per centimetre: 1440 per inch, 2.54 cm per inch. */
export const TWIPS_PER_CM = 1440 / 2.54;
/** English Metric Units per centimetre, which is what a drawing extent wants. */
export const EMU_PER_CM = 914400 / 2.54;

export const cmToTwips = (value: number): number => Math.round(value * TWIPS_PER_CM);
export const cmToEmu = (value: number): number => Math.round(value * EMU_PER_CM);

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Points. Falls back to the document's own size. */
  size?: number;
};

export type Paragraph = {
  runs: Run[];
  align?: "left" | "center" | "right" | "both";
  /** Points of space after. */
  spaceAfter?: number;
  /** Multiple of single spacing — 1.5 is what an Uzbek academic paper wants. */
  lineSpacing?: number;
  /** First-line indent, centimetres. */
  indent?: number;
  /** `Heading1`…`Heading3`, so Word's navigator and any table of contents work. */
  style?: "Heading1" | "Heading2" | "Heading3";
  pageBreakBefore?: boolean;
};

export type Cell = {
  blocks: Block[];
  /** Twips. Columns without one share what is left. */
  width?: number;
  /** How many columns this cell spans. */
  span?: number;
  align?: "top" | "center" | "bottom";
  shade?: string;
};

export type Table = {
  rows: { cells: Cell[]; header?: boolean }[];
  borders: boolean;
  /** Twips. Defaults to the full text width. */
  width?: number;
};

export type ImageBlock = {
  /** Which image, by the order it was given to `buildDocx`. */
  index: number;
  widthCm: number;
  heightCm: number;
  align?: "left" | "center" | "right";
};

export type Block =
  | ({ kind: "paragraph" } & Paragraph)
  | ({ kind: "table" } & Table)
  | ({ kind: "image" } & ImageBlock);

export const paragraph = (runs: Run[] | string, options: Omit<Paragraph, "runs"> = {}): Block => ({
  kind: "paragraph",
  runs: typeof runs === "string" ? [{ text: runs }] : runs,
  ...options,
});

export const table = (options: Table): Block => ({ kind: "table", ...options });
export const image = (options: ImageBlock): Block => ({ kind: "image", ...options });

/* ------------------------------------------------------------------ runs */

function runXml(run: Run, defaults: { font: string; size: number }): string {
  const properties = [
    `<w:rFonts w:ascii="${escapeXml(run.text ? defaults.font : defaults.font)}" w:hAnsi="${escapeXml(defaults.font)}" w:cs="${escapeXml(defaults.font)}"/>`,
    run.bold ? "<w:b/>" : "",
    run.italic ? "<w:i/>" : "",
    run.underline ? '<w:u w:val="single"/>' : "",
    `<w:sz w:val="${Math.round((run.size ?? defaults.size) * 2)}"/>`,
    `<w:szCs w:val="${Math.round((run.size ?? defaults.size) * 2)}"/>`,
  ].join("");

  // A line break inside a run is `<w:br/>`, not a newline: OOXML collapses
  // whitespace exactly as XML does.
  const text = run.text.split("\n").map((line, index) =>
    `${index === 0 ? "" : "<w:br/>"}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("");

  return `<w:r><w:rPr>${properties}</w:rPr>${text}</w:r>`;
}

function paragraphXml(block: Paragraph, defaults: { font: string; size: number }): string {
  const properties = [
    block.style ? `<w:pStyle w:val="${block.style}"/>` : "",
    block.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
    block.align ? `<w:jc w:val="${block.align}"/>` : "",
    block.indent ? `<w:ind w:firstLine="${cmToTwips(block.indent)}"/>` : "",
    block.lineSpacing
      // 240 twentieths of a line is single; `auto` lets Word do the arithmetic.
      ? `<w:spacing w:line="${Math.round(block.lineSpacing * 240)}" w:lineRule="auto"${block.spaceAfter ? ` w:after="${Math.round(block.spaceAfter * 20)}"` : ' w:after="0"'}/>`
      : `<w:spacing w:after="${Math.round((block.spaceAfter ?? 0) * 20)}"/>`,
  ].join("");

  const runs = block.runs.length > 0 ? block.runs.map((run) => runXml(run, defaults)).join("") : "";
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${runs}</w:p>`;
}

/* ---------------------------------------------------------------- tables */

const NO_BORDER = '<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/>'
  + '<w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/>'
  + '<w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>';

const BORDER = '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/>'
  + '<w:left w:val="single" w:sz="8" w:color="000000"/>'
  + '<w:bottom w:val="single" w:sz="8" w:color="000000"/>'
  + '<w:right w:val="single" w:sz="8" w:color="000000"/>'
  + '<w:insideH w:val="single" w:sz="8" w:color="000000"/>'
  + '<w:insideV w:val="single" w:sz="8" w:color="000000"/></w:tblBorders>';

function tableXml(block: Table, defaults: { font: string; size: number }, textWidth: number): string {
  const width = block.width ?? textWidth;
  const columns = Math.max(1, ...block.rows.map((row) => row.cells.reduce((sum, cell) => sum + (cell.span ?? 1), 0)));
  const even = Math.floor(width / columns);

  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${even}"/>`).join("");

  const rows = block.rows.map((row) => {
    const cells = row.cells.map((cell) => {
      const properties = [
        `<w:tcW w:w="${cell.width ?? even * (cell.span ?? 1)}" w:type="dxa"/>`,
        cell.span && cell.span > 1 ? `<w:gridSpan w:val="${cell.span}"/>` : "",
        cell.align && cell.align !== "top" ? `<w:vAlign w:val="${cell.align}"/>` : "",
        cell.shade ? `<w:shd w:val="clear" w:fill="${cell.shade.replace("#", "")}"/>` : "",
      ].join("");
      // A cell must hold at least one paragraph; Word refuses to open one that
      // does not, with a message that names the file rather than the cell.
      const blocks = cell.blocks.length > 0 ? cell.blocks : [paragraph("")];
      return `<w:tc><w:tcPr>${properties}</w:tcPr>${blocks.map((inner) => blockXml(inner, defaults, width)).join("")}</w:tc>`;
    }).join("");
    // A header row repeats when the table breaks across pages, which is the
    // difference between a table and a list of rows.
    return `<w:tr>${row.header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells}</w:tr>`;
  }).join("");

  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/>`
    + `<w:jc w:val="center"/>${block.borders ? BORDER : NO_BORDER}`
    + `<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>`
    + `<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>`
    + `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

/* ---------------------------------------------------------------- images */

function imageXml(block: ImageBlock): string {
  const id = block.index + 1;
  const width = cmToEmu(block.widthCm);
  const height = cmToEmu(block.heightCm);

  return `<w:p><w:pPr><w:jc w:val="${block.align ?? "center"}"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing>`
    + `<wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Rasm ${id}"/>`
    + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
    + `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="Rasm ${id}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="rIdImage${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function blockXml(block: Block, defaults: { font: string; size: number }, textWidth: number): string {
  if (block.kind === "paragraph") return paragraphXml(block, defaults);
  if (block.kind === "table") return tableXml(block, defaults, textWidth);
  return imageXml(block);
}

/* -------------------------------------------------------------- document */

export type DocxImage = { bytes: Uint8Array; extension: "png" | "jpeg" };

export type DocxOptions = {
  blocks: Block[];
  images?: DocxImage[];
  /** Times New Roman 14 is what an Uzbek academic document is set in. */
  font?: string;
  fontSize?: number;
  page?: { widthCm: number; heightCm: number; marginCm: { top: number; right: number; bottom: number; left: number } };
  title?: string;
};

/** A4 with the margins a submitted document is expected to have. */
const A4 = {
  widthCm: 21,
  heightCm: 29.7,
  marginCm: { top: 2, right: 1.5, bottom: 2, left: 3 },
};

export async function buildDocx(options: DocxOptions): Promise<Uint8Array> {
  const defaults = { font: options.font ?? "Times New Roman", size: options.fontSize ?? 14 };
  const page = options.page ?? A4;
  const images = options.images ?? [];
  const textWidth = cmToTwips(page.widthCm - page.marginCm.left - page.marginCm.right);

  const body = options.blocks.map((block) => blockXml(block, defaults, textWidth)).join("");

  const section = `<w:sectPr>`
    + `<w:pgSz w:w="${cmToTwips(page.widthCm)}" w:h="${cmToTwips(page.heightCm)}"/>`
    + `<w:pgMar w:top="${cmToTwips(page.marginCm.top)}" w:right="${cmToTwips(page.marginCm.right)}"`
    + ` w:bottom="${cmToTwips(page.marginCm.bottom)}" w:left="${cmToTwips(page.marginCm.left)}"`
    + ` w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}${section}</w:body></w:document>`;

  /**
   * Heading styles, so Word's navigator works and a table of contents can be
   * generated by the person rather than faked by us.
   */
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${escapeXml(defaults.font)}" w:hAnsi="${escapeXml(defaults.font)}"/><w:sz w:val="${defaults.size * 2}"/></w:rPr></w:rPrDefault></w:docDefaults>
${[1, 2, 3].map((level) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${level - 1}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${(defaults.size + (4 - level) * 2) * 2}"/></w:rPr></w:style>`).join("")}
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

  const imageRels = images.map((picture, index) =>
    `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index + 1}.${picture.extension}"/>`).join("");

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imageRels}</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const extensions = [...new Set(images.map((picture) => picture.extension))];
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${extensions.map((extension) => `<Default Extension="${extension}" ContentType="image/${extension}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

  const files: ZipFile[] = [
    { name: "[Content_Types].xml", bytes: encoder.encode(contentTypes) },
    { name: "_rels/.rels", bytes: encoder.encode(rootRels) },
    { name: "word/document.xml", bytes: encoder.encode(document) },
    { name: "word/styles.xml", bytes: encoder.encode(styles) },
    { name: "word/_rels/document.xml.rels", bytes: encoder.encode(documentRels) },
  ];
  images.forEach((picture, index) => {
    files.push({ name: `word/media/image${index + 1}.${picture.extension}`, bytes: picture.bytes });
  });

  return await zip(files);
}

/**
 * A minimal XLSX writer.
 *
 * An .xlsx file is a ZIP of a handful of XML parts, and Deno already ships the
 * one hard piece — raw DEFLATE via CompressionStream. Writing the container by
 * hand costs about a hundred lines and buys a spreadsheet export with no third
 * party in the dependency graph of a function that handles survey answers.
 *
 * Strings are written inline rather than through a shared-string table: exports
 * are read once and thrown away, so the table's size win is not worth the extra
 * part to keep consistent.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type ZipEntry = { name: string; data: Uint8Array };

/** A ZIP archive with every entry DEFLATE-compressed. No directory entries. */
async function zip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const compressed = await deflateRaw(entry.data);
    const checksum = crc32(entry.data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    // Bit 11 marks the filename as UTF-8, which costs nothing and keeps a
    // non-ASCII sheet name from being mojibake in a strict reader.
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    const localBlock = new Uint8Array(30 + nameBytes.length + compressed.length);
    localBlock.set(new Uint8Array(local.buffer), 0);
    localBlock.set(nameBytes, 30);
    localBlock.set(compressed, 30 + nameBytes.length);
    locals.push(localBlock);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, compressed.length, true);
    central.setUint32(24, entry.data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);

    const centralBlock = new Uint8Array(46 + nameBytes.length);
    centralBlock.set(new Uint8Array(central.buffer), 0);
    centralBlock.set(nameBytes, 46);
    centrals.push(centralBlock);

    offset += localBlock.length;
  }

  const centralSize = centrals.reduce((total, block) => total + block.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const block of locals) { output.set(block, cursor); cursor += block.length; }
  for (const block of centrals) { output.set(block, cursor); cursor += block.length; }
  output.set(new Uint8Array(end.buffer), cursor);
  return output;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;")
    // Control characters are illegal in XML 1.0 and would make Excel refuse the
    // whole file; a survey answer pasted from elsewhere can contain them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function columnName(index: number): string {
  let name = "";
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

export type CellValue = string | number | null;

/** Builds a single-sheet workbook. Numbers stay numeric; everything else is text. */
export async function buildXlsx(sheetName: string, rows: readonly (readonly CellValue[])[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === "") return "";
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const widths = rows[0]?.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="26" customWidth="1"/>`).join("") ?? "";

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  return await zip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) },
  ]);
}

/**
 * RFC 4180 with a UTF-8 BOM and CRLF line endings — the combination Excel needs
 * to open a Cyrillic- or O‘zbek-bearing CSV without mangling it.
 */
export function buildCsv(rows: readonly (readonly CellValue[])[]): Uint8Array {
  const body = rows
    .map((row) => row.map((value) => {
      if (value === null) return "";
      const text = String(value);
      return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }).join(","))
    .join("\r\n");
  return new TextEncoder().encode(`\uFEFF${body}\r\n`);
}

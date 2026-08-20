/**
 * Writing a ZIP, so a `.pptx` can be rebuilt from parts that were never parsed.
 *
 * The point of this file is what it lets the caller avoid. A cloned slide has
 * to keep its namespaces, its extension lists, its shape ids and every
 * attribute PowerPoint wrote for its own reasons — and a parse-and-serialise
 * round trip loses whichever of those the parser did not know to keep. So the
 * cloner edits the original bytes in place and hands them here unexamined.
 *
 * Deflated where the runtime can, stored where it cannot. Both are ZIP, both
 * open in PowerPoint; the difference is file size, which is not worth a
 * dependency or a failure.
 */

export type ZipFile = { name: string; bytes: Uint8Array };

const encoder = new TextEncoder();

/** CRC-32, the checksum every ZIP entry carries. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      // The reversed polynomial, applied a bit at a time. A table would be
      // faster and this runs over a few megabytes once per export.
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    // A "compressed" form that grew is a worse copy of the same bytes.
    return packed.byteLength < bytes.byteLength ? packed : null;
  } catch {
    return null;
  }
}

/**
 * Builds a ZIP from files given in order.
 *
 * Order is the caller's: `[Content_Types].xml` conventionally comes first and
 * some readers are happier for it, so nothing here sorts.
 */
export async function zip(files: readonly ZipFile[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const sum = crc32(file.bytes);
    const packed = await deflate(file.bytes);
    const stored = packed ?? file.bytes;
    const method = packed ? 8 : 0;

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, method, true);
    header.setUint32(14, sum, true);
    header.setUint32(18, stored.byteLength, true);
    header.setUint32(22, file.bytes.byteLength, true);
    header.setUint16(26, name.byteLength, true);
    chunks.push(new Uint8Array(header.buffer), name, stored);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, method, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, stored.byteLength, true);
    entry.setUint32(24, file.bytes.byteLength, true);
    entry.setUint16(28, name.byteLength, true);
    entry.setUint32(42, offset, true);
    directory.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.byteLength + stored.byteLength;
  }

  const directoryAt = offset;
  let directorySize = 0;
  for (const part of directory) { chunks.push(part); directorySize += part.byteLength; }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, directoryAt, true);
  chunks.push(new Uint8Array(end.buffer));

  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

/**
 * A minimal ZIP reader — the mirror of the writer in `xlsx.ts`.
 *
 * Deno ships the one hard piece, raw INFLATE via DecompressionStream, so
 * reading the container by hand is a page of header arithmetic and buys .pptx
 * import without adding a third party to the dependency graph of a function
 * whose whole job is opening a file a stranger uploaded.
 *
 * Sizes and offsets come from the central directory rather than the local
 * headers. A writer that streams its output is allowed to leave the local sizes
 * zero and put them in a descriptor after the data, and PowerPoint's own writer
 * sometimes does; the central directory is the one place always filled in.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * Ceilings for a hostile archive.
 *
 * The uploaded file is capped at 50 MB by the bucket, which says nothing about
 * what it expands to: a few kilobytes of nested DEFLATE can claim to be
 * terabytes. Every entry is checked against what the directory *claims* before
 * it is inflated, and the running total is checked as we go, so a bomb is
 * refused rather than merely surviving.
 */
const MAX_ENTRIES = 2048;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // The cast is a disagreement between two type libraries, not a doubt about the
  // value: `BlobPart` is declared over `ArrayBuffer` while a `Uint8Array` is
  // declared over `ArrayBufferLike`, which also admits `SharedArrayBuffer`. Deno
  // accepts it as written and the DOM lib does not, and this file has to compile
  // under both for its callers to be testable off Deno.
  const stream = new Blob([bytes as unknown as BlobPart]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Every entry in the archive, keyed by its path within it. */
export type ZipEntries = Map<string, Uint8Array>;

export class ZipError extends Error {}

/** Scans back from the end for the end-of-central-directory record. */
function endOfCentralDirectory(view: DataView): number {
  // 22 bytes of record, then a comment of up to 0xffff that we have to scan past.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let at = view.byteLength - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  throw new ZipError("Fayl ZIP arxivi emas.");
}

/**
 * Reads every entry of a ZIP archive into memory.
 *
 * Entry names are returned exactly as stored and are only ever used as keys —
 * nothing here touches the filesystem, so a name like `../../etc/passwd` is
 * inert rather than something to sanitise.
 */
export async function unzip(bytes: Uint8Array): Promise<ZipEntries> {
  if (bytes.byteLength < 22) throw new ZipError("Fayl ZIP arxivi emas.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = endOfCentralDirectory(view);

  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryAt = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryAt === 0xffffffff || directorySize === 0xffffffff) {
    throw new ZipError("ZIP64 arxivlari qo‘llab-quvvatlanmaydi.");
  }
  if (count > MAX_ENTRIES) throw new ZipError("Arxivda juda ko‘p fayl bor.");
  if (directoryAt + directorySize > bytes.byteLength) throw new ZipError("Arxiv katalogi buzilgan.");

  const decoder = new TextDecoder();
  const entries: ZipEntries = new Map();
  let cursor = directoryAt;
  let total = 0;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError("Arxiv katalogi buzilgan.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localAt = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // Directory markers carry no data and are the one thing we can skip whole.
    if (name.endsWith("/")) continue;

    total += uncompressedSize;
    if (total > MAX_TOTAL_BYTES) throw new ZipError("Arxiv ochilganda juda katta bo‘lib ketadi.");

    if (localAt + 30 > bytes.byteLength || view.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new ZipError(`Arxivdagi "${name}" yozuvi buzilgan.`);
    }
    // The local header repeats the name and extra fields, and its lengths are
    // allowed to differ from the directory's — so they are read again here
    // rather than reused.
    const localNameLength = view.getUint16(localAt + 26, true);
    const localExtraLength = view.getUint16(localAt + 28, true);
    const dataAt = localAt + 30 + localNameLength + localExtraLength;
    if (dataAt + compressedSize > bytes.byteLength) throw new ZipError(`Arxivdagi "${name}" yozuvi buzilgan.`);

    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) {
      entries.set(name, raw);
      continue;
    }
    if (method !== 8) throw new ZipError(`"${name}" tanish bo‘lmagan usulda siqilgan.`);

    const inflated = await inflateRaw(raw);
    // The directory's promise is what the ceiling above was checked against, so
    // a lie here has to be caught rather than trusted.
    if (inflated.byteLength !== uncompressedSize) {
      throw new ZipError(`Arxivdagi "${name}" yozuvi e'lon qilingan hajmga mos kelmadi.`);
    }
    entries.set(name, inflated);
  }

  return entries;
}

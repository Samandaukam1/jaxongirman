/** Pure validation used by the Telegram downloader and its Node tests. */

export const IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 40_000_000;
export const IMAGE_MAX_DIMENSION = 16_000;
export const IMAGE_MIN_DIMENSION = 64;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "instance-data.ec2.internal",
  "169.254.169.254",
  "100.100.100.200",
]);

function ipv4Parts(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255
    || (String(part) !== parts[index] && !(part === 0 && /^0+$/.test(parts[index] ?? ""))))) return null;
  return numbers;
}

/** True for an address a server-side image fetch must never reach. */
export function isBlockedIp(input: string): boolean {
  const value = input.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)?.[1];
  const v4 = ipv4Parts(mapped ?? value);
  if (v4) {
    const [a, b] = v4;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b! >= 64 && b! <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || a! >= 224;
  }

  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return true;
  const first = Number.parseInt(value.split(":")[0] || "0", 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link local
    || (first & 0xff00) === 0xff00; // multicast
}

/** Syntax and hostname checks before DNS, repeated after every redirect. */
export function safeRemoteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("invalid_image_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsupported_image_protocol");
  if (url.username || url.password) throw new Error("image_url_credentials_forbidden");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("image_url_port_forbidden");

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || BLOCKED_HOSTS.has(host)
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".lan")
    || isBlockedIp(host)) {
    throw new Error("private_image_host_forbidden");
  }
  return url;
}

export type ValidatedImage = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
};

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (bytes: Uint8Array, at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
const u16le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8);
const u24le = (bytes: Uint8Array, at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let at = 2;
  while (at + 4 <= bytes.length) {
    while (at < bytes.length && bytes[at] !== 0xff) at += 1;
    while (at < bytes.length && bytes[at] === 0xff) at += 1;
    if (at >= bytes.length) break;
    const marker = bytes[at++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (at + 2 > bytes.length) break;
    const length = u16be(bytes, at);
    if (length < 2 || at + length > bytes.length) return null;
    if (frames.has(marker) && length >= 7) {
      return { height: u16be(bytes, at + 3), width: u16be(bytes, at + 5) };
    }
    at += length;
  }
  return null;
}

function dimensions(bytes: Uint8Array): ValidatedImage | null {
  if (bytes.length >= 24
    && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG"
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && ascii(bytes, 12, 4) === "IHDR"
    && bytes.length >= 45
    && ascii(bytes, bytes.length - 8, 4) === "IEND") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mimeType: "image/png", extension: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }

  const jpeg = jpegDimensions(bytes);
  if (jpeg && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return { mimeType: "image/jpeg", extension: "jpg", ...jpeg };
  }

  if (bytes.length >= 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length) {
    const kind = ascii(bytes, 12, 4);
    if (kind === "VP8X") {
      return { mimeType: "image/webp", extension: "webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
    }
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mimeType: "image/webp", extension: "webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (kind === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
      const width = 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
      const height = 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10));
      return { mimeType: "image/webp", extension: "webp", width, height };
    }
  }
  return null;
}

/** Magic bytes and actual dimensions, not the remote server's declaration. */
export function validateImageBytes(bytes: Uint8Array, declaredMime: string | null): ValidatedImage {
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) throw new Error("image_size_invalid");
  const found = dimensions(bytes);
  if (!found) throw new Error("broken_or_unsupported_image");
  const declared = (declaredMime ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== found.mimeType) {
    throw new Error("image_content_type_mismatch");
  }
  if (found.width < IMAGE_MIN_DIMENSION || found.height < IMAGE_MIN_DIMENSION
    || found.width > IMAGE_MAX_DIMENSION || found.height > IMAGE_MAX_DIMENSION
    || found.width * found.height > IMAGE_MAX_PIXELS) {
    throw new Error("image_dimensions_invalid");
  }
  return found;
}

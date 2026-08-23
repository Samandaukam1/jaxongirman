/**
 * Working out what a picked image actually is, before it is uploaded.
 *
 * Avatar uploads failed with "mime type text/plain is not supported", which is
 * a strange sentence to meet when the file is a photograph. Two things caused
 * it and neither is visible in the line that fails.
 *
 * The upload passed a `Blob` built by `fetch(asset.uri).blob()`. On React
 * Native that Blob carries no useful `type` — the runtime does not sniff a
 * `file://` URI — so it arrives as `text/plain` or as nothing. And a Blob body
 * is sent by supabase-js as multipart, where the part's content type comes from
 * `blob.type` rather than from the `contentType` option beside it. So the
 * option naming `image/jpeg` was read, agreed with, and then ignored.
 *
 * The fix is to upload bytes rather than a Blob, which makes `contentType`
 * authoritative — and to be sure of the type before sending it. That is what
 * this file is for. It is pure, so the rules are testable on a machine with no
 * phone and no network attached.
 */

/** What the bucket accepts. Anything else is refused before it is uploaded. */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];

const BY_EXTENSION: Record<string, AvatarType> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  // HEIC is what an iPhone stores by default. The picker converts it on the
  // way out, so what arrives is a JPEG wearing the original file's extension.
  heic: "image/jpeg", heif: "image/jpeg",
};

const EXTENSION_OF: Record<AvatarType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extensionOf(name: string): string {
  // A `file://` URI may carry a query or a fragment; a file name may not have a
  // dot at all.
  const clean = name.split(/[?#]/)[0] ?? "";
  const at = clean.lastIndexOf(".");
  return at === -1 ? "" : clean.slice(at + 1).toLowerCase();
}

/**
 * The type to upload a picked image as.
 *
 * The picker's own answer is taken when it is one the bucket accepts. Where the
 * picker says nothing — or says `text/plain`, which is the answer that started
 * all this — the file name decides. Where neither knows, JPEG: the picker
 * encodes to JPEG when it re-encodes, so it is the right guess rather than a
 * lazy one.
 */
export function avatarContentType(asset: { mimeType?: string | null; fileName?: string | null; uri?: string | null }): AvatarType {
  const declared = (asset.mimeType ?? "").trim().toLowerCase();
  if ((AVATAR_TYPES as readonly string[]).includes(declared)) return declared as AvatarType;

  for (const name of [asset.fileName ?? "", asset.uri ?? ""]) {
    const byExtension = BY_EXTENSION[extensionOf(name)];
    if (byExtension) return byExtension;
  }
  return "image/jpeg";
}

/** Where this person's avatar goes, named for what it is. */
export function avatarObjectPath(userId: string, id: string, type: AvatarType): string {
  return `${userId}/${id}.${EXTENSION_OF[type]}`;
}

/**
 * A URL that will not be served from yesterday's cache.
 *
 * The object path changes on every upload, so this is belt and braces — but the
 * bucket is public and a CDN in front of a public bucket has its own opinions
 * about how long a URL stays the same picture.
 */
export function cacheBusted(url: string, at: number = Date.now()): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${at}`;
}

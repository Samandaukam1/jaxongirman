import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { object, string, type ExportElement } from "./export-model.ts";

const OWNER_BUCKETS = new Set(["user-uploads", "presentation-assets", "generated-images", "stock-images"]);
const PUBLIC_ASSET_BUCKETS = new Set(["design-assets", "jelement-assets"]);
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const MAX_ASSETS = 160;

export type ExportAsset = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/svg+xml" | "image/webp";
};

export class ExportAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportAssetError";
  }
}

function sniff(bytes: Uint8Array, declared: string): ExportAsset["mimeType"] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart();
  if (prefix.startsWith("<svg") || (prefix.startsWith("<?xml") && prefix.includes("<svg"))) return "image/svg+xml";
  if (["image/png", "image/jpeg", "image/svg+xml", "image/webp"].includes(declared)) return declared as ExportAsset["mimeType"];
  return null;
}

/**
 * Downloads private slide assets through the service client only after binding
 * both the bucket and object prefix to the exporting presentation. Element
 * content is user-editable, so this check is the exporter's security boundary.
 */
export class ExportAssetLoader {
  private readonly cache = new Map<string, Promise<ExportAsset>>();
  private totalBytes = 0;

  constructor(
    private readonly service: SupabaseClient,
    private readonly ownerId: string,
    private readonly presentationId: string,
  ) {}

  async forElement(element: ExportElement): Promise<ExportAsset | null> {
    const content = object(element.content);
    const kind = string(content.kind, "image");
    if (kind === "frame" || kind === "video") return null;

    const bucket = string(content.storageBucket);
    const path = string(content.storagePath);
    if (!bucket && !path) return null;
    if (!OWNER_BUCKETS.has(bucket) && !PUBLIC_ASSET_BUCKETS.has(bucket)) {
      // The outer export handler keeps this internal detail away from real
      // users; it names the next missing allowlist case in E2E diagnostics.
      throw new ExportAssetError(`Slide image bucket is not allowed: ${bucket || "(empty)"}`);
    }
    const unsafe = !path || path.startsWith("/") || path.includes("..") || path.includes("//");
    const prefix = `${this.ownerId}/${this.presentationId}/`;
    // Design and JElement assets are intentionally public and namespaced by
    // their catalogue entry; they cannot expose another user's data. Private
    // buckets keep the strict owner/presentation prefix that binds editable
    // element content to this deck.
    if (unsafe || (!PUBLIC_ASSET_BUCKETS.has(bucket) && !path.startsWith(prefix))) {
      throw new ExportAssetError("Slide image does not belong to this presentation");
    }

    const key = `${bucket}:${path}`;
    const existing = this.cache.get(key);
    if (existing) return await existing;
    if (this.cache.size >= MAX_ASSETS) throw new ExportAssetError("Presentation contains too many image assets");

    const pending = this.download(bucket, path);
    this.cache.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  private async download(bucket: string, path: string): Promise<ExportAsset> {
    const result = await this.service.storage.from(bucket).download(path);
    if (result.error || !result.data) throw new ExportAssetError("Slide image could not be downloaded");
    if (result.data.size > MAX_ASSET_BYTES) throw new ExportAssetError("A slide image is too large to export");
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    this.totalBytes += bytes.byteLength;
    if (this.totalBytes > MAX_TOTAL_BYTES) throw new ExportAssetError("Presentation images are too large to export together");
    const mimeType = sniff(bytes, result.data.type);
    if (!mimeType) throw new ExportAssetError("A slide image has an unsupported format");
    return { bytes, mimeType };
  }
}

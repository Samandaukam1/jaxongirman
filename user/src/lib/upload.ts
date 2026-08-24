import { supabase } from "@/lib/supabase";

/**
 * Putting a file the person picked into a bucket.
 *
 * There is one way to get this wrong and every upload in the app got it wrong
 * the same way, so it is written down once here.
 *
 * `fetch(uri).blob()` on React Native returns a Blob whose `type` is empty.
 * supabase-js, handed a Blob, sends it as multipart and takes the part's
 * content type from the Blob — not from the `contentType` option sitting right
 * beside it. So the bucket is offered nothing, or `application/octet-stream`,
 * and a bucket with an allow-list refuses. What the person sees is the button
 * failing for no stated reason: storage's complaint is about a MIME type they
 * never chose and cannot see.
 *
 * An ArrayBuffer has no opinion about its own type, which is what makes the
 * option authoritative again.
 */

export type UploadOutcome =
  | { ok: true; path: string; bytes: number }
  | { ok: false; message: string };

/** Read a local file into bytes, with the empty case named rather than thrown. */
export async function readLocalBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

export async function uploadLocalFile(options: {
  bucket: string;
  path: string;
  uri: string;
  contentType: string;
  upsert?: boolean;
  maxBytes?: number;
  /** Shown when the file is over `maxBytes`; the limit is the caller's story. */
  tooLargeMessage?: string;
}): Promise<UploadOutcome> {
  const bytes = await readLocalBytes(options.uri);
  if (bytes.byteLength === 0) {
    return { ok: false, message: "Fayl o‘qilmadi. Boshqa fayl tanlang." };
  }
  if (options.maxBytes && bytes.byteLength > options.maxBytes) {
    return { ok: false, message: options.tooLargeMessage ?? "Fayl juda katta." };
  }

  const { error } = await supabase.storage.from(options.bucket).upload(options.path, bytes, {
    contentType: options.contentType,
    upsert: options.upsert ?? false,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, path: options.path, bytes: bytes.byteLength };
}

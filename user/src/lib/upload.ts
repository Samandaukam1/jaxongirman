import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { i18n } from "@/i18n";
import { env } from "@/lib/env";
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

/**
 * A local file as a URL `fetch` accepts. The image picker hands back
 * `file://…`, but react-native-view-shot's `tmpfile` on iOS hands back a bare
 * path (`/private/var/mobile/…/tmp/ReactNative/….jpg`), which fetch refuses
 * as "Invalid URL".
 */
export function localFileUrl(uri: string): string {
  return uri.startsWith("/") ? `file://${uri}` : uri;
}

/** Read a local file into bytes, with the empty case named rather than thrown. */
export async function readLocalBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(localFileUrl(uri));
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
    return { ok: false, message: i18n.t("misc:upload.unreadable") };
  }
  if (options.maxBytes && bytes.byteLength > options.maxBytes) {
    return { ok: false, message: options.tooLargeMessage ?? i18n.t("misc:upload.tooLarge") };
  }

  const { error } = await supabase.storage.from(options.bucket).upload(options.path, bytes, {
    contentType: options.contentType,
    upsert: options.upsert ?? false,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, path: options.path, bytes: bytes.byteLength };
}

/**
 * A large file sent by the phone itself, straight from disk, with progress.
 *
 * `uploadLocalFile` reads the whole file into JavaScript first. For a 40 MB
 * PowerPoint that is a 40 MB array, turned into base64 on the JS thread before
 * a byte leaves the phone — the screen froze for as long as that took, and on
 * an older phone it looked like a button that did nothing. Here the native
 * uploader streams the file to the same storage endpoint the client library
 * uses, under the person's own session, and the JS thread only hears how far
 * it has got.
 */
export async function streamLocalFile(options: {
  bucket: string;
  path: string;
  uri: string;
  contentType: string;
  onProgress?: (share: number) => void;
}): Promise<UploadOutcome> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: i18n.t("misc:upload.signIn") };

  const url = `${env.supabaseUrl}/storage/v1/object/${options.bucket}/${options.path}`;
  if (Platform.OS === "web") return sendFromBrowser(url, token, options);
  const task = FileSystem.createUploadTask(url, localFileUrl(options.uri), {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.supabaseAnonKey,
      "Content-Type": options.contentType,
      "x-upsert": "false",
    },
  }, (progress) => {
    if (progress.totalBytesExpectedToSend > 0) {
      options.onProgress?.(Math.min(1, progress.totalBytesSent / progress.totalBytesExpectedToSend));
    }
  });

  try {
    const result = await task.uploadAsync();
    if (result && result.status >= 200 && result.status < 300) return { ok: true, path: options.path, bytes: 0 };
    // Storage answers a refusal with JSON; its sentence is English and technical,
    // so the person reads ours and the log keeps theirs.
    if (__DEV__) console.warn("stream upload refused", result?.status, result?.body?.slice(0, 200));
    return { ok: false, message: i18n.t("misc:upload.failed") };
  } catch (failure) {
    if (__DEV__) console.warn("stream upload failed", failure);
    return { ok: false, message: i18n.t("misc:upload.failed") };
  }
}

/**
 * The browser's half of `streamLocalFile`: the picked file is already a Blob
 * behind its `blob:` URL, and XMLHttpRequest is what reports upload progress.
 */
async function sendFromBrowser(
  url: string,
  token: string,
  options: { path: string; uri: string; contentType: string; onProgress?: (share: number) => void },
): Promise<UploadOutcome> {
  let body: Blob;
  try {
    body = await (await fetch(options.uri)).blob();
  } catch {
    return { ok: false, message: i18n.t("misc:upload.unreadable") };
  }
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("apikey", env.supabaseAnonKey);
    request.setRequestHeader("Content-Type", options.contentType);
    request.setRequestHeader("x-upsert", "false");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => resolve(request.status >= 200 && request.status < 300
      ? { ok: true, path: options.path, bytes: body.size }
      : { ok: false, message: i18n.t("misc:upload.failed") });
    request.onerror = () => resolve({ ok: false, message: i18n.t("misc:upload.failed") });
    request.send(body);
  });
}

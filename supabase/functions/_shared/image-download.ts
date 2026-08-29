/**
 * Fetching a picture from the open web, safely.
 *
 * Everything here exists because the address comes from a third-party index
 * rather than from us: a search result can point at a redirect chain, at an
 * address inside our own network, at forty megabytes, or at something that is
 * not an image at all but says it is. A presentation is a public document and
 * these bytes end up in it, so the checks are not optional and are not
 * specific to how the picture was chosen — a person picking one by hand and a
 * deck being generated get exactly the same treatment.
 *
 * Deno only, and deliberately outside the Node build: it resolves DNS itself,
 * which is the one check here that cannot be done with `fetch` alone.
 */

import {
  isBlockedIp,
  IMAGE_MAX_BYTES,
  safeRemoteUrl,
  validateImageBytes,
  type ValidatedImage,
} from "./image-security.ts";

export type DownloadedImage = { bytes: Uint8Array; image: ValidatedImage };

export async function requirePublicDns(url: URL): Promise<void> {
  // URL syntax has already rejected private IP literals. DNS is checked too,
  // and this is repeated after every redirect.
  if (url.hostname.includes(":") || /^\d+(?:\.\d+){3}$/.test(url.hostname)) {
    if (isBlockedIp(url.hostname)) throw new Error("private_image_host_forbidden");
    return;
  }
  const lookups = await Promise.allSettled([
    Deno.resolveDns(url.hostname, "A"),
    Deno.resolveDns(url.hostname, "AAAA"),
  ]);
  const addresses = lookups.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (addresses.length === 0) throw new Error("image_dns_unavailable");
  if (addresses.some(isBlockedIp)) throw new Error("private_image_host_forbidden");
}

export async function downloadRemoteImage(source: string): Promise<DownloadedImage> {
  let url = safeRemoteUrl(source);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    await requirePublicDns(url);
    const clock = new AbortController();
    const alarm = setTimeout(() => clock.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: clock.signal,
        headers: {
          Accept: "image/jpeg,image/png,image/webp",
          "User-Agent": "Jaxongirman/1.0 Telegram image importer",
        },
      });
    } catch {
      throw new Error("image_download_failed");
    } finally {
      clearTimeout(alarm);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) throw new Error("image_download_failed");
      url = safeRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error("image_download_failed");

    const declared = response.headers.get("content-type");
    const mime = (declared ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mime && !["image/jpeg", "image/png", "image/webp", "application/octet-stream"].includes(mime)) {
      throw new Error("image_content_type_invalid");
    }
    const announced = Number(response.headers.get("content-length") ?? 0);
    if (announced > IMAGE_MAX_BYTES) throw new Error("image_download_too_large");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > IMAGE_MAX_BYTES) {
        await reader.cancel();
        throw new Error("image_download_too_large");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return { bytes, image: validateImageBytes(bytes, declared) };
  }
  throw new Error("image_download_failed");
}

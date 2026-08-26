import type { PhotoHit } from "./unsplash-results.ts";

/**
 * Reading an Openverse search result, without doing the search.
 *
 * The mirror of `unsplash-results.ts`, and split for the same reason: the fetch
 * needs a network and the decisions — which result is usable, how a licence is
 * spelled — need neither and are the parts worth testing.
 *
 * Both providers answer in the same shape so the caller never has to know which
 * one replied. That is what lets there be one photo pipeline instead of two.
 */

/** What an Openverse result looks like on the wire, in the parts that are read. */
export type OpenversePhoto = {
  id?: string;
  title?: string;
  creator?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  url?: string;
  provider?: string;
  width?: number;
  height?: number;
};

/**
 * The first result that can be used *and* credited.
 *
 * The same rule Unsplash's side applies: a photo with no file is useless, and
 * one with nobody to credit cannot be published under an open licence, so it is
 * skipped rather than used with an empty credit line.
 */
export function firstUsableOpenverse(results: readonly OpenversePhoto[], skip = 0): PhotoHit | null {
  let passed = 0;
  for (const photo of results) {
    if (!photo.url || !(photo.creator || photo.provider)) continue;
    if (passed < skip) { passed += 1; continue; }

    return {
      url: photo.url,
      width: photo.width ?? 0,
      height: photo.height ?? 0,
      attribution: {
        title: (photo.title ?? "").trim() || "Untitled",
        creator: photo.creator ?? photo.provider ?? "noma'lum",
        // "CC-BY 4.0" rather than "cc-by": the string is shown to a reader on a
        // credits slide, not matched against anything.
        license: photo.license
          ? `${photo.license.toUpperCase()}${photo.license_version ? ` ${photo.license_version}` : ""}`
          : "unknown",
        licenseUrl: photo.license_url ?? "",
        sourceUrl: photo.foreign_landing_url ?? photo.url,
        provider: photo.provider ?? "openverse",
      },
    };
  }
  return null;
}

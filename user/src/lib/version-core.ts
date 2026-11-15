/**
 * Version numbers, read and compared.
 *
 * Pure, so the rules the settings line and the update notice rest on are
 * testable without a phone: "2.0.0" is shown as "Versiya 2.0", and a phone on
 * 1.9.4 is older than a published 2.0 — compared number by number, never as
 * text ("1.10" is newer than "1.9").
 */

/** "2.0.0" → [2, 0, 0]. A part that is not a number counts as 0. */
export function parseVersion(value: string | null | undefined): number[] {
  const parts = String(value ?? "").trim().split(".").map((part) => Number.parseInt(part, 10));
  return parts.map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
}

/** Negative when `a` is older, positive when newer, 0 when the same. Missing parts are 0 (2.0 = 2.0.0). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Whether the installed app is behind the published one. An unknown published version is never newer. */
export function isOlder(installed: string | null | undefined, latest: string | null | undefined): boolean {
  if (!latest || !String(latest).trim()) return false;
  return compareVersions(installed, latest) < 0;
}

/** How a version is said to a person: "2.0" for 2.0.0, "2.1.3" when the last number matters. */
export function versionLabel(value: string | null | undefined): string {
  const [major = 0, minor = 0, patch = 0] = parseVersion(value);
  return patch > 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
}

/** Where an update is fetched when the setting names nowhere (or somewhere it should not). */
export const UPDATE_PAGE = "https://jaxongirman.app/ilova";

export type UpdateOffer = { version: string; url: string; required: boolean };

/**
 * The published version, from the `app.latest_version` setting.
 *
 * Read defensively: the row is edited by hand, and a typo must not open a
 * stranger's page or lock everybody out. A link off jaxongirman.app falls back
 * to the download page; anything without a version is no offer at all.
 */
export function readUpdateOffer(value: unknown): UpdateOffer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: unknown; url?: unknown; required?: unknown };
  const version = typeof raw.version === "string" ? raw.version.trim() : "";
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return null;
  const url = typeof raw.url === "string" && /^https:\/\/(www\.)?jaxongirman\.app(\/|$)/.test(raw.url.trim()) ? raw.url.trim() : UPDATE_PAGE;
  return { version, url, required: raw.required === true };
}

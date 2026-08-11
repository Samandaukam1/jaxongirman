/**
 * Where a QR code points.
 *
 * The join link has to be an absolute `https://` URL: a phone camera reads a
 * string, not a same-origin path, and a Universal Link / App Link only fires
 * for a host the app has claimed. Which host that is changes — jaxongirman.uz
 * today, jaxongirman.app when it lands — so it is configuration rather than a
 * literal in a component. Swapping the domain is an env change and a redeploy;
 * no code moves.
 *
 * The fallback is the browser's own origin. On a projector that is the right
 * answer anyway (the screen and the landing page are the same deployment), so a
 * missing variable degrades to "works on this host" rather than to a broken QR.
 */
const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_WEB_URL || "";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function publicOrigin(): string {
  if (configured) return trimSlash(configured);
  if (typeof window !== "undefined") return trimSlash(window.location.origin);
  return "https://jaxongirman.uz";
}

/** The universal join link for a live match. */
export function joinUrl(token: string): string {
  return `${publicOrigin()}/join/${token}`;
}

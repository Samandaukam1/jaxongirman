import { Platform } from "react-native";

/**
 * The app as it runs on the website.
 *
 * The same screens are exported for the browser and served by the site under
 * `/app` (`EXPO_WEB_BASE_URL` at export time, see `app.config.js`). Same
 * origin as the site on purpose: the session both keep in `localStorage` under
 * the same key is the same session, so a browser signed in on jaxongirman.app
 * is signed in here and the other way round.
 */

export const isWeb = Platform.OS === "web";

/** "/app" on the website, "" on a phone and in a local `expo start --web`. */
export const WEB_BASE = isWeb ? (process.env.EXPO_BASE_URL ?? "").replace(/\/+$/, "") : "";

/** An absolute address inside the web app, for providers that send the browser back. */
export function webAppUrl(path: string): string {
  return `${window.location.origin}${WEB_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The site's own sign-in — a code the phone scans — set to return here.
 * Only meaningful when the app is served by the site; a local web build has no
 * `/kirish` beside it.
 */
export function siteSignInUrl(): string | null {
  if (!isWeb || !WEB_BASE) return null;
  return `/kirish?next=${encodeURIComponent(WEB_BASE)}`;
}

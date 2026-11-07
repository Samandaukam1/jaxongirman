/** Where the app is installed from. One place, so every page links the same listing. */
export const STORE_IOS = "https://apps.apple.com/app/id6800287019";
export const STORE_ANDROID = "https://play.google.com/store/apps/details?id=uz.jaxongirman.app";

/** The one link to hand somebody: `app/ilova` sends each phone to the store it uses. */
export const APP_LINK = "https://jaxongirman.app/ilova";

/** The listing for this user agent, or null when it is not a phone or tablet the server can name. */
export function storeFor(userAgent: string): string | null {
  if (/android/i.test(userAgent)) return STORE_ANDROID;
  if (/iPhone|iPad|iPod/.test(userAgent)) return STORE_IOS;
  return null;
}

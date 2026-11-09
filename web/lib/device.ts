/**
 * Telling a phone from a computer.
 *
 * Two ways, because a phone can lie about one of them. Its user agent names it
 * unless it has been asked for desktop sites, when it says "Linux" or
 * "Macintosh" like a computer. Its screen does not change, so the browser can
 * still tell.
 */

/** A phone by name, not a tablet: Android phones say "Mobile" and its tablets do not. */
export function isPhone(userAgent: string): boolean {
  return /iPhone|iPod|Android.+Mobile/.test(userAgent);
}

/**
 * A phone by its screen: a touch screen whose short side is under 600px, the
 * line Android itself draws between phones and tablets. It is the device's
 * screen, not the window, so a narrow window on a computer is not one, and it
 * reads the same in either orientation.
 *
 * `app/taqdimot/phone-notice.css` repeats this query for the first paint; keep
 * the two the same.
 */
export const PHONE_SCREEN =
  "(pointer: coarse) and (max-device-width: 599px), (pointer: coarse) and (max-device-height: 599px)";

/** In the browser only. */
export function isPhoneScreen(): boolean {
  return window.matchMedia(PHONE_SCREEN).matches;
}

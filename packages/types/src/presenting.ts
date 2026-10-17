/**
 * Moving between slides without waiting for the network.
 *
 * A tap on the phone used to change the slide only after two trips: the
 * phone's command to the database, then the database's change back out to the
 * projector — half a second on a good day, several on a hall's Wi-Fi, and it
 * read as an app that freezes. Now the phone shows the slide at once and tells
 * the projector over the private channel they already share; the command still
 * goes to the database, which stays the one record of where the talk is.
 *
 * These two functions are what the phone and the projector agree on.
 */

export type SlideCommand = "next" | "previous" | "goto";

/** Where a command lands — the same arithmetic as `presentation_apply_command` (0-based, clamped). */
export function slideAfter(command: SlideCommand, current: number, slideCount: number, value?: number): number {
  const last = Math.max(slideCount - 1, 0);
  if (command === "next") return Math.min(current + 1, last);
  if (command === "previous") return Math.max(current - 1, 0);
  const target = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(Math.min(target, last), 0);
}

/** How long a move the presenter made outranks what the database says. */
export const SLIDE_HOLD_MS = 2500;

export type PendingSlide = { slide: number; at: number };

/**
 * The slide to show when the database's row arrives while a move is in flight.
 *
 * Each command's answer names the slide that command reached, so three quick
 * taps would otherwise replay 4, 5, 6 after the screen is already on 6. Until
 * the row agrees with the latest move — or that move is too old to still be on
 * its way — the move wins.
 */
export function settledSlide(serverSlide: number, pending: PendingSlide | null, now: number): { slide: number; pending: PendingSlide | null } {
  if (!pending || serverSlide === pending.slide || now - pending.at > SLIDE_HOLD_MS) {
    return { slide: serverSlide, pending: null };
  }
  return { slide: pending.slide, pending };
}

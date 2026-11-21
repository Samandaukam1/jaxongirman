/**
 * Two taps on a message, close in time and in place: a double tap, which puts
 * the quick reaction on it, as Telegram does.
 *
 * It is told apart here, in JavaScript, from the bubble's own presses — not by
 * a native double-tap recogniser over the bubble. A press goes to the innermost
 * thing that takes it, so the play button, a picture, a quote or a reaction
 * chip inside the bubble keep their single tap, at once, and the bubble never
 * hears about it. A recogniser would see both taps on top of them: the voice
 * would start and stop, the picture would open, and the heart would land too.
 *
 * Nothing waits for a second tap either. A tap on the bubble alone does
 * nothing that cannot wait (it lowers the keyboard, a moment later), so no tap
 * anywhere in the conversation is slowed down to listen for another.
 */

/** A tap as it lifted: when, in milliseconds on the touch's own clock, and where on the screen, in points. */
export type Tap = { at: number; x: number; y: number };

/** The second tap must lift this soon after the first: Android's 300 ms between taps, plus the tap itself. */
export const DOUBLE_TAP_MS = 400;

/** Any sooner is one touch reported twice, or a finger bouncing on the glass — not two taps (Android's own floor). */
export const DOUBLE_TAP_MIN_MS = 40;

/** And it must land this close to the first, in points: a thumb rarely comes down twice on the same spot. */
export const DOUBLE_TAP_SLOP = 40;

/** Whether `second` completes the double tap that `first` began. */
export function isDoubleTap(first: Tap | null, second: Tap): boolean {
  if (!first) return false;
  const gap = second.at - first.at;
  return gap >= DOUBLE_TAP_MIN_MS && gap <= DOUBLE_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_SLOP;
}

/** What a press hands over that matters here. Any of it can be missing: a browser's click has no `timestamp`. */
export type PressLike = {
  timeStamp?: number;
  nativeEvent?: { timestamp?: unknown; pageX?: unknown; pageY?: unknown } | null;
};

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * A press as a tap, or null when it cannot be half of a double tap.
 *
 * The touch's own time comes first (milliseconds, on iOS and on Android), so a
 * busy JavaScript thread that hands two presses over late, or together,
 * neither stretches the gap between them nor shrinks it. A browser's click has
 * no such time; its event's time is on a clock of the same kind. A press with
 * no place on the screen (a screen reader's activation, a switch) is no tap.
 */
export function tapOf(press: PressLike): Tap | null {
  const native = press.nativeEvent ?? {};
  const at = finite(native.timestamp) ?? finite(press.timeStamp);
  const x = finite(native.pageX);
  const y = finite(native.pageY);
  return at === null || x === null || y === null ? null : { at, x, y };
}

/** How long after one's own last reaction answer a late Realtime echo is still not allowed to change one's own reaction. */
export const REACTION_SETTLE_MS = 4_000;

/**
 * A message's reactions as Realtime reports them, with one's own put as this phone last asked or heard it. Only
 * one's own reaction is held: an echo of an earlier step (the heart on, arriving after the answer that took it off)
 * cannot bring it back, while everyone else's reactions in the same echo still show.
 */
export function withMine(reactions: Readonly<Record<string, string>>, me: string, mine: string | null): Record<string, string> {
  const next: Record<string, string> = { ...reactions };
  delete next[me];
  if (mine) next[me] = mine;
  return next;
}

/**
 * A voice message's waveform: the shape of the voice itself, measured while it
 * was recorded and sent with the message, as Telegram does — so the bubble
 * draws the same bars on both phones, from the first moment, and they never
 * change when the message is confirmed.
 *
 * The microphone's level is read every 100 ms during a take (in dBFS, -160
 * silent to 0 loudest). At the end those levels become `WAVE_SIZE` bars, each
 * the loudest moment of its stretch, scaled 0 to `WAVE_MAX` (five bits) against
 * the take's own average, so a quiet voice still has a shape. Pure: no React,
 * no native code, so it is tested in node.
 */

/** Bars in a waveform as it is sent. */
export const WAVE_SIZE = 48;
/** The loudest bar: five bits, Telegram's scale. */
export const WAVE_MAX = 31;
/** Quieter than this many decibels below full scale is silence, as far as the bars are concerned. */
const FLOOR_DB = 50;
/** A waveform from another phone is believed only within these lengths. */
const SHORTEST = 8;
const LONGEST = 256;

/** Levels in dBFS, sampled evenly through a take, as `size` bars from 0 to `WAVE_MAX`. */
export function waveformFrom(levels: readonly number[], size: number = WAVE_SIZE): number[] {
  if (!levels.length || size < 1) return Array.from({ length: Math.max(0, size) }, () => 0);
  const loud = levels.map((db) => (Number.isFinite(db) ? Math.max(0, Math.min(1, (db + FLOOR_DB) / FLOOR_DB)) : 0));
  const bars: number[] = [];
  for (let at = 0; at < size; at += 1) {
    // Each bar covers its share of the take; a take shorter than the bars repeats its samples rather than leaving gaps.
    const from = Math.min(loud.length - 1, Math.floor((at * loud.length) / size));
    const to = Math.max(from + 1, Math.floor(((at + 1) * loud.length) / size));
    let peak = 0;
    for (let index = from; index < to && index < loud.length; index += 1) peak = Math.max(peak, loud[index] ?? 0);
    bars.push(peak);
  }
  // Against the take itself, not full scale: a soft voice still fills its height, the loudest moments reach the
  // top, and a single shout does not flatten the rest (past 1.8 times the average, a bar is simply full).
  // A take of silence stays flat.
  const peak = Math.max(...bars);
  if (peak <= 0) return bars.map(() => 0);
  const average = bars.reduce((sum, value) => sum + value, 0) / bars.length;
  const top = Math.min(peak, Math.max(average * 1.8, 0.12));
  return bars.map((value) => Math.round(Math.min(1, value / top) * WAVE_MAX));
}

/** A message's waveform, if it carries one that can be believed: a list of whole numbers 0 to `WAVE_MAX`. */
export function readWaveform(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < SHORTEST || value.length > LONGEST) return null;
  const bars: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null;
    bars.push(Math.max(0, Math.min(WAVE_MAX, Math.round(entry))));
  }
  return bars;
}

/* ------------------------------------------------------------ while recording */

/** The live meter's floor: quieter than this is the room, not the voice. */
const METER_FLOOR_DB = 52;
/** How much of the way to a louder reading the meter goes at once, and to a quieter one: it rises fast, falls slowly. */
const RISE = 0.65;
const FALL = 0.22;

/**
 * One reading of the microphone (dBFS; `null`/`undefined` where the phone gives none) as the live meter's 0–1:
 * a curve that lifts speech, so a normal voice moves the bars, and a whisper still shows.
 */
export function meterLevel(db: number | null | undefined): number {
  if (typeof db !== "number" || !Number.isFinite(db)) return 0;
  const linear = Math.max(0, Math.min(1, (db + METER_FLOOR_DB) / METER_FLOOR_DB));
  return Math.sqrt(linear);
}

/**
 * The meter's next value from where it is and the new reading: quick up with the voice, slow down after it, so the
 * bars and the glow move with speech without flickering at every 75 ms sample.
 */
export function easeLevel(previous: number, next: number): number {
  const from = Number.isFinite(previous) ? previous : 0;
  const to = Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0;
  return from + (to - from) * (to > from ? RISE : FALL);
}

/** The live wave's bars after one more reading: the oldest goes off the left, the newest comes in on the right. */
export function rollLevels(bars: readonly number[], next: number): number[] {
  if (!bars.length) return [];
  return [...bars.slice(1), Math.max(0, Math.min(1, Number.isFinite(next) ? next : 0))];
}

/** A waveform (any length) as `count` bars from 0 to 1 for drawing: each the loudest of the values it covers. */
export function waveBars(wave: readonly number[], count: number): number[] {
  if (!wave.length || count < 1) return Array.from({ length: Math.max(0, count) }, () => 0);
  return Array.from({ length: count }, (_, at) => {
    const from = Math.min(wave.length - 1, Math.floor((at * wave.length) / count));
    const to = Math.max(from + 1, Math.floor(((at + 1) * wave.length) / count));
    let peak = 0;
    for (let index = from; index < to && index < wave.length; index += 1) peak = Math.max(peak, wave[index] ?? 0);
    return peak / WAVE_MAX;
  });
}

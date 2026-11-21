/**
 * What one report of the shared voice player means for the voice it holds now. Pure (no React, no native code),
 * so it is tested in node.
 *
 * The app has one voice player (voicePlayer.ts). A tap on another voice puts a new file into it while reports
 * about the old one are still on their way from the native side: the pause of the voice before, or its end. Those
 * reports name no file. Taken for the new voice's, an old end stopped the new one as it began (and on Android
 * paused it), an old position and length showed on its bubble, and the play button flickered back to "play".
 * A report is told apart by where it says the player is: a position the new file could not have reached in the
 * time since it was put in belongs to the file before.
 */

/** The parts of expo-audio's status this reads. */
export type VoiceReport = {
  error?: string | null;
  didJustFinish?: boolean;
  isLoaded: boolean;
  playing: boolean;
  isBuffering?: boolean;
  currentTime: number;
  duration: number;
};

export type VoiceReading =
  | { kind: "stale" }
  | { kind: "error" }
  | { kind: "ended" }
  | { kind: "progress"; playing: boolean; position: number; duration: number };

/** For this long after a file is put in, a report that does not say "playing" does not take the play button back. */
export const SETTLE_MS = 300;
/** How far ahead of the time since loading a position may be and still be the new file's (seeks, clocks): seconds. */
const SLACK_S = 0.25;

/**
 * `playing`: what the last tap asked for; `sinceLoad`: ms since the file was put in. Errors are always the current
 * file's (both platforms report them for the item they hold now).
 */
export function readReport(status: VoiceReport, context: { playing: boolean; sinceLoad: number }): VoiceReading {
  if (status.error) return { kind: "error" };
  const since = Math.max(0, context.sinceLoad);
  const position = Number.isFinite(status.currentTime) ? Math.max(0, status.currentTime) : 0;
  // Further on than the new file can be: the end, the pause or the time of the one before.
  if (position > since / 1000 + SLACK_S) return { kind: "stale" };
  if (status.didJustFinish) return { kind: "ended" };
  const settling = since < SETTLE_MS;
  // Loading, buffering or just put in, the player is not yet "playing": what the tap asked for stands, so the
  // button does not flick back to "play" for a moment.
  const playing = status.playing || (context.playing && (!status.isLoaded || Boolean(status.isBuffering) || settling));
  const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
  return { kind: "progress", playing, position, duration };
}

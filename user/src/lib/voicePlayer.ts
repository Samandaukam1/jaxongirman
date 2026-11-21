import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { useSyncExternalStore } from "react";

import { playbackMode } from "@/lib/audioMode";
import type { ChatMessage } from "@/lib/chat";
import { dropMedia, holdMedia, touchMedia } from "@/lib/chatMedia";
import { readReport } from "@/lib/voiceReport";

/**
 * One voice player for the whole app, as Telegram has it.
 *
 * A player per bubble meant a native player (and, on Android, a media
 * session) for every voice message on screen — built while the JavaScript
 * thread waited, each streaming its file from a signed link, the profile's
 * voice tab building up to three hundred at once. Two could play together, and
 * nothing stopped one when a recording began.
 *
 * Here there is one, made the first time anything plays, given a file that is
 * already on the phone (chatMedia downloads it first), so a tap is sound in
 * tens of milliseconds. Starting another voice stops the first; `stopVoice()`
 * stops whatever plays — a recording calls it, and so does leaving the screen.
 * Bubbles are plain views that read the shared state through `useVoice(key)`:
 * only the bubble whose voice it is re-renders as it plays.
 *
 * The key is the message's client id where it has one (else its id), so a
 * message keeps its player across the moment it is confirmed by the server.
 */

export type VoiceState = {
  /** The voice message the player holds: playing, paused part-way, finished, or still being fetched. */
  key: string | null;
  playing: boolean;
  /** Its file is still on its way. */
  loading: boolean;
  /** Where it is, and how long it is, in seconds. */
  position: number;
  duration: number;
  /** It would not play: the next tap fetches it again. */
  failed: boolean;
};

const IDLE: VoiceState = { key: null, playing: false, loading: false, position: 0, duration: 0, failed: false };

let state: VoiceState = IDLE;
let player: AudioPlayer | null = null;
/** Bumped by every new voice, every tap on the one here, and every stop: what an older turn awaited is not played. */
let turn = 0;
let playingPath: string | null = null;
let letGo: (() => void) | null = null;
/**
 * When the player was last given a file (ms). The player is one for every voice, and its reports carry no word
 * of which file they are about: an end, an error or a pause of the voice before still on its way when the next
 * one is put in would otherwise be taken for the new one's — stopped as it began, or its file thrown away.
 */
let loadedAt = 0;
const listeners = new Set<() => void>();

/** The key a message's voice plays under: the same before and after the server confirms it. */
export function voiceKey(message: Pick<ChatMessage, "id" | "client_id">): string {
  return message.client_id ?? message.id;
}

function publish(next: VoiceState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function patch(change: Partial<VoiceState>): void {
  publish({ ...state, ...change });
}

/**
 * The player, made once. It keeps the audio session when it pauses or comes to the end (iOS): by default
 * expo-audio lets the session go 100 ms after either, telling the rest of the phone it may have the sound
 * back — which stops whatever else of this app plays at that moment. A video note tapped while a voice
 * played went silent a moment after it began; a recording begun as the voice stopped lost its microphone.
 */
function audio(): AudioPlayer {
  if (player) return player;
  const created = createAudioPlayer(null, { updateInterval: 100, keepAudioSessionActive: true });
  created.addListener("playbackStatusUpdate", heard);
  player = created;
  return created;
}

function heard(status: AudioStatus): void {
  // Nothing of this voice is in the player yet (its file is still coming): what it says is about the one before.
  if (!state.key || state.loading) return;
  const report = readReport(status, { playing: state.playing, sinceLoad: Date.now() - loadedAt });
  if (report.kind === "stale") return;
  if (report.kind === "error") {
    if (__DEV__) console.log("[voice] would not play:", status.error, playingPath);
    // A file that will not play is not kept: the next tap fetches it again.
    if (playingPath) dropMedia(playingPath);
    patch({ playing: false, loading: false, failed: true });
    return;
  }
  if (report.kind === "ended") {
    // Still first: on Android the player at its end still means to play (ExoPlayer keeps playWhenReady), and the
    // seek back to the start played the voice again, and again — it never stopped. Then back to the start, ready
    // for another listen; the bubble shows the whole length again.
    try {
      player?.pause();
    } catch {
      // Not there to pause: the seek below is all that is left to do.
    }
    void player?.seekTo(0).catch(() => undefined);
    patch({ playing: false, loading: false, position: 0 });
    return;
  }
  patch({ playing: report.playing, position: report.position, duration: report.duration > 0 ? report.duration : state.duration });
}

/**
 * The play button of the voice message `key`. Its own voice: play or pause. Another one: stop that, fetch this
 * one's file (`source`, usually chatMedia's openMedia — instant when it is on the phone) and play it. `path` is
 * the storage path it plays from, kept from eviction while it is the voice here.
 */
export async function toggleVoice(key: string, source: () => Promise<string>, path?: string | null): Promise<void> {
  const sound = audio();
  if (state.key === key && !state.failed) {
    if (state.loading) return;
    // A pause is a turn too: a resume still settling the sound (below) stands down for it.
    turn += 1;
    const mine = turn;
    if (state.playing) {
      sound.pause();
      patch({ playing: false });
      return;
    }
    // The sound set for a voice before every play: silent notes looping ("auto", see settleLoop) may have left
    // it mixing with other apps, and the voice would play over the person's music. A take is never running
    // here — taps on a voice are refused while one records, and a take stops the voice first — so this never
    // stops a recorder (audioMode.ts).
    await playbackMode();
    if (mine !== turn || state.key !== key) return;
    try {
      sound.play();
    } catch (failure) {
      // iOS refused the sound (a call holds it): said on the button, and the next tap starts the voice afresh.
      if (__DEV__) console.log("[voice] resume refused:", failure);
      patch({ playing: false, failed: true });
      return;
    }
    patch({ playing: true });
    touchMedia(path);
    return;
  }
  turn += 1;
  const mine = turn;
  // Whatever the state here says: a voice the phone itself started again (Android gives the sound back after a
  // call and plays on) would otherwise go on under the new one until its file is replaced.
  try {
    sound.pause();
  } catch {
    // Nothing loaded yet.
  }
  letGo?.();
  letGo = holdMedia(path);
  playingPath = path ?? null;
  publish({ ...IDLE, key, loading: true });
  const asked = Date.now();
  try {
    const [uri] = await Promise.all([source(), playbackMode()]);
    if (mine !== turn) return;
    if (__DEV__) console.log(`[voice] ${key}: file in ${Date.now() - asked} ms`, uri);
    loadedAt = Date.now();
    sound.replace({ uri });
    sound.play();
    patch({ loading: false, playing: true, position: 0 });
    touchMedia(path);
  } catch (failure) {
    if (__DEV__) console.log(`[voice] ${key}: could not play`, failure);
    if (mine === turn) patch({ loading: false, playing: false, failed: true });
  }
}

/**
 * Stops the voice playing (or on its way): a recording is starting, the screen is going, the message was deleted.
 * With a key, only if that is the voice here. Answers whether something was playing — iOS lets the audio session
 * go a moment after a pause, and a recorder started inside that moment loses it.
 */
export function stopVoice(key?: string | null): boolean {
  if (key && state.key !== key) return false;
  const was = state.playing || state.loading;
  turn += 1;
  if (player && was) player.pause();
  letGo?.();
  letGo = null;
  playingPath = null;
  if (state !== IDLE) publish(IDLE);
  return was;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The shared player as one voice message sees it: its own state when it is the one here, else idle (and no re-render). */
export function useVoice(key: string | null | undefined): VoiceState {
  return useSyncExternalStore(subscribe, () => (key && state.key === key ? state : IDLE), () => IDLE);
}

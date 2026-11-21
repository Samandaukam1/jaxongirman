import { useEventListener } from "expo";
import { useVideoPlayer, type VideoPlayer } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { Easing, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

import { dropMedia, holdMedia, openMedia, touchMedia } from "@/lib/chatMedia";
import { NoteDeck, type DeckView, type NoteFile } from "@/lib/videoNote";
import { stopVoice } from "@/lib/voicePlayer";

/**
 * A video note played with sound: one at a time, part after part, from files on the phone.
 *
 * It used to be one shared player that, on a tap, threw away the bubble's own looping player (which had the
 * file already) and loaded a fresh signed link from the network — a second or more on Android before the
 * first frame — and then again at every part. Now a tap on a note that loops on screen plays that very player
 * from its start with sound, and the parts after it play on two players of the screen's own, the next one
 * loaded from its file on the phone while the one before plays (videoNote.ts has the rules, and the tests).
 *
 * Every part is fetched at once ("now") when it is not on the phone yet, kept from eviction while the note
 * plays, and marked as just used when it starts. A voice message playing stops when a note starts: one sound
 * at a time. `still` (a recording under way) keeps the screen's own players exactly as they are.
 */

/** Where a note's parts come from, and how they stay while it plays: the chat's media cache. */
const NEEDS = {
  open: (file: NoteFile) => openMedia(file.path, file.local),
  hold: (path: string | null) => {
    touchMedia(path);
    return holdMedia(path);
  },
  // A part that would not play is not kept: the next tap fetches it again. Never the sender's own recording.
  failed: (file: NoteFile) => {
    if (file.path && !file.local) dropMedia(file.path);
  },
};

/**
 * The screen's own players: once through. Their time is reported only while one plays a part (playLoud sets it,
 * the deck's halt clears it): set here, both sent ten reports a second for the screen's whole life (Android), and
 * kept a timer each running after the screen was gone (web).
 */
function setUp(player: VideoPlayer): void {
  player.loop = false;
}

const IDLE: DeckView<VideoPlayer> = { player: null, waiting: false };
/** A note over, the screen's own players keep its files this much longer: the bubble's own loop is still going back on screen. */
const LET_GO_MS = 400;

export type NotePlayback = {
  /** The player of the part on screen; null while nothing plays (or while the first part's file is still coming). */
  player: VideoPlayer | null;
  /** A part's file is still on its way: the first, or the next one at a turn of the camera. */
  waiting: boolean;
  /** 0 to 1 through the whole note, every part by its own length, eased between the player's reports. */
  progress: SharedValue<number>;
  /** Plays a note's parts from the start, with sound. `first`: the bubble's own player, already showing the first part. */
  play: (files: readonly NoteFile[], totalMs: number, first?: VideoPlayer | null) => void;
  stop: () => void;
  /** A bubble's player going away: the note it was playing ends, and the player is not touched again. */
  forget: (player: VideoPlayer) => void;
  /**
   * The part playing has just been drawn somewhere new (its bubble, the corner): in a browser a <video> mounted
   * anew starts paused, and the note stopped there, "playing" for good. On a phone it changes nothing.
   */
  redraw: () => void;
};

export function useNotePlayer({ still = false, onEnd }: { still?: boolean; onEnd?: () => void } = {}): NotePlayback {
  const a = useVideoPlayer(null, setUp);
  const b = useVideoPlayer(null, setUp);
  const [view, setView] = useState<DeckView<VideoPlayer>>(IDLE);
  const progress = useSharedValue(0);
  const [deck] = useState(() => new NoteDeck<VideoPlayer>([a, b], NEEDS, {
    view: setView,
    progress: (share) => progress.set(share > 0 ? withTiming(share, { duration: 100, easing: Easing.linear }) : 0),
  }));
  const ended = useRef(onEnd);
  useEffect(() => { ended.current = onEnd; });
  useEffect(() => deck.connect(() => ended.current?.()), [deck]);

  useEventListener(a, "playToEnd", () => deck.partEnded(a));
  useEventListener(b, "playToEnd", () => deck.partEnded(b));
  useEventListener(a, "timeUpdate", ({ currentTime }) => deck.timeUpdate(a, currentTime));
  useEventListener(b, "timeUpdate", ({ currentTime }) => deck.timeUpdate(b, currentTime));
  useEventListener(a, "sourceLoad", ({ duration }) => deck.loaded(a, duration));
  useEventListener(b, "sourceLoad", ({ duration }) => deck.loaded(b, duration));
  // A part that cannot play ends the note (or is missing when its turn comes) instead of leaving it on for good.
  useEventListener(a, "statusChange", ({ status }) => { if (status === "error") deck.failed(a); });
  useEventListener(b, "statusChange", ({ status }) => { if (status === "error") deck.failed(b); });

  // A bubble's own player, lent for the first part: its end and its time, while it is the one on screen.
  const lent = view.player && view.player !== a && view.player !== b ? view.player : null;
  useEffect(() => {
    if (!lent) return;
    const subscriptions = [
      lent.addListener("playToEnd", () => deck.partEnded(lent)),
      lent.addListener("timeUpdate", ({ currentTime }) => deck.timeUpdate(lent, currentTime)),
      lent.addListener("statusChange", ({ status }) => { if (status === "error") deck.failed(lent); }),
    ];
    return () => {
      for (const subscription of subscriptions) {
        try {
          subscription.remove();
        } catch {
          // Let go of with its bubble already.
        }
      }
    };
  }, [deck, lent]);

  // The screen shows the deck's player now: the one it replaced may take the next part.
  useEffect(() => { deck.onScreen(view.player); }, [deck, view.player]);

  // Nothing plays and nothing records: the screen's own players let go of their files (each would hold a
  // decoder) once the bubble's loop is back — a player emptied while still drawn goes dark for a frame.
  const idle = !view.player && !view.waiting;
  useEffect(() => {
    if (!idle || still) return;
    const timer = setTimeout(() => deck.unload(), LET_GO_MS);
    return () => clearTimeout(timer);
  }, [deck, idle, still]);

  // The screen going: what plays stops, and its files may be evicted again.
  useEffect(() => () => deck.stop(), [deck]);

  // The app leaving the screen: the phone pauses every player in the background (both platforms) and plays none of
  // them again on return, so the note playing would come back frozen and "playing", its ring stuck. It ends, and
  // its screen is told (the bubble shrinks back); a tap plays it again from the start. Not in a browser, where a
  // tab switched away from is no reason to stop a note playing with sound.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      deck.stop();
      ended.current?.();
    });
    return () => subscription.remove();
  }, [deck]);

  const play = useCallback((files: readonly NoteFile[], totalMs: number, first: VideoPlayer | null = null) => {
    // A player started mid-recording would take the microphone (iOS): nothing starts until the take is over.
    if (still) return;
    stopVoice();
    deck.play(files, totalMs, first);
  }, [deck, still]);
  const stop = useCallback(() => deck.stop(), [deck]);
  const forget = useCallback((player: VideoPlayer) => deck.forget(player), [deck]);
  const shownPlayer = view.player;
  const redraw = useCallback(() => deck.onScreen(shownPlayer), [deck, shownPlayer]);
  return { player: view.player, waiting: view.waiting, progress, play, stop, forget, redraw };
}

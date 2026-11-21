import type { GameSessionStatus } from "@jaxongirman/types";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useIsFocused, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AppState } from "react-native";

import { isWeb } from "./web";

/** A room still gathering players or playing: the screen is kept on for it. */
const OPEN: readonly GameSessionStatus[] = ["lobby", "countdown", "question", "question_result", "leaderboard"];

/** A match under way. Leaving one is asked about first; leaving a lobby is not. */
const STARTED: readonly GameSessionStatus[] = ["countdown", "question", "question_result", "leaderboard"];

export const isOpenMatch = (status: GameSessionStatus | null | undefined): boolean =>
  status != null && OPEN.includes(status);

export const isStartedMatch = (status: GameSessionStatus | null | undefined): boolean =>
  status != null && STARTED.includes(status);

/** The question asked before a started match is left, in the screen's own words. */
export type LeaveQuestion = { title: string; body: string; stay: string; go: string };

/**
 * What a phone in an O‘yingoh match needs from the phone itself. The host's
 * remote and a player's screen both use it.
 *
 * Android stops a screen's timers when the screen goes dark and fires them all
 * at once when it lights up. A cheap phone also drops an app left in the
 * background. Each of these used to leave a room behind:
 *
 * - The screen stays on while the room is open and this screen is in front.
 *   The host's phone is the match's only clock: asleep on a desk, it froze
 *   every phone in the room at "0 s". The hold is taken again each time the
 *   app comes back to the front, because a browser drops it whenever its tab
 *   is hidden, and a laptop hosting in a browser is the projector's picture.
 * - Coming back to the app reads the room again (`onResume`), so whatever
 *   happened while the screen was off shows at once, not at the next poll.
 *   So does coming back to this screen from one opened over it (a tapped
 *   push, say).
 * - Leaving a started match is asked about first. Android takes its back
 *   gesture from both edges of the screen, so one stray swipe over the
 *   crossword grid used to drop a player out of the game.
 *
 * `keepAwake: false` lets the screen sleep as usual: for a phone that only
 * waits through a long match with nothing timed on it, such as a Mafia card
 * lying face down for an hour.
 */
export function useMatchScreen({ status, onResume, leave, keepAwake = true }: {
  status: GameSessionStatus | null;
  onResume: () => void;
  leave: LeaveQuestion;
  keepAwake?: boolean;
}): void {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const tag = useId();
  // iOS is briefly "inactive" under Control Center or a system prompt; that
  // is still the front, and the hold is not worth dropping for it.
  const [front, setFront] = useState(() => AppState.currentState !== "background");
  const awake = keepAwake && focused && front && isOpenMatch(status);

  useEffect(() => {
    if (!awake) return;
    // Refused where the platform cannot do it, e.g. an older browser: the
    // match still runs there, and the screen may only dim.
    activateKeepAwakeAsync(tag).catch(() => undefined);
    return () => { deactivateKeepAwake(tag).catch(() => undefined); };
  }, [awake, tag]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setFront(next !== "background");
      if (next === "active") onResume();
    });
    return () => subscription.remove();
  }, [onResume]);

  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current) onResume();
    wasFocused.current = focused;
  }, [focused, onResume]);

  // A browser has no edge swipe to catch, and Alert does nothing there, so a
  // guarded page would only trap its host behind a button that never answers.
  usePreventRemove(!isWeb && isStartedMatch(status), ({ data }) => {
    Alert.alert(leave.title, leave.body, [
      { text: leave.stay, style: "cancel" },
      // The same action, let through: it is marked as already asked about.
      { text: leave.go, style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });
}

import { useEffect } from "react";
import { AppState } from "react-native";

import { touchPresence } from "@/lib/chat";

/** How often an open app says it is here: well inside the server's 75 seconds. */
const BEAT_MS = 30_000;

/**
 * "Online" for the signed-in person: while the app is in front, a heartbeat
 * every half minute; on going to the background, one last word saying so, so
 * the other side sees "last seen" at once rather than after the heartbeat
 * lapses. A phone that dies without saying goodbye drops off by itself.
 */
export function usePresence(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    const beat = () => {
      if (AppState.currentState === "active" || AppState.currentState == null) void touchPresence(true).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") beat();
      else void touchPresence(false).catch(() => undefined);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      void touchPresence(false).catch(() => undefined);
    };
  }, [signedIn]);
}

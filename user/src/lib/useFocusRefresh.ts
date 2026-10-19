import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

/** How old a tab's data may be before coming back to the tab reads it again. */
export const FOCUS_REFRESH_MS = 20_000;

/**
 * Runs `load` when the screen gains focus, but not on every focus.
 *
 * The tabs used to re-read everything each time they were shown: switching
 * Bosh sahifa → Do‘kon → Profil → Bosh sahifa fired a dozen requests, and each
 * answer re-rendered a screen that was already showing the same figures. Moving
 * between tabs quickly is exactly when that cost was felt. A tab that was read
 * a moment ago is left as it is; one that has sat longer than `maxAgeMs` is
 * refreshed in place. Pull-to-refresh calls `load` directly and is never held
 * back by this.
 *
 * `load` should be stable (a `useCallback`). A new identity means what it reads
 * has changed — the signed-in user arrived, a filter moved — so it runs at once,
 * whatever the age: the age check is only for coming back to the same screen.
 */
export function useFocusRefresh(load: () => unknown, maxAgeMs: number = FOCUS_REFRESH_MS): void {
  const lastRun = useRef(0);
  const lastLoad = useRef<(() => unknown) | null>(null);

  useFocusEffect(useCallback(() => {
    const now = Date.now();
    if (lastLoad.current === load && now - lastRun.current < maxAgeMs) return;
    lastLoad.current = load;
    lastRun.current = now;
    void load();
  }, [load, maxAgeMs]));
}

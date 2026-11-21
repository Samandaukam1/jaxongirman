import type { CameraView } from "expo-camera";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { AppState } from "react-native";

import { grayFromJpeg } from "./decode";
import { grabFrame, type LiveFrame } from "./frame";
import {
  frameSide, LIVE_START, markHandled, restAfter, resumeTracker, shouldFallBack, suggestsPhoto, trackFrame,
  type Answers, type FrameOutcome, type LiveStatus, type LiveTracker, type LiveVerdict,
} from "./live";
import { readSheet, type ScanRead } from "./omr";
import type { SheetCode } from "./test-sheet";

/** A sheet the camera settled on: the verdict, the last frame's reading and that frame, in memory only. */
export type LiveCatch = { verdict: LiveVerdict; reading: ScanRead; frame: LiveFrame };

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => setActive(next === "active"));
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * Reads the sheet under the camera, frame after frame, while `enabled`.
 *
 * One loop, one frame at a time: grab a small frame, decode it, read it, add
 * it to the run (`live.ts`), rest, again. The rest follows how long reading
 * took, since reading holds the JavaScript thread. The loop stops when the
 * screen says so (`enabled`: not focused, a sheet being shown, the camera not
 * ready), when the app goes to the background, and when a sheet is caught —
 * the screen takes over then and turns it back on for the next sheet.
 *
 * `hold` stops it and resolves once the frame in flight is done, so a full
 * photo or the gallery never meets a half-taken frame; `release` lets it go
 * on. A loop restarted while the last one is still finishing waits for it:
 * there are never two reads at once.
 */
export function useLiveScan({ camera, enabled, expect, onCatch, onFallBack }: {
  camera: RefObject<CameraView | null>;
  enabled: boolean;
  expect: SheetCode | null;
  onCatch: (caught: LiveCatch) => void;
  onFallBack: () => void;
}): {
  status: LiveStatus;
  suggestPhoto: boolean;
  hold: () => Promise<void>;
  release: () => void;
  /** A sheet graded from a photo: not to be announced again while it stays under the camera. */
  handled: (answers: Answers) => void;
} {
  const appActive = useAppActive();
  const [status, setStatus] = useState<LiveStatus>("fit");
  const [suggestPhoto, setSuggestPhoto] = useState(false);
  const [held, setHeld] = useState(false);
  const tracker = useRef<LiveTracker>(LIVE_START);
  const holding = useRef(false);
  const lastRun = useRef<Promise<void> | null>(null);
  /** Ends the rest between frames early, so stopping never waits out a pause. */
  const wake = useRef<(() => void) | null>(null);
  const running = enabled && appActive && !held && expect !== null;

  /** One frame into the run. True when the loop should stop: a sheet caught, or the phone cannot read. */
  const settle = useEffectEvent((outcome: FrameOutcome, frame: LiveFrame | null): boolean => {
    const step = trackFrame(tracker.current, outcome);
    tracker.current = step.tracker;
    setStatus(step.status);
    setSuggestPhoto(suggestsPhoto(step.tracker));
    if (step.verdict && outcome.ok && frame) {
      onCatch({ verdict: step.verdict, reading: outcome, frame });
      return true;
    }
    if (shouldFallBack(step.tracker)) {
      onFallBack();
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (!running || !expect) return;
    let stopped = false;
    const halted = () => stopped || holding.current;
    const before = lastRun.current;
    const run = async () => {
      await before;
      if (halted()) return;
      tracker.current = resumeTracker(tracker.current);
      setStatus(tracker.current.handled ? "next" : "fit");
      let average = 350;
      while (!halted()) {
        const view = camera.current;
        if (!view) return;
        let outcome: FrameOutcome;
        let frame: LiveFrame | null = null;
        try {
          frame = await grabFrame(view, frameSide(tracker.current));
          if (halted()) return;
          // Each step gives the thread back first, so a tap made meanwhile is answered.
          await wait(0);
          const started = Date.now();
          const gray = grayFromJpeg(frame.base64);
          await wait(0);
          if (halted()) return;
          outcome = readSheet(gray, expect);
          average = average * 0.6 + (Date.now() - started) * 0.4;
        } catch {
          // A camera torn down mid-frame is not a failure to read.
          if (halted()) return;
          outcome = { ok: false, code: "error" };
        }
        // Stopped while reading: the screen has moved on, and this frame is dropped.
        if (halted() || settle(outcome, frame)) return;
        const rest = restAfter(average, tracker.current);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, rest);
          wake.current = () => { clearTimeout(timer); resolve(); };
        });
        wake.current = null;
      }
    };
    lastRun.current = run().catch(() => undefined);
    return () => {
      stopped = true;
      wake.current?.();
    };
  }, [running, expect, camera]);

  const hold = useCallback(async () => {
    holding.current = true;
    wake.current?.();
    setHeld(true);
    await lastRun.current;
  }, []);

  const release = useCallback(() => {
    holding.current = false;
    setHeld(false);
  }, []);

  const handled = useCallback((answers: Answers) => {
    tracker.current = markHandled(tracker.current, answers);
  }, []);

  return { status, suggestPhoto, hold, release, handled };
}

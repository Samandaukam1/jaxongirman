import type { ScanFlag, ScanResult } from "./omr";
import { testFingerprint, type SheetCode } from "./test-sheet";

/**
 * Live scanning, the part that is only bookkeeping: what a run of camera
 * frames adds up to.
 *
 * One frame is not enough to grade on. A hand still moving, a shadow crossing
 * a row or the autofocus hunting can make one frame read a bubble differently
 * from the next, so a sheet is announced only when two frames in a row read
 * the same answers — and a sheet that was just announced is not announced
 * again until it has left the camera, so holding the phone still over it does
 * not grade it twice. Kept free of React Native so the tests can run it.
 */

export type Answers = (number | null)[];

/** What the state line under the frame says. */
export type LiveStatus =
  /** No sheet in view, or not enough of it: "fit the sheet in the frame". */
  | "fit"
  /** A sheet was read once and the next frame should agree: "reading…". */
  | "reading"
  /** A sheet of another test, or printed before this test changed. */
  | "other"
  /** Still the sheet that was just announced: "put the next sheet". */
  | "next";

/** What two or more frames agreed on: graded at once, or rows to check first. */
export type LiveVerdict = { kind: "clean" | "doubtful"; answers: Answers; flags: ScanFlag[] };

/** One frame's outcome: what the reader said, or that the phone could not read the frame at all. */
export type FrameOutcome = ScanResult | { ok: false; code: "error" };

export type LiveTracker = Readonly<{
  /** The reading of the frame just before, when that frame was read. */
  previous: Readonly<{ answers: Answers; flags: ScanFlag[] }> | null;
  /** Readings in a row that did not agree with the one before. */
  disagreements: number;
  /** The answers of the sheet last announced, until it leaves the camera. */
  handled: string | null;
  /** Frames in a row with no sheet in them. */
  absent: number;
  /** Frames in a row with squares in them but no sheet that could be read. */
  unclear: number;
  /** Frames in a row with nothing read, for whatever reason. */
  misses: number;
  /** Frames in a row the phone could not read at all (camera, decoding). */
  errors: number;
}>;

export const LIVE_START: LiveTracker = {
  previous: null, disagreements: 0, handled: null, absent: 0, unclear: 0, misses: 0, errors: 0,
};

/** Frames with no sheet that mean it was taken away: one could be a blurred frame of the same sheet. */
export const ABSENT_TO_FORGET = 2;
/** Readings in a row that never agreed before the sheet is handed over with its unsteady rows marked. */
export const DISAGREEMENTS_TO_GIVE_UP = 2;
/** Failures of the phone's own reading in a row before the server reads instead. */
export const ERRORS_TO_FALL_BACK = 3;
/** Unreadable or empty frames in a row before a full photo for the server is offered. */
const UNCLEAR_TO_SUGGEST = 5;
const MISSES_TO_SUGGEST = 12;

/** The frame's long side in pixels: enough for sixty rows on a sheet filling most of the frame. */
export const LIVE_SIDE = 720;
/** A sharper frame while a sheet is in view but its reading wavers: slower, and clearer. */
export const LIVE_SIDE_SHARP = 960;

/** What a sheet of this test says in its code strip, for the reader to check against. */
export function expectedSheet(test: { id: string; question_count: number; option_count: number }): SheetCode {
  return { questions: test.question_count, options: test.option_count, fingerprint: testFingerprint(test.id) };
}

/** The answers as one string: the sheet's identity for "announced already". */
export function sheetSignature(answers: Answers): string {
  return answers.map((answer) => (answer === null ? "-" : String(answer))).join("");
}

function sameAnswers(a: Answers, b: Answers): boolean {
  return a.length === b.length && a.every((answer, at) => answer === b[at]);
}

/**
 * A frame added to the run. Returns the next state, what the state line says,
 * and — once frames agree — the verdict the screen acts on.
 */
export function trackFrame(tracker: LiveTracker, outcome: FrameOutcome): {
  tracker: LiveTracker; status: LiveStatus; verdict: LiveVerdict | null;
} {
  if (!outcome.ok) {
    const missed = { ...tracker, previous: null, disagreements: 0, misses: tracker.misses + 1 };
    switch (outcome.code) {
      case "no_markers": {
        const absent = tracker.absent + 1;
        return {
          tracker: { ...missed, absent, unclear: 0, errors: 0, handled: absent >= ABSENT_TO_FORGET ? null : tracker.handled },
          status: "fit",
          verdict: null,
        };
      }
      case "not_a_sheet":
        // Something square is there — maybe the same sheet, blurred — so it has not left.
        return { tracker: { ...missed, absent: 0, unclear: tracker.unclear + 1, errors: 0 }, status: "fit", verdict: null };
      case "other_test":
        // Read fine, just not this test's: a photo for the server would say the same.
        return { tracker: { ...missed, absent: 0, unclear: 0, misses: 0, errors: 0 }, status: "other", verdict: null };
      default:
        return { tracker: { ...missed, errors: tracker.errors + 1 }, status: "fit", verdict: null };
    }
  }

  const read = { answers: outcome.answers, flags: outcome.flags };
  const seen = { ...tracker, absent: 0, unclear: 0, misses: 0, errors: 0 };
  const signature = sheetSignature(read.answers);
  if (signature === tracker.handled) {
    return { tracker: { ...seen, previous: null, disagreements: 0 }, status: "next", verdict: null };
  }

  const previous = tracker.previous;
  if (!previous) {
    return { tracker: { ...seen, previous: read, disagreements: 0 }, status: "reading", verdict: null };
  }

  if (sameAnswers(previous.answers, read.answers)) {
    // A row either frame doubted stays doubtful: agreeing on a guess is not certainty.
    const flags = read.flags.map((flag, at) => flag ?? previous.flags[at] ?? null);
    const verdict: LiveVerdict = { kind: flags.some(Boolean) ? "doubtful" : "clean", answers: read.answers, flags };
    return { tracker: { ...seen, previous: null, disagreements: 0, handled: signature }, status: "reading", verdict };
  }

  const disagreements = tracker.disagreements + 1;
  if (disagreements < DISAGREEMENTS_TO_GIVE_UP) {
    return { tracker: { ...seen, previous: read, disagreements }, status: "reading", verdict: null };
  }
  // Frames that never settle: the rows that kept changing are the doubtful ones,
  // and the teacher sees them rather than waiting on a sheet that will not agree.
  const flags = read.flags.map((flag, at): ScanFlag => flag ?? (read.answers[at] === previous.answers[at] ? null : "uncertain"));
  return {
    tracker: { ...seen, previous: null, disagreements: 0, handled: signature },
    status: "reading",
    verdict: { kind: "doubtful", answers: read.answers, flags },
  };
}

/**
 * Coming back to the camera (a sheet saved or skipped, the screen shown
 * again): the frames before the pause are not "the frame before" any more.
 * The announced sheet is still remembered, so it is not graded again.
 */
export function resumeTracker(tracker: LiveTracker): LiveTracker {
  return { ...tracker, previous: null, disagreements: 0, errors: 0 };
}

/**
 * A sheet graded another way — a photo read on the server — counts as
 * announced: back at the camera, the same sheet still lying there is not
 * graded a second time.
 */
export function markHandled(tracker: LiveTracker, answers: Answers): LiveTracker {
  return { ...tracker, previous: null, disagreements: 0, handled: sheetSignature(answers) };
}

/** The frame size for the next frame. */
export function frameSide(tracker: LiveTracker): number {
  const wavering = tracker.disagreements > 0 || tracker.unclear >= 2 || Boolean(tracker.previous?.flags.some(Boolean));
  return wavering ? LIVE_SIDE_SHARP : LIVE_SIDE;
}

/**
 * The pause before the next frame, from how long reading one takes here.
 *
 * Reading runs on the JavaScript thread, so a phone that needs 500 ms per
 * frame gets a longer breath between frames than one that needs 150 ms —
 * enough for a tap or a scroll to be answered at once. With no sheet in view
 * for a while it slows down further: there is nothing to hurry for, and the
 * battery is the teacher's.
 */
export function restAfter(averageReadMs: number, tracker: LiveTracker): number {
  // A frame that failed outright is mostly a camera still waking (the app back
  // from the background): wait for it rather than counting quick failures
  // toward giving up on reading here.
  if (tracker.errors > 0) return 800;
  const breath = Math.min(Math.max(averageReadMs * 0.6, 120), 900);
  return Math.round(breath + (tracker.absent >= 6 ? 400 : 0));
}

/** Whether the phone's reading keeps failing outright, so the server should read instead. */
export function shouldFallBack(tracker: LiveTracker): boolean {
  return tracker.errors >= ERRORS_TO_FALL_BACK;
}

/** Whether to offer a full photo for the server: the camera keeps seeing something it cannot read. */
export function suggestsPhoto(tracker: LiveTracker): boolean {
  return tracker.unclear >= UNCLEAR_TO_SUGGEST || tracker.misses >= MISSES_TO_SUGGEST;
}

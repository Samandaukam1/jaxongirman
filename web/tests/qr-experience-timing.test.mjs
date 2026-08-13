import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const player = readFileSync(path.join(webRoot, "app", "_qr", "QrVideoExperience.tsx"), "utf8");

/**
 * The code appears once, on a cue in the footage, and both ways of missing that
 * cue are silent: no error, no warning, just a screen with no QR on it and a
 * room that cannot pair. Neither is reachable from a unit test — one needs a
 * decoding video element, the other needs a real network — so what is checked
 * here is that the arrangement which makes them impossible is still in place.
 */

test("the code is measured when the video reports its dimensions", () => {
  // A <video> has no width until its metadata arrives, and the code is placed
  // against that width. Measuring only on mount and on resize left the code
  // with nowhere to be, so it was never drawn — and resizing the window was the
  // only thing that could rescue it.
  assert.match(
    player,
    /addEventListener\("loadedmetadata", measure\)/,
    "the player must re-measure when a video's dimensions become known",
  );
  assert.match(
    player,
    /new ResizeObserver\(measure\)/,
    "and it must still follow the stage's own size",
  );
});

test("nothing plays until the code is ready to be revealed", () => {
  // The cue is a moment in the footage and it happens once. Starting the intro
  // while the session token is still in flight means 5.06 seconds can pass with
  // nothing to show, and the code then turns up whenever the network got round
  // to it.
  const gate = /if \(!intro \|\| !videosReady \|\| !drawing \|\| started\) return;/;
  assert.match(player, gate, "playback must wait for the drawn symbol, not only for the footage");
});

test("the cue is read from the frame on screen, not from a coarse timer", () => {
  // `timeupdate` fires about four times a second, which would put the code up
  // to a quarter of a second off a cue chosen to two decimal places.
  assert.match(player, /requestVideoFrameCallback/, "the appear cue must follow the displayed frame");
  assert.match(player, /mediaTime/, "and it must compare against the frame's own media time");
  assert.ok(
    !/addEventListener\("timeupdate"/.test(player),
    "timeupdate is too coarse to place a cue at 5.06 seconds",
  );
});

test("the code arrives even if the cue never does", () => {
  // An appear time longer than the intro would otherwise mean no code at all.
  assert.match(
    player,
    /if \(!hasAppeared\.current\) \{\s*hasAppeared\.current = true;\s*setQrVisible\(true\);/,
    "the end of the intro must also raise the code, so a misconfigured cue cannot strand a room",
  );
});

test("the appearance is remembered outside React state", () => {
  // The loop restarts every couple of seconds; a re-render must not replay the
  // arrival animation.
  assert.match(player, /const hasAppeared = useRef\(false\)/,
    "whether the code has appeared must survive re-renders");
});

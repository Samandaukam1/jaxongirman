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

/**
 * The rules that make the cue work at all.
 *
 * These were deleted once by a stylesheet rewrite, and nothing caught it: the
 * page still built, the tests still passed, and the code simply moved to the
 * top-left corner and showed up at the first frame instead of at 5.06 seconds.
 * Both symptoms came from two declarations going missing, so both are pinned.
 */
const css = readFileSync(path.join(webRoot, "app", "globals.css"), "utf8");

function block(selector) {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} has no rule at all — the code cannot be placed without it`);
  return css.slice(at, css.indexOf("}", at));
}

test("the code is positioned by its own coordinates, not by the document flow", () => {
  // Without `position: absolute` the inline left/top do nothing and the code
  // lands wherever the flow puts it: the corner of the stage.
  assert.match(block(".qrx-code"), /position:\s*absolute/,
    "the code must be absolutely positioned or the admin's coordinates are ignored");
});

test("the code is out of sight until its cue", () => {
  // Without this it is on screen from the first frame, and the appear time an
  // admin set means nothing.
  assert.match(block(".qrx-code"), /opacity:\s*0/,
    "the code must start hidden or it appears immediately instead of at its cue");
  assert.ok(css.includes(".qrx-code.is-in"), "and there must be a rule that reveals it");
  assert.ok(css.includes("@keyframes qrx-arrive"), "with the arrival animation it names");
});

test("nothing in the overlay can be drawn across the code", () => {
  // A panel or a menu over a QR is a QR nobody can scan.
  const code = Number(/z-index:\s*(\d+)/.exec(block(".qrx-code"))?.[1]);
  const chrome = Number(/z-index:\s*(\d+)/.exec(block(".qrx-chrome"))?.[1]);
  assert.ok(Number.isFinite(code) && Number.isFinite(chrome), "both layers must state where they sit");
  assert.ok(code > chrome, `the code (${code}) must sit above the chrome (${chrome})`);
});

test("the page opens on the film, not on the screen it replaces", () => {
  // Deciding in the browser meant the old pairing card rendered first and the
  // film arrived a moment later, so every projector opened with a flash of the
  // thing the film was meant to replace. The server settles it instead.
  const page = readFileSync(path.join(webRoot, "app", "taqdimot", "page.tsx"), "utf8");
  assert.match(page, /loadQrExperienceRow\("taqdimot"\)/, "the page must read the config on the server");
  assert.match(page, /experienceRow=/, "and hand it to the screen as its starting state");

  const screen = readFileSync(path.join(webRoot, "app", "taqdimot", "PairingScreen.tsx"), "utf8");
  assert.match(
    screen,
    /useState<QrExperience \| null>\(\(\) => experienceFromRow\(experienceRow\)\)/,
    "the first render must already know, rather than start at null and correct itself",
  );
});

test("the first frame is shown without waiting for the loop", () => {
  // Both clips have to be ready before playback starts, but holding the picture
  // back for the second one means a dark rectangle for as long as it takes.
  assert.match(player, /setRevealed\(true\)/, "the intro's opening frame must be revealed on its own");
  assert.match(css, /\[data-revealed="false"\] \.qrx-video/, "and the stylesheet must key off that");
});

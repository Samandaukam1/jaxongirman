import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Reading answer sheets on the phone, live.
 *
 * The phone reads camera frames with the same optical mark reader the
 * `test-scan` edge function uses. Deno and the app cannot import one file
 * (Deno needs `.ts` on a relative import, the app's TypeScript refuses it), so
 * the app keeps a copy, and the first tests here are what keep it a copy:
 * nothing may differ but that one import. Then the copy is run the way the
 * phone runs it — a synthetic sheet, photographed into a small frame, through
 * a real JPEG round trip — and the bookkeeping that turns frames into one
 * announcement is held to its rules: two agreeing frames, never the same
 * sheet twice in a row.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const userRoot = path.resolve(here, "..");
const repoRoot = path.resolve(userRoot, "..");
const appDir = path.join(userRoot, "src", "lib", "omr");
const serverDir = path.join(repoRoot, "supabase", "functions", "_shared");

// Built as CommonJS under the app's node_modules, so `jpeg-js` and
// `base64-arraybuffer` resolve the way they do for the app.
const cache = path.join(userRoot, "node_modules", ".cache");
mkdirSync(cache, { recursive: true });
const outDir = mkdtempSync(path.join(cache, "omr-live-"));
writeFileSync(path.join(outDir, "tsconfig.json"), JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "CommonJS", moduleResolution: "node", esModuleInterop: true,
    lib: ["ES2022"], strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [], outDir,
    rootDir: appDir,
  },
  files: ["omr.ts", "test-sheet.ts", "live.ts", "decode.ts"].map((file) => path.join(appDir, file)),
}));
execFileSync(path.join(repoRoot, "node_modules", ".bin", "tsc"), ["-p", path.join(outDir, "tsconfig.json")], { stdio: "inherit" });
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "commonjs" }));
const require = createRequire(path.join(outDir, "index.js"));
const { readSheet } = require("./omr.js");
const { sheetLayout, encodeSheetCode, testFingerprint } = require("./test-sheet.js");
const live = require("./live.js");
const { grayFromJpeg } = require("./decode.js");
const jpeg = require("jpeg-js");

// ------------------------------------------------------------ one reader --

test("the app's test-sheet.ts is the server's, byte for byte", () => {
  assert.equal(readFileSync(path.join(appDir, "test-sheet.ts"), "utf8"), readFileSync(path.join(serverDir, "test-sheet.ts"), "utf8"));
});

test("the app's omr.ts is the server's, but for the `.ts` on its one import", () => {
  const server = readFileSync(path.join(serverDir, "omr.ts"), "utf8");
  const app = readFileSync(path.join(appDir, "omr.ts"), "utf8");
  const imports = [...server.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./test-sheet.ts"], "omr.ts imports only test-sheet.ts; a new import needs the same treatment here");
  assert.equal(app, server.replace('from "./test-sheet.ts";', 'from "./test-sheet";'));
});

// --------------------------------------------------------- a synthetic frame --

const PAPER = 236;
const INK = 24;
const QUIET = 24;

function random(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** The panel as the PDF prints it, at `scale` pixels per point, filled as `answers` says. */
function drawSheet(layout, { answers, fingerprint, scale = 3 }) {
  const W = Math.round((layout.width + QUIET * 2) * scale);
  const H = Math.round((layout.height + QUIET * 2) * scale);
  const data = new Uint8Array(W * H).fill(PAPER);
  const rect = (x, y, w, h, v) => {
    x += QUIET; y += QUIET;
    for (let yy = Math.round(y * scale); yy < Math.round((y + h) * scale); yy += 1)
      for (let xx = Math.round(x * scale); xx < Math.round((x + w) * scale); xx += 1) data[yy * W + xx] = v;
  };
  const disc = (cx, cy, r, v, inner = 0) => {
    cx += QUIET; cy += QUIET;
    for (let yy = Math.floor((cy - r) * scale); yy <= Math.ceil((cy + r) * scale); yy += 1)
      for (let xx = Math.floor((cx - r) * scale); xx <= Math.ceil((cx + r) * scale); xx += 1) {
        const d = Math.hypot(xx / scale - cx, yy / scale - cy);
        if (d <= r && d >= inner) data[yy * W + xx] = Math.min(data[yy * W + xx], v);
      }
  };
  const square = (p, side) => rect(p.x - side / 2, p.y - side / 2, side, side, INK);
  layout.markers.forEach((p) => square(p, layout.markerSize));
  layout.middles.forEach((p) => square(p, layout.middleSize));
  square(layout.orientation, layout.orientationSize);
  encodeSheetCode({ questions: layout.questions, options: layout.options, fingerprint })
    .forEach((bit, at) => { if (bit) square(layout.code[at], layout.codeSize); });
  layout.labels.forEach((label) => rect(label.x - 9, label.y - 3, 9, 6, 50));
  for (const bubble of layout.bubbles) {
    disc(bubble.x, bubble.y, bubble.r, 120, bubble.r - 0.7);
    if (answers[bubble.question] === bubble.option) disc(bubble.x, bubble.y, bubble.r * 0.9, INK);
  }
  return { width: W, height: H, data };
}

/**
 * The sheet seen by the camera in a portrait frame `width` × `height` (RGBA),
 * filling `fill` of its width, turned by `angle`, lit unevenly, with noise.
 * `sheet: null` is the camera pointed at the table.
 */
function frame(sheet, { width = 463, height = 720, fill = 0.8, angle = 0.03, seed = 1, shift = [0, 0] } = {}) {
  const next = random(seed);
  const out = new Uint8Array(width * height * 4);
  const k = sheet ? sheet.width / (width * fill) : 1;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - width / 2 - shift[0];
      const dy = y - height / 2 - shift[1];
      let value = 85 + 20 * Math.sin(x / 31) * Math.cos(y / 47);
      if (sheet) {
        const u = (dx * c + dy * s) * k + sheet.width / 2;
        const v = (-dx * s + dy * c) * k + sheet.height / 2;
        if (u >= 0 && v >= 0 && u < sheet.width - 1 && v < sheet.height - 1) value = sheet.data[Math.floor(v) * sheet.width + Math.floor(u)];
      }
      const lit = 0.72 + 0.3 * (x / width) * 0.7 + 0.3 * (y / height) * 0.3;
      const pixel = Math.max(0, Math.min(255, Math.round(value * lit + (next() - 0.5) * 10)));
      out.set([pixel, pixel, pixel, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data: out };
}

/** What the image manipulator hands the reader: a JPEG, as base64. */
const asJpeg = (image, quality = 72) => Buffer.from(jpeg.encode(image, quality).data).toString("base64");

const TEST_ID = "6f1c2b4e-0000-4000-8000-00000000abcd";

function sheetFor({ questions = 20, options = 4, seed = 1, fingerprint = testFingerprint(TEST_ID), blanks = [] } = {}) {
  const next = random(seed + 100);
  const answers = Array.from({ length: questions }, (_, q) => (blanks.includes(q) ? null : Math.floor(next() * options)));
  return { answers, sheet: drawSheet(sheetLayout(questions, options), { answers, fingerprint }) };
}

const expectFor = (questions, options) => live.expectedSheet({ id: TEST_ID, question_count: questions, option_count: options });

// ---------------------------------------------------- reading on the phone --

test("the sheet's code is checked against the test the app loaded", () => {
  assert.deepEqual(expectFor(25, 5), { questions: 25, options: 5, fingerprint: testFingerprint(TEST_ID) });
});

test("a live-sized frame, through JPEG and back, is read exactly with no row in doubt", () => {
  const { answers, sheet } = sheetFor({ blanks: [4] });
  const result = readSheet(grayFromJpeg(asJpeg(frame(sheet))), expectFor(20, 4));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.deepEqual(result.answers, answers);
  assert.ok(result.flags.every((flag) => flag === null), JSON.stringify(result.flags));
  assert.deepEqual(result.image, { width: 463, height: 720 });
});

test("sixty questions, five options, the sheet filling only 60% of a 720 px frame", () => {
  const { answers, sheet } = sheetFor({ questions: 60, options: 5, seed: 7 });
  const result = readSheet(grayFromJpeg(asJpeg(frame(sheet, { fill: 0.6, angle: -0.05, seed: 3 }), 65)), expectFor(60, 5));
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.deepEqual(result.answers, answers);
  assert.ok(result.flags.every((flag) => flag === null), JSON.stringify(result.flags));
});

test("the sheet upside down in the frame is still read the right way round", () => {
  const { answers, sheet } = sheetFor({ seed: 9 });
  const result = readSheet(grayFromJpeg(asJpeg(frame(sheet, { angle: Math.PI + 0.04 }))), expectFor(20, 4));
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, answers);
});

test("another test's sheet is refused on the phone too", () => {
  const { sheet } = sheetFor({ fingerprint: testFingerprint("6f1c2b4e-0000-4000-8000-000000000001") });
  const result = readSheet(grayFromJpeg(asJpeg(frame(sheet))), expectFor(20, 4));
  assert.equal(result.ok, false);
  assert.equal(result.code, "other_test");
});

test("a frame with no sheet in it says so", () => {
  const result = readSheet(grayFromJpeg(asJpeg(frame(null))), expectFor(20, 4));
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_markers");
});

test("a frame far larger than a live one is refused rather than decoded", () => {
  const big = { width: 2600, height: 1700, data: new Uint8Array(2600 * 1700 * 4).fill(200) };
  assert.throws(() => grayFromJpeg(asJpeg(big, 30)));
});

// ------------------------------------------------- frames into announcements --

const read = (answers, flags = answers.map(() => null)) => ({ ok: true, answers, flags });
const NONE = { ok: false, code: "no_markers" };
const UNCLEAR = { ok: false, code: "not_a_sheet" };
const ERROR = { ok: false, code: "error" };

function run(outcomes, start = live.LIVE_START) {
  let tracker = start;
  const steps = [];
  for (const outcome of outcomes) {
    const step = live.trackFrame(tracker, outcome);
    tracker = step.tracker;
    steps.push(step);
  }
  return { tracker, steps, verdicts: steps.map((step) => step.verdict) };
}

test("one frame is not enough; two in a row with the same answers are", () => {
  const { steps } = run([read([0, 1, 2]), read([0, 1, 2])]);
  assert.equal(steps[0].verdict, null);
  assert.equal(steps[0].status, "reading");
  assert.deepEqual(steps[1].verdict, { kind: "clean", answers: [0, 1, 2], flags: [null, null, null] });
});

test("the two frames must be consecutive: a frame without the sheet between them starts over", () => {
  assert.deepEqual(run([read([0, 1]), NONE, read([0, 1])]).verdicts, [null, null, null]);
  assert.deepEqual(run([read([0, 1]), UNCLEAR, read([0, 1])]).verdicts, [null, null, null]);
  assert.deepEqual(run([read([0, 1]), ERROR, read([0, 1])]).verdicts, [null, null, null]);
});

test("a sheet announced is not announced again while it stays under the camera", () => {
  const { steps, tracker } = run([read([3, 0]), read([3, 0]), read([3, 0]), read([3, 0]), read([3, 0]), NONE, read([3, 0]), read([3, 0])]);
  assert.equal(steps[1].verdict?.kind, "clean");
  assert.deepEqual(steps.slice(2).map((step) => step.verdict), [null, null, null, null, null, null]);
  assert.equal(steps[2].status, "next");
  assert.equal(steps[7].status, "next", "one empty frame may be a blurred frame of the same sheet");
  assert.equal(tracker.handled, live.sheetSignature([3, 0]));
});

test("once it has left the camera, a sheet with the same answers can be announced", () => {
  const { verdicts } = run([read([3, 0]), read([3, 0]), NONE, NONE, read([3, 0]), read([3, 0])]);
  assert.equal(verdicts[1]?.kind, "clean");
  assert.equal(verdicts[5]?.kind, "clean");
});

test("the next sheet, with other answers, is announced without waiting for the first to leave", () => {
  const { verdicts } = run([read([1, 1]), read([1, 1]), read([2, 1]), read([2, 1])]);
  assert.equal(verdicts[1]?.kind, "clean");
  assert.deepEqual(verdicts[3], { kind: "clean", answers: [2, 1], flags: [null, null] });
});

test("coming back to the camera after saving does not count the frame before the pause, nor forget the sheet", () => {
  const first = run([read([1, 2]), read([1, 2])]);
  const paused = live.resumeTracker(run([read([0, 0])], first.tracker).tracker);
  assert.equal(paused.previous, null);
  assert.equal(paused.handled, live.sheetSignature([1, 2]));
  assert.deepEqual(run([read([0, 0])], paused).verdicts, [null]);
});

test("a sheet graded from a photo is not announced again by the camera", () => {
  const graded = live.markHandled(run([read([2, 2])]).tracker, [2, 0]);
  assert.equal(graded.previous, null);
  assert.deepEqual(run([read([2, 0]), read([2, 0])], graded).verdicts, [null, null]);
});

test("a row either frame doubted makes the sheet doubtful, with that row marked", () => {
  const { verdicts } = run([read([0, 1, 2], [null, "uncertain", null]), read([0, 1, 2])]);
  assert.deepEqual(verdicts[1], { kind: "doubtful", answers: [0, 1, 2], flags: [null, "uncertain", null] });
});

test("frames that never agree are handed over with the rows that kept changing marked", () => {
  const { verdicts } = run([read([0, 1, 2]), read([0, 3, 2]), read([0, 1, 2], [null, null, "multiple"])]);
  assert.deepEqual(verdicts.slice(0, 2), [null, null]);
  assert.deepEqual(verdicts[2], { kind: "doubtful", answers: [0, 1, 2], flags: [null, "uncertain", "multiple"] });
});

test("another test's sheet says so and is never announced", () => {
  const other = { ok: false, code: "other_test", read: { questions: 20, options: 4, fingerprint: 1 } };
  const { steps } = run([other, other]);
  assert.deepEqual(steps.map((step) => [step.status, step.verdict]), [["other", null], ["other", null]]);
});

test("the server reads instead only after the phone's reading fails outright, again and again", () => {
  assert.equal(live.shouldFallBack(run([ERROR, ERROR]).tracker), false);
  assert.equal(live.shouldFallBack(run([ERROR, ERROR, read([1]), ERROR]).tracker), false);
  assert.equal(live.shouldFallBack(run([ERROR, ERROR, ERROR]).tracker), true);
});

test("a full photo is offered when the camera keeps seeing something it cannot read", () => {
  assert.equal(live.suggestsPhoto(run([UNCLEAR, UNCLEAR, UNCLEAR, UNCLEAR]).tracker), false);
  assert.equal(live.suggestsPhoto(run([UNCLEAR, UNCLEAR, UNCLEAR, UNCLEAR, UNCLEAR]).tracker), true);
  assert.equal(live.suggestsPhoto(run([UNCLEAR, UNCLEAR, UNCLEAR, UNCLEAR, UNCLEAR, read([1])]).tracker), false);
});

test("frames are small until a sheet's reading wavers, then sharper", () => {
  assert.equal(live.frameSide(live.LIVE_START), live.LIVE_SIDE);
  assert.equal(live.frameSide(run([read([0, 1]), read([0, 2])]).tracker), live.LIVE_SIDE_SHARP);
  assert.equal(live.frameSide(run([read([0, 1], ["uncertain", null])]).tracker), live.LIVE_SIDE_SHARP);
  assert.equal(live.frameSide(run([UNCLEAR, UNCLEAR]).tracker), live.LIVE_SIDE_SHARP);
  assert.equal(live.frameSide(run([UNCLEAR, UNCLEAR, NONE]).tracker), live.LIVE_SIDE);
});

test("the pause between frames follows the reading time, within bounds", () => {
  assert.equal(live.restAfter(50, live.LIVE_START), 120);
  assert.equal(live.restAfter(500, live.LIVE_START), 300);
  assert.equal(live.restAfter(5000, live.LIVE_START), 900);
  assert.ok(live.restAfter(500, run(Array(6).fill(NONE)).tracker) > live.restAfter(500, live.LIVE_START), "slower with nothing to read");
  assert.equal(live.restAfter(100, run([ERROR]).tracker), 800, "a camera still waking is waited for");
});

test("held over a sheet, the phone announces it on the second frame and then waits for the next one", () => {
  const { answers, sheet } = sheetFor({ questions: 15, options: 4, seed: 21 });
  const expect = expectFor(15, 4);
  // A shaky hand: each frame a little moved, turned and differently noisy.
  const frames = [0, 1, 2, 3].map((at) => readSheet(
    grayFromJpeg(asJpeg(frame(sheet, { angle: 0.02 * (at - 1.5), shift: [at * 3, -at * 2], seed: 30 + at }))),
    expect,
  ));
  const { steps } = run(frames);
  assert.equal(steps[0].verdict, null);
  assert.equal(steps[1].verdict?.kind, "clean");
  assert.deepEqual(steps[1].verdict?.answers, answers);
  assert.deepEqual(steps.slice(2).map((step) => [step.status, step.verdict]), [["next", null], ["next", null]]);
});
